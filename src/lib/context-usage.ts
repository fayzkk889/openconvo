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
  const totalChars = messages.reduce((sum, message) => {
    const attachmentChars = (message.attachments || []).reduce(
      (attachmentSum, attachment) => attachmentSum + attachment.content.length,
      0
    );
    const sourceChars = (message.searchResults || []).reduce(
      (sourceSum, source) => sourceSum + source.title.length + source.snippet.length + source.url.length,
      0
    );
    return sum + message.content.length + attachmentChars + sourceChars;
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
