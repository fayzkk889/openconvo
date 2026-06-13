'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Message, Attachment } from '@/types/chat';
import { AIModel } from '@/types/models';
import { SearchResponse } from '@/types/search';
import * as storage from '@/lib/storage';
import { generateId } from '@/lib/utils';

export function useChat(
  conversationId: string | null,
  model: string,
  systemPrompt: string,
  openrouterApiKey?: string,
  tavilyApiKey?: string,
  models: AIModel[] = [],
  onModelsRateLimited?: (modelIds: string[], retryAfterSeconds?: number) => void
) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
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
      onTitleGenerated,
    }: {
      content: string;
      attachments?: Attachment[];
      searchEnabled?: boolean;
      researchEnabled?: boolean;
      agentEnabled?: boolean;
      onTitleGenerated?: (title: string) => void;
    }) => {
      if (!conversationId || !content.trim()) return;

      setError(null);

      // Save user message
      const userMessage = await storage.addMessage(conversationId, {
        role: 'user',
        content: content.trim(),
        model,
        attachments: attachments?.length ? attachments : undefined,
      });

      setMessages((prev) => [...prev, userMessage]);

      // Perform web search if enabled
      let searchResults: SearchResponse | null = null;
      if (searchEnabled || researchEnabled) {
        try {
          const searchRes = await fetch('/api/search', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(tavilyApiKey ? { 'x-tavily-key': tavilyApiKey } : {}),
            },
            body: JSON.stringify({ query: content.trim(), mode: researchEnabled ? 'research' : 'search' }),
          });
          if (searchRes.ok) {
            searchResults = await searchRes.json();
          } else {
            const err = await searchRes.json().catch(() => ({}));
            setError(err.error || 'Search failed; continuing without web results');
          }
        } catch (err) {
          console.error('Search failed:', err);
          setError('Search failed; continuing without web results');
        }
      }

      // Create placeholder assistant message
      const assistantId = generateId();
      const placeholderMessage: Message = {
        id: assistantId,
        conversationId,
        role: 'assistant',
        content: '',
        model,
        researchMode: researchEnabled === true,
        agentMode: agentEnabled === true,
        searchResults: searchResults?.results?.map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet,
        })),
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, placeholderMessage]);
      setIsStreaming(true);

      // Prepare messages for API
      const currentMessages = await storage.getMessages(conversationId);
      const apiMessages = currentMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.id === userMessage.id
          ? withAttachmentCue(m.content, attachments)
          : m.content,
      }));

      try {
        abortRef.current = new AbortController();
        let fullContent = '';
        let finalModel = model;

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
            searchResults: searchResults?.results,
            attachments,
            researchMode: researchEnabled === true,
            agentMode: agentEnabled === true,
          }),
          signal: abortRef.current.signal,
        });

        if (!response.ok || !response.body) {
          throw await readChatError(response, 'Failed to send message');
        }

        // Stream the response
        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response stream');

        const decoder = new TextDecoder();
        let buffer = '';
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
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: fullContent, model: finalModel }
                    : m
                )
              );
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

        // Save the complete assistant message
        await storage.addMessage(conversationId, {
          role: 'assistant',
          content: fullContent,
          model: finalModel,
          researchMode: researchEnabled === true,
          agentMode: agentEnabled === true,
          searchResults: placeholderMessage.searchResults,
        });

        // Remove the placeholder and reload from DB for consistency
        const updatedMessages = await storage.getMessages(conversationId);
        setMessages(updatedMessages);

        // Generate title if this is the first exchange
        if (currentMessages.length <= 1 && onTitleGenerated) {
          if (!openrouterApiKey) {
            onTitleGenerated(buildLocalTitle(content.trim()));
            return;
          }
          try {
            const titleRes = await fetch('/api/chat', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(openrouterApiKey ? { 'x-openrouter-key': openrouterApiKey } : {}),
              },
              body: JSON.stringify({
                messages: [
                  { role: 'user', content: withAttachmentCue(content.trim(), attachments) },
                  { role: 'assistant', content: fullContent.slice(0, 500) },
                ],
                model,
                generateTitleFor: true,
              }),
            });
            if (titleRes.ok) {
              const { title } = await titleRes.json();
              const cleanTitle = typeof title === 'string' ? title.trim() : '';
              if (cleanTitle && cleanTitle !== 'New conversation') onTitleGenerated(cleanTitle);
            }
          } catch {
            // Title generation failure is non-critical
          }
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          setMessages((prev) => prev.filter((m) => m.id !== assistantId));
          return;
        }
        const errorMessage = (err as Error).message || 'Failed to get response';
        const details = parseChatErrorDetails(err);
        if (details.rateLimitedModels.length > 0) {
          onModelsRateLimited?.(details.rateLimitedModels, details.retryAfterSeconds);
        }
        setError(errorMessage);
        const storedError = await storage.addMessage(conversationId, {
          role: 'assistant',
          content: errorMessage,
          model,
          researchMode: researchEnabled === true,
          agentMode: agentEnabled === true,
          searchResults: placeholderMessage.searchResults,
          isError: true,
        });
        // Update the placeholder with error state
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? storedError
              : m
          )
        );
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [conversationId, model, systemPrompt, openrouterApiKey, tavilyApiKey, models, onModelsRateLimited]
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
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

      const assistantId = generateId();
      const placeholderMessage: Message = {
        id: assistantId,
        conversationId,
        role: 'assistant',
        content: '',
        model,
        researchMode: targetMessage.researchMode,
        agentMode: targetMessage.agentMode,
        searchResults: targetMessage.searchResults,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev.slice(0, msgIndex), placeholderMessage]);
      setIsStreaming(true);

      try {
        abortRef.current = new AbortController();
        let fullContent = '';
        let finalModel = model;

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
          }),
          signal: abortRef.current.signal,
        });

        if (!response.ok || !response.body) {
          throw await readChatError(response, 'Failed to regenerate message');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
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
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: fullContent, model: finalModel }
                    : m
                )
              );
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

        await storage.addMessage(conversationId, {
          role: 'assistant',
          content: fullContent,
          model: finalModel,
          researchMode: targetMessage.researchMode,
          agentMode: targetMessage.agentMode,
          searchResults: targetMessage.searchResults,
        });

        const updatedMessages = await storage.getMessages(conversationId);
        setMessages(updatedMessages);
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          setMessages((prev) => prev.filter((m) => m.id !== assistantId));
          return;
        }
        const errorMessage = (err as Error).message || 'Failed to regenerate message';
        const details = parseChatErrorDetails(err);
        if (details.rateLimitedModels.length > 0) {
          onModelsRateLimited?.(details.rateLimitedModels, details.retryAfterSeconds);
        }
        setError(errorMessage);
        const storedError = await storage.addMessage(conversationId, {
          role: 'assistant',
          content: errorMessage,
          model,
          researchMode: targetMessage.researchMode,
          agentMode: targetMessage.agentMode,
          searchResults: targetMessage.searchResults,
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
        abortRef.current = null;
      }
    },
    [conversationId, messages, model, systemPrompt, openrouterApiKey, models, onModelsRateLimited]
  );

  const removeMessage = useCallback(
    async (messageId: string) => {
      await storage.deleteMessage(messageId);
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
    },
    []
  );

  return {
    messages,
    isStreaming,
    error,
    sendMessage,
    stopStreaming,
    regenerateMessage,
    removeMessage,
  };
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

function buildLocalTitle(content: string): string {
  const words = content
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[`*_#[\](){}>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 6)
    .join(' ');

  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'New conversation';
}
