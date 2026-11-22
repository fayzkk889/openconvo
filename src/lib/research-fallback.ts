import type { SearchResultRef } from '@/types/chat';
import type { SearchResult } from '@/types/search';
import { safeExternalUrl } from '@/lib/utils';

type FallbackSource = SearchResultRef | SearchResult;

/**
 * Step 11: Honest Research Degradation
 * Clearly labels locally constructed fallbacks as degraded.
 * Displays retrieved evidence accurately without hallucinating conclusions.
 */
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
    .filter((source) => source && source.title && source.url)
    .slice(0, 8);

  if (usefulSources.length === 0) {
    return [
      '> **Research Notice (No Sources Retrieved)**: Web research was attempted, but no usable external sources were returned by search providers. OpenConvo cannot ground this answer in verified evidence.',
      '',
      reason ? `**Failure reason:** ${reason}` : '',
      question ? `**Original question:** ${question}` : '',
      '',
      'Please verify your query, check your network connection or search API keys in Settings, or try again shortly.',
    ].filter(Boolean).join('\n');
  }

  const lines = [
    '> **Research Notice (Degraded Fallback)**: Upstream model synthesis failed or timed out. Below is a structured compilation of the retrieved evidence directly from search providers, presented without model interpretation.',
    '',
    reason ? `*Synthesis error: ${reason}*` : '',
    question ? `**Question:** ${question}` : '**Source-backed evidence brief**',
    '',
    '**Retrieved sources:**',
  ];

  usefulSources.forEach((source, index) => {
    const safeUrl = safeExternalUrl(source.url) || source.url;
    const snippet = cleanSnippet(source.content || source.snippet || '');
    const qualityLabel = source.sourceLabel ? ` (${source.sourceLabel})` : '';
    lines.push(`${index + 1}. [${source.title}](${safeUrl})${qualityLabel}${snippet ? `\n   > ${snippet}` : ''}`);
  });

  lines.push(
    '',
    '**Status Note:**',
    'OpenConvo successfully retrieved the web sources above, but the selected model could not synthesize a grounded answer. You can consult the source links directly or click "Retry" to attempt synthesis with another free model.'
  );

  return lines.join('\n');
}

function cleanSnippet(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}
