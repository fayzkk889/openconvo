import { StreamingChatEvent, TokenUsage } from '@/types/chat';

export interface OpenRouterDeltaChoice {
  delta?: {
    content?: string;
    reasoning?: string;
    role?: string;
  };
  finish_reason?: string | null;
  index?: number;
}

export interface OpenRouterStreamChunk {
  id?: string;
  model?: string;
  choices?: OpenRouterDeltaChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface ParsedOpenRouterChunk {
  content?: string;
  reasoning?: string;
  finishReason?: string | null;
  model?: string;
  usage?: TokenUsage;
  isDone?: boolean;
}

/**
 * Robust SSE buffer parser that handles:
 * 1. Byte-level/string-level chunk fragmentation across arbitrary boundaries.
 * 2. Multiple events packed into a single chunk.
 * 3. CRLF (\r\n) and LF (\n) normalization.
 * 4. Comments (:ping), whitespace lines, and malformed JSON lines.
 */
export class SseChunkParser {
  private buffer = '';

  /**
   * Push a raw text fragment into the buffer and return all complete raw event data strings.
   */
  feed(textChunk: string): string[] {
    this.buffer += textChunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const events: string[] = [];

    // SSE events are separated by double newline \n\n
    let boundaryIndex: number;
    while ((boundaryIndex = this.buffer.indexOf('\n\n')) !== -1) {
      const eventBlock = this.buffer.slice(0, boundaryIndex);
      this.buffer = this.buffer.slice(boundaryIndex + 2);

      const dataLines: string[] = [];
      const lines = eventBlock.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) {
          continue; // Comment or keepalive
        }
        if (trimmed.startsWith('data:')) {
          const payload = trimmed.slice(5).trim();
          if (payload) {
            dataLines.push(payload);
          }
        }
      }

      if (dataLines.length > 0) {
        events.push(dataLines.join('\n'));
      }
    }

    return events;
  }

  /**
   * Flush any remaining data at the end of the stream.
   */
  flush(): string[] {
    const remaining = this.buffer.trim();
    this.buffer = '';
    if (!remaining) return [];

    const dataLines: string[] = [];
    for (const line of remaining.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;
      if (trimmed.startsWith('data:')) {
        const payload = trimmed.slice(5).trim();
        if (payload) dataLines.push(payload);
      }
    }
    return dataLines.length > 0 ? [dataLines.join('\n')] : [];
  }
}

/**
 * Parse an OpenRouter upstream SSE data payload.
 */
export function parseOpenRouterPayload(payload: string): ParsedOpenRouterChunk | null {
  if (payload === '[DONE]') {
    return { isDone: true };
  }

  try {
    const parsed = JSON.parse(payload) as OpenRouterStreamChunk;
    const choice = parsed.choices?.[0];
    const content = choice?.delta?.content ?? undefined;
    const reasoning = choice?.delta?.reasoning ?? undefined;
    const finishReason = choice?.finish_reason ?? null;
    const model = parsed.model;

    let usage: TokenUsage | undefined;
    if (parsed.usage) {
      usage = {
        promptTokens: parsed.usage.prompt_tokens,
        completionTokens: parsed.usage.completion_tokens,
        totalTokens: parsed.usage.total_tokens,
      };
    }

    return {
      content: typeof content === 'string' ? content : undefined,
      reasoning: typeof reasoning === 'string' ? reasoning : undefined,
      finishReason,
      model,
      usage,
      isDone: false,
    };
  } catch {
    return null;
  }
}

/**
 * Parse an internal OpenConvo typed streaming event payload.
 */
export function parseOpenConvoPayload(payload: string): StreamingChatEvent | null {
  try {
    const data = JSON.parse(payload);
    if (!data || typeof data !== 'object' || typeof data.type !== 'string') {
      // Legacy backward compatibility format: { content, model }
      if (typeof data.content === 'string') {
        return {
          type: 'delta',
          content: data.content,
          model: typeof data.model === 'string' ? data.model : undefined,
        };
      }
      return null;
    }
    return data as StreamingChatEvent;
  } catch {
    return null;
  }
}

export interface StreamConsumerCallbacks {
  onMeta?: (meta: Extract<StreamingChatEvent, { type: 'meta' }>) => void;
  onDelta?: (delta: Extract<StreamingChatEvent, { type: 'delta' }>) => void;
  onFallback?: (fallback: Extract<StreamingChatEvent, { type: 'fallback' }>) => void;
  onComplete?: (complete: Extract<StreamingChatEvent, { type: 'complete' }>) => void;
  onInterrupted?: (interrupted: Extract<StreamingChatEvent, { type: 'interrupted' }>) => void;
  onError?: (error: Extract<StreamingChatEvent, { type: 'error' }>) => void;
  onResearchFallback?: (rf: Extract<StreamingChatEvent, { type: 'research_fallback' }>) => void;
}

export interface StreamConsumptionResult {
  fullContent: string;
  finalModel: string;
  status: 'complete' | 'interrupted' | 'failed' | 'degraded';
  finishReason?: string;
  tokenUsage?: TokenUsage;
  errorMessage?: string;
  rateLimitedModels: string[];
  failedModels: string[];
  retryAfterSeconds?: number;
}

/**
 * Shared, robust consumer for /api/chat SSE streams.
 * Used identically by sendMessage and regenerateMessage in useChat.
 */
export async function consumeChatStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  fallbackModel: string,
  callbacks?: StreamConsumerCallbacks
): Promise<StreamConsumptionResult> {
  const decoder = new TextDecoder();
  const parser = new SseChunkParser();

  let fullContent = '';
  let finalModel = fallbackModel;
  let status: StreamConsumptionResult['status'] = 'complete';
  let finishReason: string | undefined;
  let tokenUsage: TokenUsage | undefined;
  let errorMessage: string | undefined;
  const rateLimitedModels: string[] = [];
  const failedModels: string[] = [];
  let retryAfterSeconds: number | undefined;

  let terminalReceived = false;

  const handleEvent = (event: StreamingChatEvent) => {
    switch (event.type) {
      case 'meta':
        finalModel = event.model;
        callbacks?.onMeta?.(event);
        break;

      case 'delta':
        if (event.content) {
          fullContent += event.content;
          if (event.model) finalModel = event.model;
          callbacks?.onDelta?.(event);
        }
        break;

      case 'fallback':
        if (event.toModel) finalModel = event.toModel;
        if (event.fromModel && !failedModels.includes(event.fromModel)) {
          failedModels.push(event.fromModel);
        }
        if (event.rateLimitedModels) {
          for (const m of event.rateLimitedModels) {
            if (!rateLimitedModels.includes(m)) rateLimitedModels.push(m);
          }
        }
        if (event.retryAfterSeconds) {
          retryAfterSeconds = event.retryAfterSeconds;
        }
        callbacks?.onFallback?.(event);
        break;

      case 'complete':
        terminalReceived = true;
        if (event.model) finalModel = event.model;
        finishReason = event.finishReason;
        if (event.usage) tokenUsage = event.usage;
        status = 'complete';
        callbacks?.onComplete?.(event);
        break;

      case 'interrupted':
        terminalReceived = true;
        if (event.model) finalModel = event.model;
        if (event.partialContent && !fullContent) {
          fullContent = event.partialContent;
        }
        finishReason = event.finishReason;
        status = 'interrupted';
        errorMessage = event.reason;
        callbacks?.onInterrupted?.(event);
        break;

      case 'research_fallback':
        terminalReceived = true;
        if (event.model) finalModel = event.model;
        fullContent = event.content;
        status = 'degraded';
        errorMessage = event.reason;
        callbacks?.onResearchFallback?.(event);
        break;

      case 'error':
        terminalReceived = true;
        status = 'failed';
        errorMessage = event.error;
        if (event.model) finalModel = event.model;
        if (event.failedModels) {
          for (const m of event.failedModels) {
            if (!failedModels.includes(m)) failedModels.push(m);
          }
        }
        if (event.rateLimitedModels) {
          for (const m of event.rateLimitedModels) {
            if (!rateLimitedModels.includes(m)) rateLimitedModels.push(m);
          }
        }
        if (event.retryAfterSeconds) {
          retryAfterSeconds = event.retryAfterSeconds;
        }
        callbacks?.onError?.(event);
        break;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const events = parser.feed(chunk);
      for (const payload of events) {
        const parsed = parseOpenConvoPayload(payload);
        if (parsed) {
          handleEvent(parsed);
        }
      }
    }

    const remaining = parser.flush();
    for (const payload of remaining) {
      const parsed = parseOpenConvoPayload(payload);
      if (parsed) {
        handleEvent(parsed);
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Reader lock may already be released
    }
  }

  // If the stream ended without a terminal event:
  // A stream that closes without [DONE] or a typed terminal event is an
  // interrupted connection — even if content was received — because the server
  // never confirmed successful completion. Marking it 'complete' is semantically
  // incorrect and misleads users and reliability tracking.
  if (!terminalReceived) {
    if (fullContent.trim()) {
      status = 'interrupted';
      finishReason = 'stream_closed';
      errorMessage = 'Stream ended without a completion confirmation (possible server drop).';
    } else {
      status = 'failed';
      errorMessage = 'Stream ended unexpectedly without content.';
    }
  }

  return {
    fullContent,
    finalModel,
    status,
    finishReason,
    tokenUsage,
    errorMessage,
    rateLimitedModels,
    failedModels,
    retryAfterSeconds,
  };
}
