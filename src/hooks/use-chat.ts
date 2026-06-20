'use client';

import { useState, useEffect, useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import { Message, Attachment, ResearchTrace, ResearchStatus } from '@/types/chat';
import type { TaskType } from '@/types/chat';
import { AIModel } from '@/types/models';
import { SearchResponse } from '@/types/search';
import * as storage from '@/lib/storage';
import { generateId } from '@/lib/utils';
import { buildResearchFallbackAnswer } from '@/lib/research-fallback';
import { ensureResearchCitations } from '@/lib/research-citations';
import { buildConversationTitle } from '@/lib/title';

const STREAM_FLUSH_MS = 18;
const STREAM_FINISH_BUDGET_MS = 900;
const SEARCH_REQUEST_TIMEOUT_MS = 70 * 1000;
const TITLE_REQUEST_TIMEOUT_MS = 20 * 1000;

type StreamingDisplay = {
  append: (content: string) => void;
  finish: (finalContent: string) => Promise<void>;
  cancel: () => void;
};

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
    outcome: 'success' | 'failure' | 'rate_limited';
    latencyMs?: number;
  }) => void,
  onModelPreference?: (preference: { modelId: string; taskType?: TaskType }) => void
) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [researchStatus, setResearchStatus] = useState<ResearchStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load messages when conversation changes
  useEffect(() => {
    if (conversationId) {
      loadMessages(conversationId);
    } else {
      setMessages([]);
    }
    return () => {
      abortRef.current?.abort();
      setResearchStatus(null);
    };
  }, [conversationId]);

  const loadMessages = async (convId: string) => {
    try {
      const msgs = await storage.getMessages(convId);
      setMessages(msgs);
    } catch (err) {
      console.error('Failed to load messages:', err);
    }
  };

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

      setError(null);
      setResearchStatus(null);
      const activeModel = modelOverride || model;

      // Save user message
      const userMessage = await storage.addMessage(conversationId, {
        role: 'user',
        content: content.trim(),
        model: activeModel,
        attachments: attachments?.length ? attachments : undefined,
        taskType,
      });

      setMessages((prev) => [...prev, userMessage]);

      // Perform web search if enabled
      let searchResults: SearchResponse | null = null;
      const isResearchTask = taskType === 'research' || taskType === 'deep-research';
      const shouldUseSearch = searchEnabled || researchEnabled || isResearchTask;
      const shouldUseResearch = researchEnabled || isResearchTask;
      const searchMode = taskType === 'deep-research' ? 'deep-research' : shouldUseResearch ? 'research' : 'search';
      if (shouldUseSearch) {
        try {
          const initialPhase = shouldUseResearch ? 'planning' : 'searching';
          setResearchStatus({
            phase: initialPhase,
            mode: searchMode,
            label: researchStatusLabel(initialPhase, searchMode),
          });
          const searchRes = await fetchWithTimeout('/api/search', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(tavilyApiKey ? { 'x-tavily-key': tavilyApiKey } : {}),
              ...(openrouterApiKey ? { 'x-openrouter-key': openrouterApiKey } : {}),
            },
            body: JSON.stringify({ query: content.trim(), mode: searchMode, model: activeModel }),
          }, SEARCH_REQUEST_TIMEOUT_MS);
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
          console.error('Search failed:', err);
          setError('Search failed; continuing without web results');
        }
      }

      // Prepare messages for API
      const currentMessages = await storage.getMessages(conversationId);
      const apiMessages = currentMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.id === userMessage.id
          ? withAttachmentCue(m.content, attachments)
          : m.content,
      }));

      const runModels = uniqueModels(compareModels?.length ? compareModels : [activeModel]);
      let firstResponseContent = '';
      setIsStreaming(true);
      abortRef.current = new AbortController();

      try {
        for (const runModel of runModels) {
          let streamDisplay: StreamingDisplay | null = null;
          const assistantId = generateId();
          const placeholderMessage: Message = {
            id: assistantId,
            conversationId,
            role: 'assistant',
            content: '',
            model: runModel,
            researchMode: shouldUseResearch,
            agentMode: agentEnabled === true,
            taskType,
            autoRouted,
            routingNote,
            compareRun: runModels.length > 1,
            searchResults: searchResults?.results?.map((r) => ({
              title: r.title,
              url: r.url,
              snippet: r.snippet,
              content: r.content,
              extracted: r.extracted,
              fetchedAt: r.fetchedAt,
              sourceScore: r.sourceScore,
              sourceLabel: r.sourceLabel,
              sourceReason: r.sourceReason,
            })),
            researchTrace: buildResearchTrace(searchResults),
            timestamp: Date.now(),
          };

          setMessages((prev) => [...prev, placeholderMessage]);
          setResearchStatus(null);

          try {
            const requestStartedAt = Date.now();
            let fullContent = '';
            let finalModel = runModel;
            streamDisplay = createStreamingDisplay(assistantId, () => finalModel, setMessages);

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
                researchMode: shouldUseResearch,
                agentMode: agentEnabled === true,
                taskType,
              }),
              signal: abortRef.current.signal,
            });

            if (!response.ok || !response.body) {
              throw await readChatError(response, 'Failed to send message');
            }

            const reader = response.body?.getReader();
            if (!reader) throw new Error('No response stream');

            const decoder = new TextDecoder();
            let buffer = '';
            const recordedFallbackFailures = new Set<string>();
            const processLine = (line: string) => {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data: ')) return;
              try {
                const data = JSON.parse(trimmed.slice(6));
                if (data.model) {
                  finalModel = data.model;
                }
                if (data.content) {
                  fullContent += data.content;
                  streamDisplay?.append(data.content);
                }
                const rateLimitedModels = normalizeStringArray(data.rateLimitedModels);
                if (rateLimitedModels.length > 0) {
                  onModelsRateLimited?.(
                    rateLimitedModels,
                    typeof data.retryAfterSeconds === 'number' ? data.retryAfterSeconds : undefined,
                    taskType
                  );
                  for (const failedModel of rateLimitedModels) {
                    recordedFallbackFailures.add(failedModel);
                  }
                }
                for (const failedModel of normalizeStringArray(data.failedModels)) {
                  if (recordedFallbackFailures.has(failedModel)) continue;
                  recordedFallbackFailures.add(failedModel);
                  onModelOutcome?.({ modelId: failedModel, taskType, outcome: 'failure' });
                }
              } catch {
                // skip malformed
              }
            };

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                processLine(line);
              }
            }
            buffer += decoder.decode();
            if (buffer.trim()) {
              processLine(buffer);
            }

            if (!fullContent.trim()) {
              throw new Error('The model returned an empty response. Please try again.');
            }

            const finalContentWithCitations = shouldUseResearch
              ? ensureResearchCitations(fullContent, placeholderMessage.searchResults)
              : fullContent;

            await streamDisplay?.finish(finalContentWithCitations);
            if (!firstResponseContent) firstResponseContent = finalContentWithCitations;

            await storage.addMessage(conversationId, {
              role: 'assistant',
              content: finalContentWithCitations,
              model: finalModel,
              researchMode: shouldUseResearch,
              agentMode: agentEnabled === true,
              taskType,
              autoRouted,
              routingNote,
              compareRun: runModels.length > 1,
              searchResults: placeholderMessage.searchResults,
              researchTrace: placeholderMessage.researchTrace,
            });
            onModelOutcome?.({
              modelId: finalModel,
              taskType,
              outcome: 'success',
              latencyMs: Date.now() - requestStartedAt,
            });

            const updatedMessages = await storage.getMessages(conversationId);
            setMessages(updatedMessages);
          } catch (err) {
            streamDisplay?.cancel();
            if ((err as Error).name === 'AbortError') {
              setMessages((prev) => prev.filter((m) => m.id !== assistantId));
              return;
            }
            const errorMessage = (err as Error).message || 'Failed to get response';
            const details = parseChatErrorDetails(err);
            if (details.rateLimitedModels.length > 0) {
              onModelsRateLimited?.(details.rateLimitedModels, details.retryAfterSeconds, taskType);
            } else {
              onModelOutcome?.({ modelId: runModel, taskType, outcome: 'failure' });
            }

            const fallbackContent = buildClientResearchFallback(content.trim(), placeholderMessage.searchResults, errorMessage);
            if (fallbackContent) {
              const storedFallback = await storage.addMessage(conversationId, {
                role: 'assistant',
                content: fallbackContent,
                model: runModel,
                researchMode: shouldUseResearch,
                agentMode: agentEnabled === true,
                taskType,
                autoRouted,
                routingNote,
                compareRun: runModels.length > 1,
                searchResults: placeholderMessage.searchResults,
                researchTrace: placeholderMessage.researchTrace,
              });
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? storedFallback
                    : m
                )
              );
              if (!firstResponseContent) firstResponseContent = fallbackContent;
              continue;
            }

            setError(errorMessage);
            const storedError = await storage.addMessage(conversationId, {
              role: 'assistant',
              content: errorMessage,
              model: runModel,
              researchMode: shouldUseResearch,
              agentMode: agentEnabled === true,
              taskType,
              autoRouted,
              routingNote,
              compareRun: runModels.length > 1,
              searchResults: placeholderMessage.searchResults,
              researchTrace: placeholderMessage.researchTrace,
              isError: true,
            });
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? storedError
                  : m
              )
            );
          }
        }

        // Generate title if this is the first exchange
        if (currentMessages.length <= 1 && onTitleGenerated) {
          const fallbackTitle = buildConversationTitle(content.trim());
          if (!openrouterApiKey) {
            onTitleGenerated(fallbackTitle);
            return;
          }
          try {
            const titleRes = await fetchWithTimeout('/api/chat', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(openrouterApiKey ? { 'x-openrouter-key': openrouterApiKey } : {}),
              },
              body: JSON.stringify({
                messages: [
                  { role: 'user', content: withAttachmentCue(content.trim(), attachments) },
                  { role: 'assistant', content: firstResponseContent.slice(0, 500) },
                ],
                model: activeModel,
                generateTitleFor: true,
              }),
            }, TITLE_REQUEST_TIMEOUT_MS);
            if (titleRes.ok) {
              const { title } = await titleRes.json();
              const cleanTitle = typeof title === 'string' ? title.trim() : '';
              if (cleanTitle && cleanTitle !== 'New conversation') {
                onTitleGenerated(cleanTitle);
              } else {
                onTitleGenerated(fallbackTitle);
              }
            }
          } catch {
            onTitleGenerated(fallbackTitle);
          }
        }
      } finally {
        setIsStreaming(false);
        setResearchStatus(null);
        abortRef.current = null;
      }
    },
    [conversationId, model, systemPrompt, openrouterApiKey, tavilyApiKey, models, onModelsRateLimited, onModelOutcome]
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setResearchStatus(null);
  }, []);

  const regenerateMessage = useCallback(
    async (messageId: string) => {
      if (!conversationId) return;

      // Find the message index and remove it + everything after
      const msgIndex = messages.findIndex((m) => m.id === messageId);
      if (msgIndex < 0) return;

      const targetMessage = messages[msgIndex];

      // Get the last user message before this assistant message
      const userMsg = [...messages].slice(0, msgIndex).reverse().find((m) => m.role === 'user');
      if (!userMsg) return;

      // Delete messages from storage from msgIndex onwards
      for (const msg of messages.slice(msgIndex)) {
        await storage.deleteMessage(msg.id);
      }

      setMessages((prev) => prev.slice(0, msgIndex));

      setError(null);
      setResearchStatus(null);

      const assistantId = generateId();
      const placeholderMessage: Message = {
        id: assistantId,
        conversationId,
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
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev.slice(0, msgIndex), placeholderMessage]);
      setIsStreaming(true);

      let streamDisplay: StreamingDisplay | null = null;

      try {
        abortRef.current = new AbortController();
        const requestStartedAt = Date.now();
        let fullContent = '';
        let finalModel = model;
        streamDisplay = createStreamingDisplay(assistantId, () => finalModel, setMessages);

        const currentMessages = await storage.getMessages(conversationId);
        const apiMessages = currentMessages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.id === userMsg.id
            ? withAttachmentCue(m.content, userMsg.attachments)
            : m.content,
        }));

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
            researchMode: targetMessage.researchMode === true,
            agentMode: targetMessage.agentMode === true,
            taskType: targetMessage.taskType,
          }),
          signal: abortRef.current.signal,
        });

        if (!response.ok || !response.body) {
          throw await readChatError(response, 'Failed to regenerate message');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const recordedFallbackFailures = new Set<string>();
        const processLine = (line: string) => {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) return;
          try {
            const data = JSON.parse(trimmed.slice(6));
            if (data.model) {
              finalModel = data.model;
            }
            if (data.content) {
              fullContent += data.content;
              streamDisplay?.append(data.content);
            }
            const rateLimitedModels = normalizeStringArray(data.rateLimitedModels);
            if (rateLimitedModels.length > 0) {
              onModelsRateLimited?.(
                rateLimitedModels,
                typeof data.retryAfterSeconds === 'number' ? data.retryAfterSeconds : undefined,
                targetMessage.taskType
              );
              for (const failedModel of rateLimitedModels) {
                recordedFallbackFailures.add(failedModel);
              }
            }
            for (const failedModel of normalizeStringArray(data.failedModels)) {
              if (recordedFallbackFailures.has(failedModel)) continue;
              recordedFallbackFailures.add(failedModel);
              onModelOutcome?.({ modelId: failedModel, taskType: targetMessage.taskType, outcome: 'failure' });
            }
          } catch {
            // skip malformed
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            processLine(line);
          }
        }
        buffer += decoder.decode();
        if (buffer.trim()) {
          processLine(buffer);
        }

        if (!fullContent.trim()) {
          throw new Error('The model returned an empty response. Please try again.');
        }

        const finalContentWithCitations = targetMessage.researchMode
          ? ensureResearchCitations(fullContent, targetMessage.searchResults)
          : fullContent;

        await streamDisplay?.finish(finalContentWithCitations);

        await storage.addMessage(conversationId, {
          role: 'assistant',
          content: finalContentWithCitations,
          model: finalModel,
          researchMode: targetMessage.researchMode,
          agentMode: targetMessage.agentMode,
          taskType: targetMessage.taskType,
          autoRouted: targetMessage.autoRouted,
          routingNote: targetMessage.routingNote,
          searchResults: targetMessage.searchResults,
          researchTrace: targetMessage.researchTrace,
        });
        onModelOutcome?.({
          modelId: finalModel,
          taskType: targetMessage.taskType,
          outcome: 'success',
          latencyMs: Date.now() - requestStartedAt,
        });

        const updatedMessages = await storage.getMessages(conversationId);
        setMessages(updatedMessages);
      } catch (err) {
        streamDisplay?.cancel();
        if ((err as Error).name === 'AbortError') {
          setMessages((prev) => prev.filter((m) => m.id !== assistantId));
          return;
        }
        const errorMessage = (err as Error).message || 'Failed to regenerate message';
        const details = parseChatErrorDetails(err);
        if (details.rateLimitedModels.length > 0) {
          onModelsRateLimited?.(details.rateLimitedModels, details.retryAfterSeconds, targetMessage.taskType);
        } else {
          onModelOutcome?.({ modelId: model, taskType: targetMessage.taskType, outcome: 'failure' });
        }

        const fallbackContent = buildClientResearchFallback(userMsg.content, targetMessage.searchResults, errorMessage);
        if (fallbackContent) {
          const storedFallback = await storage.addMessage(conversationId, {
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
          });
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? storedFallback
                : m
            )
          );
          return;
        }

        setError(errorMessage);
        const storedError = await storage.addMessage(conversationId, {
          role: 'assistant',
          content: errorMessage,
          model,
          researchMode: targetMessage.researchMode,
          agentMode: targetMessage.agentMode,
          taskType: targetMessage.taskType,
          autoRouted: targetMessage.autoRouted,
          routingNote: targetMessage.routingNote,
          searchResults: targetMessage.searchResults,
          researchTrace: targetMessage.researchTrace,
          isError: true,
        });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? storedError
              : m
          )
        );
      } finally {
        setIsStreaming(false);
        setResearchStatus(null);
        abortRef.current = null;
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
    researchStatus,
    error,
    sendMessage,
    stopStreaming,
    regenerateMessage,
    removeMessage,
    preferMessage,
  };
}

function buildResearchTrace(searchResults: SearchResponse | null): ResearchTrace | undefined {
  if (!searchResults?.results?.length) return undefined;
  return {
    query: searchResults.query,
    plannedQueries: searchResults.plannedQueries,
    plannedEntities: searchResults.plannedEntities,
    planner: searchResults.planner,
    provider: searchResults.provider,
    providers: searchResults.providers,
    providerErrors: searchResults.providerErrors,
    sourceCount: searchResults.results.length,
    openedCount: searchResults.results.filter((result) => result.extracted).length,
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

function buildClientResearchFallback(
  question: string,
  sources: Message['searchResults'],
  reason: string
): string | null {
  if (!sources?.length) return null;
  return buildResearchFallbackAnswer({
    question,
    sources,
    reason,
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
    cancel() {
      cancelled = true;
      if (timer) {
        window.clearTimeout(timer);
        timer = null;
      }
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

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('Request timed out. Please retry.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}
