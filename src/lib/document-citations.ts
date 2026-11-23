import { DocumentExcerpt, DocumentCitationValidation } from '@/types/document';

/**
 * Step 8: Document Citation Integrity
 * Parses, validates, and formats structured document citations like [D1:p4], [D1:L20-L45], [D2:c3].
 * Completely distinct from web evidence citations [1], [2].
 */
export function validateDocumentCitations(
  content: string,
  excerpts: DocumentExcerpt[] = []
): DocumentCitationValidation {
  const availableSet = new Map<string, DocumentExcerpt>();
  for (const excerpt of excerpts) {
    availableSet.set(excerpt.citationId.toLowerCase(), excerpt);
  }

  const validCitations: string[] = [];
  const unknownCitations: string[] = [];
  const citedExcerptMap = new Map<string, DocumentExcerpt>();
  let totalCitations = 0;

  // Match bracket document references like [D1:p4], [D1:p4.1], [D2:L20-L45], [D1:c3]
  const docCitationRegex = /\[(D\d+:(?:p\d+(?:\.\d+)?|L\d+-L\d+|c\d+))\]/gi;
  const matches = content.matchAll(docCitationRegex);

  for (const match of matches) {
    const rawId = match[1];
    const key = rawId.toLowerCase();
    totalCitations++;

    if (availableSet.has(key)) {
      if (!validCitations.includes(rawId)) {
        validCitations.push(rawId);
      }
      const exc = availableSet.get(key)!;
      citedExcerptMap.set(exc.chunkId, exc);
    } else {
      if (!unknownCitations.includes(rawId)) {
        unknownCitations.push(rawId);
      }
    }
  }

  return {
    validCitations,
    unknownCitations,
    citedExcerpts: Array.from(citedExcerptMap.values()),
    hasFabricatedCitations: unknownCitations.length > 0,
    totalCitations,
  };
}

/**
 * Builds a structured document sources appendix.
 * If content is provided, distinguishes cited excerpts from additional retrieved excerpts.
 */
export function buildDocumentSourcesSection(
  excerpts: DocumentExcerpt[] = [],
  content?: string
): string {
  if (excerpts.length === 0) return '';

  const validation = content ? validateDocumentCitations(content, excerpts) : null;
  const citedSet = new Set(validation?.validCitations.map((c) => c.toLowerCase()) || []);

  const citedLines: string[] = [];
  const additionalLines: string[] = [];

  for (const excerpt of excerpts) {
    const details: string[] = [];
    if (excerpt.pageNumber) {
      details.push(`Page ${excerpt.pageNumber}`);
    }
    if (excerpt.startLine && excerpt.endLine) {
      details.push(`Lines ${excerpt.startLine}-${excerpt.endLine}`);
    }
    if (excerpt.sectionHeading) {
      details.push(`Section: ${cleanSectionHeading(excerpt.sectionHeading)}`);
    }

    const detailText = details.length > 0 ? ` (${details.join(', ')})` : '';
    const line = `- **[${excerpt.citationId}]** ${excerpt.filename}${detailText}`;

    if (citedSet.has(excerpt.citationId.toLowerCase())) {
      if (!citedLines.includes(line)) citedLines.push(line);
    } else {
      if (!additionalLines.includes(line)) additionalLines.push(line);
    }
  }

  if (citedLines.length > 0 && additionalLines.length > 0) {
    return `**Cited Document Sources**\n${citedLines.join('\n')}\n\n**Additional Document Context**\n${additionalLines.join('\n')}`;
  }

  const allLines = [...citedLines, ...additionalLines];
  return `**Document Sources**\n${allLines.join('\n')}`;
}

export function buildDocumentAppendixIfMissing(
  content: string,
  excerpts: DocumentExcerpt[] = []
): string | null {
  if (!content || !content.trim() || excerpts.length === 0) return null;
  if (hasDocumentSourcesSection(content)) return null;

  const section = buildDocumentSourcesSection(excerpts, content);
  return section ? `\n\n${section}` : null;
}

export function hasDocumentSourcesSection(content: string): boolean {
  return /(?:\n|^)(?:#{1,3}\s*)?(?:\*\*)?\s*(?:document sources|cited document sources)\s*(?:\*\*)?\s*\n/i.test(content);
}

export function stripDocumentSourcesSection(content: string): string {
  return content
    .replace(/(?:\n|^)(?:#{1,3}\s*)?(?:\*\*)?\s*(?:document sources|cited document sources)\s*(?:\*\*)?\s*\n[\s\S]*$/i, '')
    .trim();
}

function cleanSectionHeading(heading: string): string {
  return heading.replace(/\s+/g, ' ').trim().slice(0, 60);
}
