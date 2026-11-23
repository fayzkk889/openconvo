import type { Message } from '@/types/chat';

export interface ContextUsage {
  estimatedTokens: number;
  contextLength: number;
  ratio: number;
  label: 'low' | 'medium' | 'high';
}

const CHARS_PER_TOKEN = 4;

export function estimateContextUsage(
  messages: Message[],
  contextLength = 4096
): ContextUsage {
  const validMessages = messages.filter((m) => !m.isError && m.content && m.content.trim().length > 0);
  const totalChars = validMessages.reduce((sum, message) => {
    const attachmentChars = (message.attachments || []).reduce(
      (attachmentSum, attachment) => attachmentSum + attachment.content.length,
      0
    );
    return sum + message.content.length + attachmentChars;
  }, 0);

  const estimatedTokens = Math.ceil(totalChars / CHARS_PER_TOKEN);
  const safeContextLength = Math.max(contextLength, 1);
  const ratio = Math.min(estimatedTokens / safeContextLength, 1);

  return {
    estimatedTokens,
    contextLength: safeContextLength,
    ratio,
    label: ratio >= 0.8 ? 'high' : ratio >= 0.55 ? 'medium' : 'low',
  };
}

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

export interface ContextMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export function selectBoundedContext(
  rawMessages: unknown[],
  maxMessages = 100,
  maxMessageChars = 50000,
  contextTokenLimit?: number
): ContextMessage[] {
  const parsed: ContextMessage[] = [];
  for (const item of rawMessages) {
    if (!item || typeof item !== 'object') {
      throw new Error('Invalid message');
    }
    const msg = item as Record<string, unknown>;
    if (!['user', 'assistant', 'system'].includes(String(msg.role)) || typeof msg.content !== 'string') {
      throw new Error('Invalid message');
    }
    if (!msg.content.trim()) continue;
    parsed.push({
      role: msg.role as ContextMessage['role'],
      content: msg.content.slice(0, maxMessageChars),
    });
  }

  // 1. Bound by message count
  let selected = parsed;
  if (selected.length > maxMessages) {
    const lastUserIndex = selected.findLastIndex((m) => m.role === 'user');
    let startIdx = Math.max(0, selected.length - maxMessages);
    if (startIdx < selected.length && selected[startIdx].role === 'assistant') {
      startIdx += 1;
    }
    const truncated = selected.slice(startIdx);
    if (lastUserIndex !== -1 && !truncated.includes(selected[lastUserIndex])) {
      truncated.push(selected[lastUserIndex]);
    }
    selected = truncated;
  }

  // 2. Bound by token / character budget if contextTokenLimit is provided
  if (contextTokenLimit && contextTokenLimit > 0) {
    const maxChars = Math.max((contextTokenLimit - 2000) * CHARS_PER_TOKEN, 4000);
    let totalChars = selected.reduce((sum, m) => sum + m.content.length, 0);

    if (totalChars > maxChars && selected.length > 1) {
      const lastUserIndex = selected.findLastIndex((m) => m.role === 'user');
      const lastUser = lastUserIndex !== -1 ? selected[lastUserIndex] : null;

      const bounded: ContextMessage[] = [];
      let currentChars = 0;

      // Work backwards from last message
      for (let i = selected.length - 1; i >= 0; i--) {
        const msg = selected[i];
        if (currentChars + msg.content.length > maxChars) {
          break;
        }
        currentChars += msg.content.length;
        bounded.unshift(msg);
      }

      // If the latest user message was truncated away, ensure it is preserved!
      if (lastUser && !bounded.includes(lastUser)) {
        bounded.push(lastUser);
      }

      // Ensure we don't start with an orphaned assistant message
      if (bounded.length > 0 && bounded[0].role === 'assistant') {
        bounded.shift();
      }

      selected = bounded;
    }
  }

  return selected;
}
