'use client';

import { useState, useEffect, useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import { Message, Attachment, ResearchTrace, ResearchStatus, RequestLifecycleState } from '@/types/chat';
import type { TaskType, MessageStatus, TokenUsage } from '@/types/chat';
import type { DocumentExcerpt, DocumentChunk } from '@/types/document';
import { AIModel, ReliabilityOutcome } from '@/types/models';
import { SearchResponse } from '@/types/search';
import * as storage from '@/lib/storage';
import { generateId } from '@/lib/utils';
import { buildResearchFallbackAnswer } from '@/lib/research-fallback';
import { ensureResearchCitations } from '@/lib/research-citations';
import { buildDocumentAppendixIfMissing } from '@/lib/document-citations';
import { retrieveDocumentExcerpts } from '@/lib/document-retrieval';
import { shouldRetrieveConversationDocuments } from '@/lib/document-followup';
import { buildConversationTitle } from '@/lib/title';
import { isCasualGreeting, stripLeadingGreeting, resolveWorkflow } from '@/lib/tasks';
import { extractConversationContextEntities } from '@/lib/research-planner';
import { consumeChatStream } from '@/lib/sse-parser';

const STREAM_FLUSH_MS = 18;
const STREAM_FINISH_BUDGET_MS = 900;
const SEARCH_REQUEST_TIMEOUT_MS = 70 * 1000;
const TITLE_REQUEST_TIMEOUT_MS = 20 * 1000;
const EMPTY_RESPONSE_RETRY_ATTEMPTS = 2;
const RESEARCH_RETRY_SOURCE_LIMITS = [10, 7, 5];
const RESEARCH_RETRY_CONTENT_LIMITS = [1200, 700, 350];

type StreamingDisplay = {
  append: (content: string) => void;
  finish: (finalContent: string) => Promise<void>;
  cancel: () => void;
  getDisplayedContent: () => string;
};

interface ActiveRun {
  id: string;
  conversationId: string;
  controller: AbortController;
  state: RequestLifecycleState;
  startedAt: number;
}

export function useChat(
  conversationId: string | null,
  model: string,
  systemPrompt: string,
  openrouterApiKey?: string,
  tavilyApiKey?: string,
  models: AIModel[] = [],
  onModelsRateLimited?: (modelIds: string[], retryAfterSeconds?: number, taskType?: TaskType) => void,
  onModelOutcome?: (outcome: {
    modelId: string;
    taskType?: TaskType;
    outcome: ReliabilityOutcome;
    latencyMs?: number;
  }) => void,
  onModelPreference?: (preference: { modelId: string; taskType?: TaskType }) => void
) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [lifecycleState, setLifecycleState] = useState<RequestLifecycleState>('idle');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [researchStatus, setResearchStatus] = useState<ResearchStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeRunRef = useRef<ActiveRun | null>(null);
  const activeConversationIdRef = useRef<string | null>(conversationId);
  const currentLoadIdRef = useRef<number>(0);
  const activeStreamingDisplayRef = useRef<StreamingDisplay | null>(null);

  // Load messages and handle conversation switching
  useEffect(() => {
    activeConversationIdRef.current = conversationId;

    // Invariant: Abort previous active run when switching conversations
    if (activeRunRef.current) {
      activeRunRef.current.state = 'cancelled';
      activeRunRef.current.controller.abort(new Error('Switched conversation'));
      activeRunRef.current = null;
    }
    activeStreamingDisplayRef.current?.cancel();
    activeStreamingDisplayRef.current = null;

    setLifecycleState('idle');
    setIsStreaming(false);
    setIsBusy(false);
    setResearchStatus(null);
    setError(null);

    if (conversationId) {
      loadMessages(conversationId);
    } else {
      setMessages([]);
    }

    return () => {
      if (activeRunRef.current) {
        activeRunRef.current.state = 'cancelled';
        activeRunRef.current.controller.abort(new Error('Unmounting chat'));
        activeRunRef.current = null;
      }
      activeStreamingDisplayRef.current?.cancel();
      activeStreamingDisplayRef.current = null;
    };
  }, [conversationId]);

  const loadMessages = async (convId: string) => {
    const loadId = ++currentLoadIdRef.current;
    try {
      const msgs = await storage.getMessages(convId);
      // Invariant: Delayed conversation-A load cannot overwrite conversation B
      if (loadId !== currentLoadIdRef.current || activeConversationIdRef.current !== convId) {
        return;
      }
      setMessages(msgs);
    } catch (err) {
      console.error('Failed to load messages:', err);
    }
  };

  const stopStreaming = useCallback(() => {
    const currentRun = activeRunRef.current;
    if (!currentRun) return;

    currentRun.state = 'cancelled';
    currentRun.controller.abort(new Error('User stopped request'));
    activeStreamingDisplayRef.current?.cancel();
    activeStreamingDisplayRef.current = null;

    setLifecycleState('cancelled');
    setIsStreaming(false);
    setIsBusy(false);
    setResearchStatus(null);
  }, []);

  const sendMessage = useCallback(
    async ({
      content,
      attachments,
      searchEnabled,
      researchEnabled,
      agentEnabled,
      taskType,
      modelOverride,
      compareModels,
      autoRouted,
      routingNote,
      onTitleGenerated,
    }: {
      content: string;
      attachments?: Attachment[];
      searchEnabled?: boolean;
      researchEnabled?: boolean;
      agentEnabled?: boolean;
      taskType?: TaskType;
      modelOverride?: string;
      compareModels?: string[];
      autoRouted?: boolean;
      routingNote?: string;
      onTitleGenerated?: (title: string) => void;
    }) => {
      if (!conversationId || !content.trim()) return;

      // Invariant 1 & 2: Synchronously acquire the execution lock before the first await
      const currentRun = activeRunRef.current;
      if (currentRun && ['preparing', 'searching', 'connecting', 'streaming', 'persisting'].includes(currentRun.state)) {
        console.warn('Execution lock active; ignoring overlapping send request');
        return;
      }

      const runId = generateId();
      const runController = new AbortController();
      const targetConversationId = conversationId;
      const run: ActiveRun = {
        id: runId,
        conversationId: targetConversationId,
        controller: runController,
        state: 'preparing',
        startedAt: Date.now(),
      };
      activeRunRef.current = run;

      setLifecycleState('preparing');
      setIsBusy(true);
      setError(null);
      setResearchStatus(null);

      const activeModel = modelOverride || model;

      try {
        // Step 4: Authoritative workflow resolution
        const workflow = resolveWorkflow({
          content,
          attachments,
          taskType,
          searchEnabled,
          researchEnabled,
        });

        const effectiveTaskType = workflow.taskType;
        const isQuickTask = workflow.isQuickTask;
        const isResearchTask = workflow.shouldSearch;
        const shouldUseSearch = !isQuickTask && isResearchTask;
        const shouldUseResearch = shouldUseSearch && workflow.searchMode !== 'search';
        const searchMode = workflow.searchMode === 'none' ? 'search' : workflow.searchMode;

        // Save user message
        const userMessage = await storage.addMessage(targetConversationId, {
          role: 'user',
          content: content.trim(),
          model: activeModel,
          attachments: attachments?.length ? attachments : undefined,
          taskType: effectiveTaskType,
        });

        if (!userMessage) {
          run.state = 'cancelled';
          return;
        }

        // Invariant 5: Verify ownership after asynchronous continuation
        if (activeRunRef.current?.id !== runId || activeConversationIdRef.current !== targetConversationId) {
          return;
        }

        setMessages((prev) => [...prev, userMessage]);

        // Step 2 & 5: Persist newly attached document records and chunks to IndexedDB
        if (attachments?.length) {
          for (const att of attachments) {
            if (att.documentRecord && att.chunks?.length) {
              const docRecord = {
                ...att.documentRecord,
                conversationId: targetConversationId,
                updatedAt: Date.now(),
              };
              const chunks = att.chunks.map((chk: DocumentChunk) => ({
                ...chk,
                conversationId: targetConversationId,
              }));
              await storage.saveDocument(docRecord, chunks);
            }
          }
        }

        // Step 6: Follow-up and current turn document context resolution
        let documentExcerpts: DocumentExcerpt[] | undefined;
        try {
          const storedDocs = await storage.getDocumentsByConversation(targetConversationId);
          const shouldRetrieveDocs = shouldRetrieveConversationDocuments({
            query: content.trim(),
            hasActiveAttachments: Boolean(attachments?.length),
            hasStoredDocuments: storedDocs.length > 0,
            storedDocuments: storedDocs,
          });

          if (shouldRetrieveDocs && storedDocs.length > 0) {
            const convChunks = await storage.getConversationChunks(targetConversationId);
            if (convChunks.length > 0) {
              const retrieval = retrieveDocumentExcerpts({
                query: content.trim(),
                chunks: convChunks,
                documents: storedDocs,
                options: { topK: 8, maxTokens: 3000, expandNeighbors: true },
              });
              if (retrieval.excerpts.length > 0) {
                documentExcerpts = retrieval.excerpts;
              }
            }
          }
        } catch (docErr) {
          console.warn('Document retrieval resolution failed:', docErr);
        }

        // Casual greeting shortcut
        if (isCasualGreeting(content)) {
          const assistantMessage = await storage.addMessage(targetConversationId, {
            role: 'assistant',
            content: 'Hey! How can I help?',
            model: activeModel,
            researchMode: false,
            agentMode: false,
            taskType: 'quick',
            autoRouted,
            routingNote,
          });

          if (!assistantMessage || activeRunRef.current?.id !== runId || activeConversationIdRef.current !== targetConversationId) {
            return;
          }

          setMessages((prev) => [...prev, assistantMessage]);

          // Step 7: Greeting shortcut must not rename an established conversation
          const existingMessages = await storage.getMessages(targetConversationId);
          if (existingMessages.length <= 2 && onTitleGenerated) {
            onTitleGenerated('Greeting');
          }

          run.state = 'completed';
          return;
        }

        // Title generation: immediate local title if first turn
        const currentMessages = await storage.getMessages(targetConversationId);
        const isFirstTurn = currentMessages.length <= 1;
        const localTitle = buildConversationTitle(content.trim());
        if (isFirstTurn && onTitleGenerated) {
          onTitleGenerated(localTitle);
        }

        // Perform web search if needed
        let searchResults: SearchResponse | null = null;
        if (shouldUseSearch) {
          run.state = 'searching';
          setLifecycleState('searching');
          const initialPhase = shouldUseResearch ? 'planning' : 'searching';
          setResearchStatus({
            phase: initialPhase,
            mode: searchMode,
            label: researchStatusLabel(initialPhase, searchMode),
          });

          try {
            const contextEntities = extractConversationContextEntities(messages);

            const searchRes = await fetchWithTimeout(
              '/api/search',
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(tavilyApiKey ? { 'x-tavily-key': tavilyApiKey } : {}),
                  ...(openrouterApiKey ? { 'x-openrouter-key': openrouterApiKey } : {}),
                },
                body: JSON.stringify({
                  query: stripLeadingGreeting(content),
                  mode: searchMode,
                  model: activeModel,
                  contextEntities: contextEntities.length > 0 ? contextEntities : undefined,
                }),
              },
              SEARCH_REQUEST_TIMEOUT_MS,
              runController.signal
            );

            if (activeRunRef.current?.id !== runId || activeConversationIdRef.current !== targetConversationId) {
              return;
            }

            if (searchRes.ok) {
              searchResults = await searchRes.json();
              setResearchStatus({
                phase: 'synthesizing',
                mode: searchMode,
                label: researchStatusLabel('synthesizing', searchMode),
                plannedQueries: searchResults?.plannedQueries?.length,
                sourceCount: searchResults?.results?.length,
                openedCount: searchResults?.results?.filter((result) => result.extracted).length,
              });
            } else {
              const err = await searchRes.json().catch(() => ({}));
              setError(err.error || 'Search failed; continuing without web results');
            }
          } catch (err) {
            if ((err as Error).name === 'AbortError' || runController.signal.aborted) {
              run.state = 'cancelled';
              return;
            }
            console.error('Search failed:', err);
            setError('Search failed; continuing without web results');
          }
        }

        if (activeRunRef.current?.id !== runId || activeConversationIdRef.current !== targetConversationId) {
          return;
        }

        // Context construction: exclude error messages, empty placeholders, deduplicate compare runs
        const historyMessages = await storage.getMessages(targetConversationId);
        const apiMessages = buildApiMessages(historyMessages, userMessage.id, userMessage.content, attachments);

        const runModels = uniqueModels(compareModels?.length ? compareModels : [activeModel]);
        let firstResponseContent = '';
        run.state = 'connecting';
        setLifecycleState('connecting');

        for (const runModel of runModels) {
          if (activeRunRef.current?.id !== runId || activeConversationIdRef.current !== targetConversationId) {
            return;
          }

          let streamDisplay: StreamingDisplay | null = null;
          const assistantId = generateId();
          const placeholderMessage: Message = {
            id: assistantId,
            conversationId: targetConversationId,
            role: 'assistant',
            content: '',
            model: runModel,
            researchMode: shouldUseResearch,
            agentMode: agentEnabled === true,
            taskType: effectiveTaskType,
            autoRouted,
            routingNote,
            compareRun: runModels.length > 1,
            searchResults: searchResults?.results?.map((r, index) => ({
              id: r.id || `src_${index + 1}`,
              title: r.title,
              url: r.url,
              canonicalUrl: r.canonicalUrl || r.url,
              domain: r.domain,
              publishedAt: r.publishedAt,
              snippet: r.snippet,
              content: r.content,
              extracted: r.extracted,
              fetchedAt: r.fetchedAt || Date.now(),
              sourceScore: r.sourceScore,
              sourceLabel: r.sourceLabel,
              sourceReason: r.sourceReason,
            })),
            researchTrace: buildResearchTrace(searchResults),
            documentExcerpts,
            timestamp: Date.now(),
          };

          setMessages((prev) => [...prev, placeholderMessage]);
          setResearchStatus(null);

          let finalModel = runModel;
          try {
            const requestStartedAt = Date.now();
            let fullContent = '';
            streamDisplay = createStreamingDisplay(assistantId, () => finalModel, setMessages);
            activeStreamingDisplayRef.current = streamDisplay;

            run.state = 'streaming';
            setLifecycleState('streaming');
            setIsStreaming(true);

            const response = await fetch('/api/chat', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(openrouterApiKey ? { 'x-openrouter-key': openrouterApiKey } : {}),
              },
              body: JSON.stringify({
                messages: apiMessages,
                model: runModel,
                availableModels: models
                  .filter((item) => item.isFree && item.id.endsWith(':free') && !isCoolingDown(item))
                  .map((item) => item.id),
                systemPrompt: systemPrompt || undefined,
                searchResults: searchResults?.results,
                attachments,
                documentExcerpts,
                researchMode: shouldUseResearch,
                agentMode: agentEnabled === true,
                taskType: effectiveTaskType,
              }),
              signal: runController.signal,
            });

            if (!response.ok || !response.body) {
              throw await readChatError(response, 'Failed to send message');
            }

            const streamResult = await consumeChatStream(
              response.body.getReader(),
              runModel,
              {
                onMeta: (meta) => {
                  finalModel = meta.model;
                },
                onDelta: (delta) => {
                  if (delta.model) finalModel = delta.model;
                  streamDisplay?.append(delta.content);
                },
                onFallback: (fb) => {
                  if (fb.toModel) finalModel = fb.toModel;
                  if (fb.rateLimitedModels?.length) {
                    onModelsRateLimited?.(fb.rateLimitedModels, fb.retryAfterSeconds, effectiveTaskType);
                  }
                  if (fb.fromModel) {
                    onModelOutcome?.({ modelId: fb.fromModel, taskType: effectiveTaskType, outcome: 'failure' });
                  }
                },
                onComplete: (comp) => {
                  if (comp.model) finalModel = comp.model;
                },
                onInterrupted: (interrupted) => {
                  if (interrupted.model) finalModel = interrupted.model;
                },
                onResearchFallback: (rf) => {
                  if (rf.model) finalModel = rf.model;
                },
                onError: (errEvt) => {
                  if (errEvt.rateLimitedModels?.length) {
                    onModelsRateLimited?.(errEvt.rateLimitedModels, errEvt.retryAfterSeconds, effectiveTaskType);
                  }
                  for (const m of errEvt.failedModels || []) {
                    onModelOutcome?.({ modelId: m, taskType: effectiveTaskType, outcome: 'failure' });
                  }
                },
              }
            );

            if (streamResult.status === 'failed') {
              throw new Error(streamResult.errorMessage || 'Chat stream failed');
            }

            fullContent = streamResult.fullContent;
            finalModel = streamResult.finalModel;

            if (!fullContent.trim()) {
              throw new Error('The model returned an empty response after automatic retries. Please try again.');
            }

            await streamDisplay?.finish(fullContent);
            activeStreamingDisplayRef.current = null;

            if (activeRunRef.current?.id !== runId || activeConversationIdRef.current !== targetConversationId) {
              return;
            }

            if (!firstResponseContent) firstResponseContent = fullContent;

            run.state = 'persisting';
            setLifecycleState('persisting');

            // Step 0 Invariant 5: Verify conversation still exists (not deleted during generation)
            const targetConv = await storage.getConversation(targetConversationId);
            if (!targetConv) {
              run.state = 'cancelled';
              return;
            }

            await storage.addMessage(targetConversationId, {
              role: 'assistant',
              content: fullContent,
              model: finalModel,
              researchMode: shouldUseResearch,
              agentMode: agentEnabled === true,
              taskType: effectiveTaskType,
              autoRouted,
              routingNote,
              compareRun: runModels.length > 1,
              searchResults: placeholderMessage.searchResults,
              researchTrace: placeholderMessage.researchTrace,
              documentExcerpts,
              status: streamResult.status,
              finishReason: streamResult.finishReason,
              tokenUsage: streamResult.tokenUsage,
            });

            if (streamResult.status === 'complete') {
              onModelOutcome?.({
                modelId: finalModel,
                taskType: effectiveTaskType,
                outcome: 'success',
                latencyMs: Date.now() - requestStartedAt,
              });
            } else if (streamResult.status === 'interrupted') {
              onModelOutcome?.({
                modelId: finalModel,
                taskType: effectiveTaskType,
                outcome: 'interrupted',
                latencyMs: Date.now() - requestStartedAt,
              });
            }

            if (activeRunRef.current?.id !== runId || activeConversationIdRef.current !== targetConversationId) {
              return;
            }

            const updatedMessages = await storage.getMessages(targetConversationId);
            if (activeConversationIdRef.current === targetConversationId) {
              setMessages(updatedMessages);
            }
          } catch (err) {
            streamDisplay?.cancel();
            activeStreamingDisplayRef.current = null;

            if ((err as Error).name === 'AbortError' || runController.signal.aborted) {
              const partial = streamDisplay?.getDisplayedContent() || '';
              if (partial.trim()) {
                const targetConv = await storage.getConversation(targetConversationId);
                if (targetConv) {
                  const interruptedMsg = await storage.addMessage(targetConversationId, {
                    role: 'assistant',
                    content: partial,
                    model: finalModel,
                    researchMode: shouldUseResearch,
                    agentMode: agentEnabled === true,
                    taskType: effectiveTaskType,
                    autoRouted,
                    routingNote,
                    compareRun: runModels.length > 1,
                    searchResults: placeholderMessage.searchResults,
                    researchTrace: placeholderMessage.researchTrace,
                    documentExcerpts,
                    status: 'interrupted',
                    finishReason: 'cancelled',
                  });
                  if (interruptedMsg && activeConversationIdRef.current === targetConversationId) {
                    setMessages((prev) =>
                      prev.map((m) => (m.id === assistantId ? interruptedMsg : m))
                    );
                  }
                }
              } else {
                setMessages((prev) => prev.filter((m) => m.id !== assistantId));
              }
              run.state = 'cancelled';
              return;
            }

            const errorMessage = (err as Error).message || 'Failed to get response';
            const details = parseChatErrorDetails(err);
            if (details.rateLimitedModels.length > 0) {
              onModelsRateLimited?.(details.rateLimitedModels, details.retryAfterSeconds, effectiveTaskType);
            } else {
              onModelOutcome?.({ modelId: runModel, taskType: effectiveTaskType, outcome: 'failure' });
            }

            const fallbackContent = buildClientResearchFallback(content.trim(), placeholderMessage.searchResults, errorMessage, shouldUseSearch);
            if (fallbackContent) {
              const storedFallback = await storage.addMessage(targetConversationId, {
                role: 'assistant',
                content: fallbackContent,
                model: runModel,
                researchMode: shouldUseResearch,
                agentMode: agentEnabled === true,
                taskType: effectiveTaskType,
                autoRouted,
                routingNote,
                compareRun: runModels.length > 1,
                searchResults: placeholderMessage.searchResults,
                researchTrace: placeholderMessage.researchTrace,
                documentExcerpts,
                status: 'degraded',
                finishReason: 'fallback',
              });

              if (storedFallback && activeConversationIdRef.current === targetConversationId) {
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantId ? storedFallback : m))
                );
              }
              if (!firstResponseContent) firstResponseContent = fallbackContent;
              continue;
            }

            setError(errorMessage);
            const storedError = await storage.addMessage(targetConversationId, {
              role: 'assistant',
              content: errorMessage,
              model: runModel,
              researchMode: shouldUseResearch,
              agentMode: agentEnabled === true,
              taskType: effectiveTaskType,
              autoRouted,
              routingNote,
              compareRun: runModels.length > 1,
              searchResults: placeholderMessage.searchResults,
              researchTrace: placeholderMessage.researchTrace,
              documentExcerpts,
              isError: true,
            });

            if (storedError && activeConversationIdRef.current === targetConversationId) {
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? storedError : m))
              );
            }
          }
        }

        run.state = 'completed';

        // Background title generation (Step 7: Non-blocking, bounded deadline, correct conversation identity)
        if (isFirstTurn && openrouterApiKey && firstResponseContent && onTitleGenerated) {
          scheduleModelTitleGeneration({
            conversationId: targetConversationId,
            content: content.trim(),
            attachments,
            assistantReply: firstResponseContent,
            model: activeModel,
            openrouterApiKey,
            activeConversationIdRef,
            onTitleGenerated,
          });
        }
      } finally {
        // Invariant 6 & 7: Old finally block must never clear a newer run's controller
        if (activeRunRef.current?.id === runId) {
          activeRunRef.current = null;
          setLifecycleState('idle');
          setIsBusy(false);
          setIsStreaming(false);
          setResearchStatus(null);
        }
      }
    },
    [conversationId, model, systemPrompt, openrouterApiKey, tavilyApiKey, models, onModelsRateLimited, onModelOutcome]
  );

  const regenerateMessage = useCallback(
    async (messageId: string) => {
      if (!conversationId) return;

      const active = activeRunRef.current;
      if (active && ['preparing', 'searching', 'connecting', 'streaming', 'persisting'].includes(active.state)) {
        console.warn('Execution lock active; ignoring regenerate request');
        return;
      }

      const msgIndex = messages.findIndex((m) => m.id === messageId);
      if (msgIndex < 0) return;

      const targetMessage = messages[msgIndex];
      const userMsg = [...messages].slice(0, msgIndex).reverse().find((m) => m.role === 'user');
      if (!userMsg) return;

      const runId = generateId();
      const runController = new AbortController();
      const targetConversationId = conversationId;
      const run: ActiveRun = {
        id: runId,
        conversationId: targetConversationId,
        controller: runController,
        state: 'preparing',
        startedAt: Date.now(),
      };
      activeRunRef.current = run;

      setLifecycleState('preparing');
      setIsBusy(true);
      setError(null);
      setResearchStatus(null);

      let streamDisplay: StreamingDisplay | null = null;
      let assistantId = '';

      const stagedOriginalMessages = messages.slice(msgIndex);

      assistantId = generateId();
      const placeholderMessage: Message = {
        id: assistantId,
        conversationId: targetConversationId,
        role: 'assistant',
        content: '',
        model,
        researchMode: targetMessage.researchMode,
        agentMode: targetMessage.agentMode,
        taskType: targetMessage.taskType,
        autoRouted: targetMessage.autoRouted,
        routingNote: targetMessage.routingNote,
        searchResults: targetMessage.searchResults,
        researchTrace: targetMessage.researchTrace,
        documentExcerpts: targetMessage.documentExcerpts,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev.slice(0, msgIndex), placeholderMessage]);

      const currentMessages = await storage.getMessages(targetConversationId);
      const apiMessages = buildApiMessages(currentMessages, userMsg.id, userMsg.content, userMsg.attachments);

      let fullContent = '';
      let finalModel = model;
      streamDisplay = createStreamingDisplay(assistantId, () => finalModel, setMessages);
      activeStreamingDisplayRef.current = streamDisplay;
      const requestStartedAt = Date.now();

      try {
        run.state = 'streaming';
        setLifecycleState('streaming');
        setIsStreaming(true);

        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(openrouterApiKey ? { 'x-openrouter-key': openrouterApiKey } : {}),
          },
          body: JSON.stringify({
            messages: apiMessages,
            model,
            availableModels: models
              .filter((item) => item.isFree && item.id.endsWith(':free') && !isCoolingDown(item))
              .map((item) => item.id),
            systemPrompt: systemPrompt || undefined,
            searchResults: targetMessage.searchResults,
            attachments: userMsg.attachments,
            documentExcerpts: targetMessage.documentExcerpts,
            researchMode: targetMessage.researchMode === true,
            agentMode: targetMessage.agentMode === true,
            taskType: targetMessage.taskType,
          }),
          signal: runController.signal,
        });

        if (!response.ok || !response.body) {
          throw await readChatError(response, 'Failed to regenerate message');
        }

        const streamResult = await consumeChatStream(
          response.body.getReader(),
          model,
          {
            onMeta: (meta) => {
              finalModel = meta.model;
            },
            onDelta: (delta) => {
              if (delta.model) finalModel = delta.model;
              streamDisplay?.append(delta.content);
            },
            onFallback: (fb) => {
              if (fb.toModel) finalModel = fb.toModel;
              if (fb.rateLimitedModels?.length) {
                onModelsRateLimited?.(fb.rateLimitedModels, fb.retryAfterSeconds, targetMessage.taskType);
              }
              if (fb.fromModel) {
                onModelOutcome?.({ modelId: fb.fromModel, taskType: targetMessage.taskType, outcome: 'failure' });
              }
            },
            onComplete: (comp) => {
              if (comp.model) finalModel = comp.model;
            },
            onInterrupted: (interrupted) => {
              if (interrupted.model) finalModel = interrupted.model;
            },
            onResearchFallback: (rf) => {
              if (rf.model) finalModel = rf.model;
            },
            onError: (errEvt) => {
              if (errEvt.rateLimitedModels?.length) {
                onModelsRateLimited?.(errEvt.rateLimitedModels, errEvt.retryAfterSeconds, targetMessage.taskType);
              }
              for (const m of errEvt.failedModels || []) {
                onModelOutcome?.({ modelId: m, taskType: targetMessage.taskType, outcome: 'failure' });
              }
            },
          }
        );

        if (streamResult.status === 'failed') {
          throw new Error(streamResult.errorMessage || 'Failed to regenerate message');
        }

        fullContent = streamResult.fullContent;
        finalModel = streamResult.finalModel;

        if (!fullContent.trim()) {
          throw new Error('The model returned an empty response. Please try again.');
        }

        await streamDisplay?.finish(fullContent);
        activeStreamingDisplayRef.current = null;

        if (activeRunRef.current?.id !== runId || activeConversationIdRef.current !== targetConversationId) {
          return;
        }

        run.state = 'persisting';
        setLifecycleState('persisting');

        // Step 0 Invariant 5: Verify conversation still exists (not deleted during generation)
        const targetConv = await storage.getConversation(targetConversationId);
        if (!targetConv) {
          run.state = 'cancelled';
          return;
        }

        // Step 0 Invariants 1 & 2: Atomically replace old history in a single IndexedDB transaction
        await storage.replaceMessagesTransactional(
          targetConversationId,
          stagedOriginalMessages.map((m) => m.id),
          {
            role: 'assistant',
            content: fullContent,
            model: finalModel,
            researchMode: targetMessage.researchMode,
            agentMode: targetMessage.agentMode,
            taskType: targetMessage.taskType,
            autoRouted: targetMessage.autoRouted,
            routingNote: targetMessage.routingNote,
            searchResults: targetMessage.searchResults,
            researchTrace: targetMessage.researchTrace,
            documentExcerpts: targetMessage.documentExcerpts,
            status: streamResult.status,
            finishReason: streamResult.finishReason,
            tokenUsage: streamResult.tokenUsage,
          }
        );

        if (streamResult.status === 'complete') {
          onModelOutcome?.({
            modelId: finalModel,
            taskType: targetMessage.taskType,
            outcome: 'success',
            latencyMs: Date.now() - requestStartedAt,
          });
        } else if (streamResult.status === 'interrupted') {
          onModelOutcome?.({
            modelId: finalModel,
            taskType: targetMessage.taskType,
            outcome: 'interrupted',
            latencyMs: Date.now() - requestStartedAt,
          });
        }

        if (activeRunRef.current?.id !== runId || activeConversationIdRef.current !== targetConversationId) {
          return;
        }

        const updatedMessages = await storage.getMessages(targetConversationId);
        if (activeConversationIdRef.current === targetConversationId) {
          setMessages(updatedMessages);
        }
        run.state = 'completed';
      } catch (err) {
        streamDisplay?.cancel();
        activeStreamingDisplayRef.current = null;

        if ((err as Error).name === 'AbortError' || runController.signal.aborted) {
          // Step 0 Invariant: Non-destructive cancellation - restore staged original messages in UI
          if (activeConversationIdRef.current === targetConversationId) {
            setMessages((prev) => {
              const beforePlaceholder = prev.slice(0, msgIndex);
              return [...beforePlaceholder, ...stagedOriginalMessages];
            });
          }
          run.state = 'cancelled';
          return; // Do NOT record failure for user cancellation
        }

        const errorMessage = (err as Error).message || 'Failed to regenerate message';
        const details = parseChatErrorDetails(err);
        if (details.rateLimitedModels.length > 0) {
          onModelsRateLimited?.(details.rateLimitedModels, details.retryAfterSeconds, targetMessage.taskType);
        } else {
          onModelOutcome?.({ modelId: model, taskType: targetMessage.taskType, outcome: 'failure' });
        }

        const fallbackContent = buildClientResearchFallback(
          userMsg.content,
          targetMessage.searchResults,
          errorMessage,
          Boolean(targetMessage.researchMode || targetMessage.taskType === 'research' || targetMessage.taskType === 'deep-research')
        );
        if (fallbackContent) {
          const targetConv = await storage.getConversation(targetConversationId);
          if (!targetConv) {
            run.state = 'cancelled';
            return;
          }
          const storedFallback = await storage.replaceMessagesTransactional(
            targetConversationId,
            stagedOriginalMessages.map((m) => m.id),
            {
              role: 'assistant',
              content: fallbackContent,
              model,
              researchMode: targetMessage.researchMode,
              agentMode: targetMessage.agentMode,
              taskType: targetMessage.taskType,
              autoRouted: targetMessage.autoRouted,
              routingNote: targetMessage.routingNote,
              searchResults: targetMessage.searchResults,
              researchTrace: targetMessage.researchTrace,
              documentExcerpts: targetMessage.documentExcerpts,
              status: 'degraded',
              finishReason: 'fallback',
            }
          );
          if (storedFallback && activeConversationIdRef.current === targetConversationId) {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? storedFallback : m))
            );
          }
          return;
        }

        // Genuine error: restore original messages in UI and show error message without deleting historical branch
        setError(errorMessage);
        if (activeConversationIdRef.current === targetConversationId) {
          setMessages((prev) => {
            const beforePlaceholder = prev.slice(0, msgIndex);
            return [...beforePlaceholder, ...stagedOriginalMessages];
          });
        }
      } finally {
        if (activeRunRef.current?.id === runId) {
          activeRunRef.current = null;
          setLifecycleState('idle');
          setIsBusy(false);
          setIsStreaming(false);
          setResearchStatus(null);
        }
      }
    },
    [conversationId, messages, model, systemPrompt, openrouterApiKey, models, onModelsRateLimited, onModelOutcome]
  );

  const removeMessage = useCallback(
    async (messageId: string) => {
      await storage.deleteMessage(messageId);
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
    },
    []
  );

  const preferMessage = useCallback(
    async (messageId: string) => {
      const message = messages.find((item) => item.id === messageId);
      if (!message?.compareRun || !message.model) return;
      if (message.preferred) return;
      await storage.updateMessage(messageId, { preferred: true });
      setMessages((prev) =>
        prev.map((item) =>
          item.id === messageId
            ? { ...item, preferred: true }
            : item
        )
      );
      onModelPreference?.({ modelId: message.model, taskType: message.taskType });
    },
    [messages, onModelPreference]
  );

  return {
    messages,
    isStreaming,
    isBusy,
    lifecycleState,
    canStop: isStreaming || isBusy,
    researchStatus,
    error,
    sendMessage,
    stopStreaming,
    regenerateMessage,
    removeMessage,
    preferMessage,
  };
}

function buildApiMessages(
  history: Message[],
  currentPromptId?: string,
  currentPromptContent?: string,
  attachments?: Attachment[]
): Array<{ role: 'user' | 'assistant'; content: string }> {
  // Step 6: Exclude failed assistant messages (isError === true) and empty messages
  const valid = history.filter((m) => !m.isError && m.content && m.content.trim().length > 0);

  // Compare mode: deduplicate competing assistant answers to prevent feeding competing answers back to model
  const deduped: Message[] = [];
  for (let i = 0; i < valid.length; i++) {
    const msg = valid[i];
    if (msg.role === 'assistant' && msg.compareRun) {
      const siblings = [msg];
      while (i + 1 < valid.length && valid[i + 1].role === 'assistant' && valid[i + 1].compareRun) {
        siblings.push(valid[i + 1]);
        i++;
      }
      const preferred = siblings.find((s) => s.preferred) || siblings[siblings.length - 1];
      deduped.push(preferred);
    } else {
      deduped.push(msg);
    }
  }

  return deduped.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.id === currentPromptId && currentPromptContent
      ? withAttachmentCue(currentPromptContent, attachments)
      : m.content,
  }));
}

function buildResearchTrace(searchResults: SearchResponse | null): ResearchTrace | undefined {
  if (!searchResults) return undefined;
  return {
    query: searchResults.query,
    plannedQueries: searchResults.plannedQueries,
    plannedEntities: searchResults.plannedEntities,
    planner: searchResults.planner,
    provider: searchResults.provider,
    providers: searchResults.providers,
    providerErrors: searchResults.providerErrors,
    sourceCount: searchResults.results?.length || 0,
    openedCount: searchResults.results?.filter((result) => result.extracted).length || 0,
  };
}

function researchStatusLabel(phase: ResearchStatus['phase'], mode: ResearchStatus['mode']): string {
  const depth = mode === 'deep-research' ? 'deep research' : mode === 'research' ? 'research' : 'web search';
  switch (phase) {
    case 'planning':
      return `Planning ${depth} queries`;
    case 'searching':
      return `Searching the web`;
    case 'reading':
      return `Opening sources`;
    case 'synthesizing':
      return `Preparing answer from sources`;
    default:
      return `Working`;
  }
}

class ChatRequestError extends Error {
  rateLimitedModels: string[];
  retryAfterSeconds?: number;

  constructor(message: string, details?: { rateLimitedModels?: string[]; retryAfterSeconds?: number }) {
    super(message);
    this.name = 'ChatRequestError';
    this.rateLimitedModels = details?.rateLimitedModels || [];
    this.retryAfterSeconds = details?.retryAfterSeconds;
  }
}

async function readChatError(response: Response, fallback: string): Promise<ChatRequestError> {
  const text = await response.text();
  if (!text) return new ChatRequestError(fallback);
  try {
    const parsed = JSON.parse(text) as {
      error?: unknown;
      rateLimitedModels?: unknown;
      retryAfterSeconds?: unknown;
    };
    const message = typeof parsed.error === 'string' && parsed.error.trim()
      ? parsed.error
      : fallback;
    return new ChatRequestError(message, {
      rateLimitedModels: Array.isArray(parsed.rateLimitedModels)
        ? parsed.rateLimitedModels.filter((item): item is string => typeof item === 'string')
        : [],
      retryAfterSeconds: typeof parsed.retryAfterSeconds === 'number' ? parsed.retryAfterSeconds : undefined,
    });
  } catch {
    return new ChatRequestError(text);
  }
}

function withAttachmentCue(content: string, attachments?: Attachment[]): string {
  if (!attachments?.length) return content;
  const names = attachments.map((attachment) => attachment.name).join(', ');
  return `${content}\n\n[Current message attachments: ${names}]`;
}

function isCoolingDown(model: AIModel): boolean {
  return Boolean(model.cooldownUntil && model.cooldownUntil > Date.now());
}

function parseChatErrorDetails(error: unknown): {
  rateLimitedModels: string[];
  retryAfterSeconds?: number;
} {
  if (error instanceof ChatRequestError) {
    return {
      rateLimitedModels: error.rateLimitedModels,
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }
  return { rateLimitedModels: [] };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function uniqueModels(models: string[]): string[] {
  return Array.from(new Set(models.filter((modelId) => modelId.trim().length > 0)));
}

function compactSearchResultsForAttempt<T extends { content?: string; snippet?: string }>(
  results: T[] | undefined,
  attempt: number
): T[] | undefined {
  if (!results?.length) return results;
  const sourceLimit = RESEARCH_RETRY_SOURCE_LIMITS[Math.min(attempt, RESEARCH_RETRY_SOURCE_LIMITS.length - 1)];
  const contentLimit = RESEARCH_RETRY_CONTENT_LIMITS[Math.min(attempt, RESEARCH_RETRY_CONTENT_LIMITS.length - 1)];

  return results.slice(0, sourceLimit).map((result) => ({
    ...result,
    content: typeof result.content === 'string' ? result.content.slice(0, contentLimit) : undefined,
    snippet: typeof result.snippet === 'string' ? result.snippet.slice(0, 500) : result.snippet,
  }));
}

function buildClientResearchFallback(
  question: string,
  sources: Message['searchResults'],
  reason: string,
  isResearchTask?: boolean
): string | null {
  if (!isResearchTask) return null;
  if (!sources?.length) return null;
  const usefulSources = sources.filter(
    (s) => s.sourceLabel === 'Strong' || s.sourceLabel === 'Useful' || (typeof s.sourceScore === 'number' && s.sourceScore >= 50)
  );
  if (usefulSources.length === 0) return null;
  return buildResearchFallbackAnswer({
    question,
    sources: usefulSources,
    reason,
  });
}

function scheduleModelTitleGeneration({
  conversationId,
  content,
  attachments,
  assistantReply,
  model,
  openrouterApiKey,
  activeConversationIdRef,
  onTitleGenerated,
}: {
  conversationId: string;
  content: string;
  attachments?: Attachment[];
  assistantReply: string;
  model: string;
  openrouterApiKey: string;
  activeConversationIdRef: React.RefObject<string | null>;
  onTitleGenerated: (title: string) => void;
}) {
  const TITLE_TIMEOUT_MS = 8000;
  fetchWithTimeout(
    '/api/chat',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-openrouter-key': openrouterApiKey,
      },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: withAttachmentCue(content, attachments) },
          { role: 'assistant', content: assistantReply.slice(0, 500) },
        ],
        model,
        generateTitleFor: true,
      }),
    },
    TITLE_TIMEOUT_MS
  )
    .then(async (res) => {
      if (res.ok) {
        const { title } = await res.json();
        const cleanTitle = typeof title === 'string' ? title.trim() : '';
        if (cleanTitle && cleanTitle !== 'New conversation') {
          const updated = await storage.updateAutoTitle(conversationId, cleanTitle);
          if (updated && activeConversationIdRef.current === conversationId) {
            onTitleGenerated(cleanTitle);
          }
        }
      }
    })
    .catch(() => {
      // Non-blocking: background title generation failure does not interrupt chat flow
    });
}

function createStreamingDisplay(
  assistantId: string,
  getModel: () => string,
  setMessages: Dispatch<SetStateAction<Message[]>>
): StreamingDisplay {
  let displayed = '';
  let pending = '';
  let timer: number | null = null;
  let cancelled = false;

  const render = () => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === assistantId
          ? { ...message, content: displayed, model: getModel() }
          : message
      )
    );
  };

  const flush = () => {
    if (cancelled) {
      timer = null;
      return;
    }

    if (!pending) {
      timer = null;
      return;
    }

    const next = takeStreamingChunk(pending);
    displayed += next;
    pending = pending.slice(next.length);
    render();
    timer = window.setTimeout(flush, STREAM_FLUSH_MS);
  };

  return {
    append(content: string) {
      pending += content;
      if (!timer) flush();
    },
    async finish(finalContent: string) {
      const deadline = Date.now() + STREAM_FINISH_BUDGET_MS;
      while (pending && Date.now() < deadline && !cancelled) {
        const next = takeStreamingChunk(pending);
        displayed += next;
        pending = pending.slice(next.length);
        render();
        await wait(STREAM_FLUSH_MS);
      }

      if (timer) {
        window.clearTimeout(timer);
        timer = null;
      }
      pending = '';
      displayed = finalContent;
      render();
    },
    getDisplayedContent() {
      return displayed + pending;
    },
    cancel() {
      cancelled = true;
      if (timer) {
        window.clearTimeout(timer);
        timer = null;
      }
      displayed += pending;
      pending = '';
    },
  };
}

function takeStreamingChunk(text: string): string {
  if (text.length <= 3) return text;

  const leadingWhitespace = text.match(/^\s+/)?.[0];
  if (leadingWhitespace) return leadingWhitespace;

  const word = text.match(/^[^\s]+(\s+)?/)?.[0];
  if (!word) return text.slice(0, 1);

  if (word.length > 14) {
    return word.slice(0, 8);
  }

  return word;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  parentSignal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const onParentAbort = () => {
    controller.abort(parentSignal?.reason || new Error('User stopped request'));
    if (timeout) clearTimeout(timeout);
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      onParentAbort();
    } else {
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  timeout = setTimeout(() => controller.abort(new Error('Request timed out. Please retry.')), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (parentSignal?.aborted) {
      const abortErr = new Error('User stopped request');
      abortErr.name = 'AbortError';
      throw abortErr;
    }
    if (controller.signal.aborted) {
      throw new Error('Request timed out. Please retry.');
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
    if (parentSignal) parentSignal.removeEventListener('abort', onParentAbort);
  }
}
