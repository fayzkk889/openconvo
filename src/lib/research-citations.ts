import type { SearchResultRef } from '@/types/chat';
import type { SearchResult } from '@/types/search';

type CitationSource = SearchResultRef | SearchResult;

export function ensureResearchCitations(content: string, sources?: CitationSource[]): string {
  const usefulSources = (sources || [])
    .filter((source) => source.title && source.url)
    .slice(0, 6);

  const cleanedContent = stripSourcesSections(content).trim();
  if (!cleanedContent || usefulSources.length === 0) {
    return cleanedContent || content;
  }

  return `${cleanedContent}\n\n${buildSourcesSection(usefulSources)}`;
}

export function buildSourcesSection(sources: CitationSource[]): string {
  const lines = ['**Sources**'];
  sources.slice(0, 6).forEach((source, index) => {
    const label = source.sourceLabel ? ` - ${source.sourceLabel}` : '';
    lines.push(`${index + 1}. [${cleanTitle(source.title)}](${source.url})${label}`);
  });
  return lines.join('\n');
}

function stripSourcesSections(content: string): string {
  return content
    .replace(/(?:\n|^)(?:#{1,3}\s*)?(?:\*\*)?\s*(sources|references|citations)\s*(?:\*\*)?\s*\n[\s\S]*$/i, '')
    .trim();
}

function cleanTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim().slice(0, 160) || 'Source';
}
