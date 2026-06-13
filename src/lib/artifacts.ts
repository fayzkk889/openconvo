import { Artifact, Conversation, Message } from '@/types/chat';

export interface ExtractedArtifact {
  sourceKey: string;
  sourceMessageId: string;
  title: string;
  language: string;
  content: string;
  createdAt: number;
}

const CODE_BLOCK_PATTERN = /```([a-zA-Z0-9_+.-]*)\n([\s\S]*?)```/g;

export function extractArtifacts(messages: Message[]): ExtractedArtifact[] {
  const artifacts: ExtractedArtifact[] = [];

  for (const message of messages) {
    if (message.role !== 'assistant' || message.isError) continue;

    let match: RegExpExecArray | null;
    let index = 0;
    CODE_BLOCK_PATTERN.lastIndex = 0;

    while ((match = CODE_BLOCK_PATTERN.exec(message.content)) !== null) {
      const language = match[1]?.trim() || 'text';
      const content = match[2]?.trim();
      if (!content || content.length < 80) continue;

      index += 1;
      artifacts.push({
        sourceKey: `${message.id}-${index}`,
        sourceMessageId: message.id,
        title: buildArtifactTitle(language, index),
        language,
        content,
        createdAt: message.timestamp,
      });
    }
  }

  return artifacts;
}

export function toStoredArtifact(
  extracted: ExtractedArtifact,
  conversation: Conversation
): Omit<Artifact, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    conversationId: conversation.id,
    projectId: conversation.projectId,
    sourceMessageId: extracted.sourceMessageId,
    sourceKey: extracted.sourceKey,
    title: extracted.title,
    language: extracted.language,
    content: extracted.content,
  };
}

function buildArtifactTitle(language: string, index: number): string {
  const label = language === 'text' ? 'Document' : language.toUpperCase();
  return `${label} artifact ${index}`;
}
