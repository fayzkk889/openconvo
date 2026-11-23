import type { Message } from '@/types/chat';

/**
 * A short, user-facing note for assistant answers that did not complete
 * normally. Partial, truncated, and fallback answers must not look identical
 * to a finished answer.
 */
export function messageStatusNotice(message: Pick<Message, 'role' | 'status' | 'finishReason' | 'isError'>): string | null {
  if (message.role !== 'assistant' || message.isError) return null;

  if (message.status === 'interrupted') {
    return message.finishReason === 'cancelled'
      ? 'Stopped before the answer finished.'
      : 'The model connection ended early, so this answer may be incomplete.';
  }
  if (message.status === 'degraded') {
    return 'No model could answer, so this is a list of the retrieved sources rather than a synthesized answer.';
  }
  if (message.finishReason === 'length') {
    return 'The model reached its output limit, so this answer is cut off.';
  }
  return null;
}
