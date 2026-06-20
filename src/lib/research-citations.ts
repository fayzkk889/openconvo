import type { SearchResultRef } from '@/types/chat';
import type { SearchResult } from '@/types/search';

type CitationSource = SearchResultRef | SearchResult;

export function ensureResearchCitations(content: string, sources?: CitationSource[]): string {
  const usefulSources = (sources || [])
    .filter((source) => source.title && source.url)
    .slice(0, 6);

  if (!content.trim() || usefulSources.length === 0 || hasRealSourceLinks(content, usefulSources)) {
    return content;
  }

  return `${content.trim()}\n\n${buildSourcesSection(usefulSources)}`;
}

export function buildSourcesSection(sources: CitationSource[]): string {
  const lines = ['**Sources**'];
  sources.slice(0, 6).forEach((source, index) => {
    const label = source.sourceLabel ? ` - ${source.sourceLabel}` : '';
    lines.push(`${index + 1}. [${cleanTitle(source.title)}](${source.url})${label}`);
  });
  return lines.join('\n');
}

function hasSourcesSection(content: string): boolean {
  return /(^|\n)#{0,3}\s*(sources|references|citations)\s*($|\n)/i.test(content);
}

function hasRealSourceLinks(content: string, sources: CitationSource[]): boolean {
  if (!hasSourcesSection(content)) return false;
  return sources.some((source) => content.includes(source.url));
}

function cleanTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim().slice(0, 160) || 'Source';
}
