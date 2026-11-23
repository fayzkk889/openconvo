import type { SearchResultRef } from '@/types/chat';
import type { SearchResult } from '@/types/search';
import { safeExternalUrl } from '@/lib/utils';

type CitationSource = SearchResultRef | SearchResult;

export interface CitationValidationResult {
  validIndices: number[];
  unknownIndices: number[];
  citedSources: CitationSource[];
  hasFabricatedCitations: boolean;
  totalCitations: number;
}

/**
 * Step 10: Citation Integrity & Verification
 * Extracts bracket references [1], [2], [1, 2], [1]-[3] and validates them
 * strictly against the actual provided evidence sources.
 */
export function validateCitationReferences(
  content: string,
  sources?: CitationSource[]
): CitationValidationResult {
  const availableSources = sources || [];
  const maxIndex = availableSources.length;
  const validSet = new Set<number>();
  const unknownSet = new Set<number>();
  let totalCitations = 0;

  // Match bracket numbers like [1], [2], [1, 3], [1-3]
  const bracketMatches = content.matchAll(/\[(\d+(?:\s*[,-]\s*\d+)*)\]/g);

  for (const match of bracketMatches) {
    const rawTokens = match[1].split(/[,-\s]+/).filter(Boolean);
    for (const token of rawTokens) {
      const idx = parseInt(token, 10);
      if (!Number.isFinite(idx)) continue;
      totalCitations += 1;
      if (idx >= 1 && idx <= maxIndex) {
        validSet.add(idx);
      } else {
        unknownSet.add(idx);
      }
    }
  }

  const validIndices = Array.from(validSet).sort((a, b) => a - b);
  const unknownIndices = Array.from(unknownSet).sort((a, b) => a - b);
  const citedSources = validIndices.map((idx) => availableSources[idx - 1]).filter(Boolean);

  return {
    validIndices,
    unknownIndices,
    citedSources,
    hasFabricatedCitations: unknownIndices.length > 0,
    totalCitations,
  };
}

/**
 * Ensures research answers have cleanly formatted, non-duplicated source references.
 * Never corrupts or slices the main content.
 */
export function ensureResearchCitations(content: string, sources?: CitationSource[]): string {
  const usefulSources = (sources || [])
    .filter((source) => source && source.title && source.url)
    .slice(0, 8);

  const cleanedContent = stripSourcesSections(content).trim();
  if (!cleanedContent || usefulSources.length === 0) {
    return cleanedContent || content;
  }

  return `${cleanedContent}\n\n${buildSourcesSection(usefulSources, cleanedContent)}`;
}

export function buildSourcesAppendixIfMissing(content: string, sources?: CitationSource[]): string | null {
  if (!content || !content.trim()) return null;
  const usefulSources = (sources || [])
    .filter((source) => source && source.title && source.url)
    .slice(0, 8);
  if (usefulSources.length === 0) return null;

  // If content already contains a sources section, do not append a duplicate
  if (hasSourcesSection(content)) {
    return null;
  }

  return `\n\n${buildSourcesSection(usefulSources, content)}`;
}

export function buildSourcesSection(sources: CitationSource[], content?: string): string {
  const usefulSources = sources.slice(0, 8);
  if (content) {
    const validation = validateCitationReferences(content, usefulSources);
    const citedSet = new Set(validation.validIndices);
    const cited: string[] = [];
    const uncited: string[] = [];
    usefulSources.forEach((source, index) => {
      const idx = index + 1;
      const safeUrl = safeExternalUrl(source.url) || source.url;
      const label = source.sourceLabel ? ` - ${source.sourceLabel}` : '';
      const line = `${idx}. [${cleanTitle(source.title)}](${safeUrl})${label}`;
      if (citedSet.has(idx)) {
        cited.push(line);
      } else {
        uncited.push(line);
      }
    });

    if (cited.length > 0 && uncited.length > 0) {
      return `**Cited Sources**\n${cited.join('\n')}\n\n**Additional Retrieved Sources**\n${uncited.join('\n')}`;
    }
  }

  const lines = ['**Sources**'];
  usefulSources.forEach((source, index) => {
    const safeUrl = safeExternalUrl(source.url) || source.url;
    const label = source.sourceLabel ? ` - ${source.sourceLabel}` : '';
    lines.push(`${index + 1}. [${cleanTitle(source.title)}](${safeUrl})${label}`);
  });
  return lines.join('\n');
}

export function stripSourcesSections(content: string): string {
  return content
    .replace(/(?:\n|^)(?:#{1,3}\s*)?(?:\*\*)?\s*(?:sources|references|citations|cited sources|additional retrieved sources)\s*(?:\*\*)?\s*\n[\s\S]*$/i, '')
    .trim();
}

export function hasSourcesSection(content: string): boolean {
  return /(?:\n|^)(?:#{1,3}\s*)?(?:\*\*)?\s*(?:sources|references|citations|cited sources|additional retrieved sources)\s*(?:\*\*)?\s*\n/i.test(content);
}

function cleanTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim().slice(0, 160) || 'Source';
}
