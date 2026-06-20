import type { SearchResultRef } from '@/types/chat';
import type { SearchResult } from '@/types/search';

type FallbackSource = SearchResultRef | SearchResult;

export function buildResearchFallbackAnswer({
  question,
  sources,
  reason,
}: {
  question: string;
  sources?: FallbackSource[];
  reason?: string;
}): string {
  const usefulSources = (sources || [])
    .filter((source) => source.title && source.url)
    .slice(0, 6);

  if (usefulSources.length === 0) {
    return reason || 'I could not produce a reliable answer from the available sources. Please retry or choose another free model.';
  }

  const lines = [
    reason
      ? `I found web sources, but the model synthesis failed: ${reason}`
      : 'I found web sources, but the model returned an empty synthesis. Here is a source-backed fallback so you are not left with a dead response.',
    '',
    question ? `**Question:** ${question}` : '**Source-backed fallback**',
    '',
    '**Best available sources:**',
  ];

  usefulSources.forEach((source, index) => {
    const snippet = cleanSnippet(source.content || source.snippet || '');
    lines.push(`${index + 1}. [${source.title}](${source.url})${snippet ? ` - ${snippet}` : ''}`);
  });

  lines.push(
    '',
    '**What this means:**',
    'The app successfully reached web research, but the selected free model/provider did not return a usable final answer. Use the sources above for the latest details, or press Retry to ask another free model to synthesize them.'
  );

  return lines.join('\n');
}

function cleanSnippet(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 260);
}
