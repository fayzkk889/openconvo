import type { Attachment, Message, MessageStatus } from '@/types/chat';

export type ApiChatMessage = { role: 'user' | 'assistant'; content: string };

/**
 * Build the model-facing history: drop failed and empty messages and collapse
 * compare-mode siblings to the preferred (or last) answer.
 */
export function buildApiMessages(
  history: Message[],
  currentPromptId?: string,
  currentPromptContent?: string,
  attachments?: Attachment[]
): ApiChatMessage[] {
  const valid = history.filter((m) => !m.isError && m.content && m.content.trim().length > 0);

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

/**
 * History for regenerating `targetMessageId`: everything strictly before it.
 * The answer being replaced, and anything after it, must never be sent back to
 * the model, otherwise the request ends on an assistant turn and the model
 * continues or paraphrases the old answer instead of producing a new one.
 */
export function historyBeforeMessage(history: Message[], targetMessageId: string, fallbackIndex: number): Message[] {
  const index = history.findIndex((m) => m.id === targetMessageId);
  return history.slice(0, index >= 0 ? index : fallbackIndex);
}

/**
 * A regeneration only replaces the stored answer when it completed. Interrupted,
 * degraded, or failed attempts leave the previous answer in place.
 */
export function shouldReplaceOnRegenerate(status: MessageStatus | undefined): boolean {
  return status === 'complete';
}

/**
 * Attachments as sent to /api/chat. Parsed document records and chunks stay
 * local: the server only reads the bounded `content` preview, and retrieval
 * sends the relevant excerpts separately.
 */
export function toWireAttachments(attachments?: Attachment[]): Attachment[] | undefined {
  if (!attachments?.length) return undefined;
  return attachments.map(({ documentRecord: _record, chunks: _chunks, ...rest }) => rest);
}

export function withAttachmentCue(content: string, attachments?: Attachment[]): string {
  if (!attachments?.length) return content;
  const names = attachments.map((attachment) => attachment.name).join(', ');
  return `${content}\n\n[Current message attachments: ${names}]`;
}
