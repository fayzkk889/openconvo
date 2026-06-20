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
const MIN_RESEARCH_REPORT_CHARS = 500;

export function extractArtifacts(messages: Message[]): ExtractedArtifact[] {
  const artifacts: ExtractedArtifact[] = [];

  for (const message of messages) {
    if (message.role !== 'assistant' || message.isError) continue;

    const researchArtifact = extractResearchReportArtifact(message);
    if (researchArtifact) {
      artifacts.push(researchArtifact);
    }

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

function extractResearchReportArtifact(message: Message): ExtractedArtifact | null {
  const sourceCount = message.searchResults?.length || 0;
  const openedCount = message.researchTrace?.openedCount || 0;
  const hasResearchEvidence = message.researchMode && sourceCount > 0;
  const isDeepResearch = message.taskType === 'deep-research';
  const isSubstantial = message.content.trim().length >= MIN_RESEARCH_REPORT_CHARS;

  if (!hasResearchEvidence || (!isDeepResearch && !isSubstantial)) {
    return null;
  }

  return {
    sourceKey: `${message.id}-research-report`,
    sourceMessageId: message.id,
    title: isDeepResearch ? 'Deep research report' : 'Research report',
    language: 'markdown',
    content: buildResearchReportContent(message, sourceCount, openedCount),
    createdAt: message.timestamp,
  };
}

function buildResearchReportContent(message: Message, sourceCount: number, openedCount: number): string {
  const lines = [
    message.content.trim(),
    '',
    '---',
    '',
    '## Research Evidence',
    '',
    `- Sources reviewed: ${sourceCount}`,
    `- Pages opened: ${openedCount}`,
  ];

  const providers = message.researchTrace?.providers || (message.researchTrace?.provider ? [message.researchTrace.provider] : []);
  if (providers.length > 0) {
    lines.push(`- Providers: ${providers.join(', ')}`);
  }

  if (message.researchTrace?.plannedQueries?.length) {
    lines.push('', '### Planned Queries', '');
    message.researchTrace.plannedQueries.forEach((query, index) => {
      lines.push(`${index + 1}. ${query}`);
    });
  }

  if (message.searchResults?.length) {
    lines.push('', '### Sources', '');
    message.searchResults.forEach((source, index) => {
      const quality = source.sourceLabel
        ? ` - ${source.sourceLabel}${typeof source.sourceScore === 'number' ? ` ${source.sourceScore}/100` : ''}`
        : '';
      lines.push(`${index + 1}. [${source.title}](${source.url})${quality}`);
      if (source.snippet) {
        lines.push(`   - ${source.snippet.slice(0, 240)}`);
      }
    });
  }

  return lines.join('\n').slice(0, 50000);
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
