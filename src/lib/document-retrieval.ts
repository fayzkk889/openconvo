import { DocumentChunk, DocumentExcerpt, DocumentRetrievalOptions, DocumentRetrievalResult, DocumentRecord } from '@/types/document';

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
  'to', 'was', 'were', 'will', 'with', 'about', 'can', 'could',
  'does', 'do', 'how', 'what', 'when', 'where', 'which', 'who', 'why',
]);

const BM25_K1 = 1.2;
const BM25_B = 0.75;
const DEFAULT_TOP_K = 6;
const DEFAULT_MAX_TOKENS = 3500;

/**
 * Native lightweight lexical retrieval engine supporting BM25, exact phrase matching,
 * code identifier lookup, multi-document balancing, and document-wide summarization.
 */
export function retrieveDocumentExcerpts({
  query,
  chunks,
  documents,
  options = {},
}: {
  query: string;
  chunks: DocumentChunk[];
  documents?: DocumentRecord[];
  options?: DocumentRetrievalOptions;
}): DocumentRetrievalResult {
  if (!chunks || chunks.length === 0) {
    return { excerpts: [], totalAvailableChunks: 0, hasCoverageAcrossDocuments: false };
  }

  const topK = options.topK || DEFAULT_TOP_K;
  const maxTokens = options.maxTokens || DEFAULT_MAX_TOKENS;
  const isSummary = options.isSummary || isSummarizationQuery(query);

  // Group chunks by document
  const docMap = new Map<string, DocumentChunk[]>();
  const docFilenameMap = new Map<string, string>();
  const docIndexMap = new Map<string, number>();

  let docCounter = 1;
  for (const chunk of chunks) {
    if (!docMap.has(chunk.documentId)) {
      docMap.set(chunk.documentId, []);
      docIndexMap.set(chunk.documentId, docCounter++);
    }
    docMap.get(chunk.documentId)!.push(chunk);
  }

  if (documents) {
    for (const doc of documents) {
      docFilenameMap.set(doc.id, doc.filename);
    }
  }

  // Handle Document-Wide Summarization Mode (Step 5 & 14)
  if (isSummary) {
    const summaryExcerpts = sampleDocumentWideCoverage(docMap, docFilenameMap, docIndexMap, maxTokens);
    return {
      excerpts: summaryExcerpts,
      totalAvailableChunks: chunks.length,
      hasCoverageAcrossDocuments: docMap.size > 1,
      warnings: ['Document-wide summary mode activated: representative sections sampled across document boundaries.'],
    };
  }

  // Standard Query Scoring with BM25 & exact term bonuses
  const queryTerms = tokenize(query);
  const exactPhrase = extractCleanPhrase(query);

  const N = chunks.length;
  const avgDocLength = chunks.reduce((acc, c) => acc + tokenize(c.text).length, 0) / Math.max(1, N);

  // Document frequency (DF) for each query term
  const dfMap = new Map<string, number>();
  for (const term of queryTerms) {
    let count = 0;
    for (const chunk of chunks) {
      if (chunk.text.toLowerCase().includes(term)) {
        count++;
      }
    }
    dfMap.set(term, count);
  }

  // Calculate scores
  const scoredChunks: Array<{ chunk: DocumentChunk; score: number }> = [];

  for (const chunk of chunks) {
    const chunkTokens = tokenize(chunk.text);
    const chunkLength = chunkTokens.length;
    const lowerText = chunk.text.toLowerCase();
    let score = 0;

    // 1. BM25 component
    for (const term of queryTerms) {
      const tf = countOccurrences(chunkTokens, term);
      if (tf === 0) continue;

      const df = dfMap.get(term) || 1;
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
      const numerator = tf * (BM25_K1 + 1);
      const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (chunkLength / Math.max(1, avgDocLength)));
      score += idf * (numerator / denominator);
    }

    // 2. Exact phrase bonus (+30)
    if (exactPhrase && lowerText.includes(exactPhrase.toLowerCase())) {
      score += 30;
    }

    // 3. Code identifier / symbol exact lookup bonus (+25)
    for (const term of queryTerms) {
      if (term.length >= 4 && isCodeIdentifier(term) && chunk.text.includes(term)) {
        score += 25;
      }
    }

    // 4. Section Heading bonus (+20)
    if (chunk.sectionHeading) {
      const headingLower = chunk.sectionHeading.toLowerCase();
      for (const term of queryTerms) {
        if (headingLower.includes(term)) {
          score += 20;
          break;
        }
      }
    }

    // 5. Page number query bonus (e.g. "page 4")
    const pageMatch = query.match(/\bpage\s*(\d+)\b/i);
    if (pageMatch && chunk.pageNumber === Number(pageMatch[1])) {
      score += 35;
    }

    if (score > 0) {
      scoredChunks.push({ chunk, score });
    }
  }

  // If no term matched, fallback to first few chunks rather than returning empty
  if (scoredChunks.length === 0) {
    for (let i = 0; i < Math.min(chunks.length, topK); i++) {
      scoredChunks.push({ chunk: chunks[i], score: 1 });
    }
  }

  // Sort descending
  scoredChunks.sort((a, b) => b.score - a.score);

  // Multi-Document Fair Allocation (Step 5 & 14)
  // Ensure every document with relevant chunks gets represented before filling remaining slots
  const selected: DocumentChunk[] = [];
  const selectedChunkIds = new Set<string>();
  const isMultiDoc = docMap.size > 1;

  if (isMultiDoc) {
    for (const docId of docMap.keys()) {
      if (selected.length >= topK) break;
      const best = scoredChunks.find((sc) => sc.chunk.documentId === docId && !selectedChunkIds.has(sc.chunk.id));
      if (best) {
        selected.push(best.chunk);
        selectedChunkIds.add(best.chunk.id);
      }
    }
  }

  for (const { chunk } of scoredChunks) {
    if (selected.length >= topK) break;
    if (!selectedChunkIds.has(chunk.id)) {
      selected.push(chunk);
      selectedChunkIds.add(chunk.id);
    }
  }

  // Neighbor expansion (Step 5)
  if (options.expandNeighbors) {
    const expanded: DocumentChunk[] = [];
    for (const chunk of selected) {
      expanded.push(chunk);
      const docChunks = docMap.get(chunk.documentId) || [];
      const neighbor = docChunks.find((c) => c.chunkIndex === chunk.chunkIndex + 1);
      if (neighbor && !selectedChunkIds.has(neighbor.id)) {
        expanded.push(neighbor);
        selectedChunkIds.add(neighbor.id);
      }
    }
    selected.length = 0;
    selected.push(...expanded);
  }

  // Budget enforcement & citation formatting
  const excerpts: DocumentExcerpt[] = [];
  let tokenBudgetUsed = 0;

  for (const chunk of selected) {
    if (tokenBudgetUsed + chunk.tokenCount > maxTokens && excerpts.length > 0) {
      break;
    }

    const docIndex = docIndexMap.get(chunk.documentId) || 1;
    const filename = docFilenameMap.get(chunk.documentId) || `Document ${docIndex}`;
    const citationId = formatCitationId(docIndex, chunk);

    const scoredEntry = scoredChunks.find((sc) => sc.chunk.id === chunk.id);
    const score = scoredEntry ? Math.round(scoredEntry.score * 10) / 10 : 1;

    excerpts.push({
      chunkId: chunk.id,
      documentId: chunk.documentId,
      docIndex,
      filename,
      citationId,
      text: chunk.text,
      score,
      pageNumber: chunk.pageNumber,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      sectionHeading: chunk.sectionHeading,
    });

    tokenBudgetUsed += chunk.tokenCount;
  }

  const representedDocs = new Set(excerpts.map((e) => e.documentId));
  const hasCoverageAcrossDocuments = docMap.size > 1 ? representedDocs.size > 1 : true;

  // Disambiguate duplicate citation IDs if multiple excerpts share the same page/range
  disambiguateDuplicateCitationIds(excerpts);

  return {
    excerpts,
    totalAvailableChunks: chunks.length,
    hasCoverageAcrossDocuments,
  };
}

/**
 * Samples representative chunks evenly distributed across the document
 * for whole-document summaries.
 */
function sampleDocumentWideCoverage(
  docMap: Map<string, DocumentChunk[]>,
  docFilenameMap: Map<string, string>,
  docIndexMap: Map<string, number>,
  maxTokens: number
): DocumentExcerpt[] {
  const excerpts: DocumentExcerpt[] = [];
  let tokenBudget = 0;

  for (const [docId, chunks] of docMap.entries()) {
    const docIndex = docIndexMap.get(docId) || 1;
    const filename = docFilenameMap.get(docId) || `Document ${docIndex}`;

    // Sample beginning, middle, and end chunks
    const indices: number[] = [];
    const len = chunks.length;
    if (len <= 4) {
      for (let i = 0; i < len; i++) indices.push(i);
    } else {
      indices.push(0);                      // beginning (0%)
      indices.push(Math.floor(len * 0.25)); // early (25%)
      indices.push(Math.floor(len * 0.50)); // middle (50%)
      indices.push(Math.floor(len * 0.75)); // late (75%)
      indices.push(len - 1);                // end (100%)
    }

    for (const idx of indices) {
      const chunk = chunks[idx];
      if (!chunk) continue;
      if (tokenBudget + chunk.tokenCount > maxTokens && excerpts.length > 0) {
        break;
      }
      excerpts.push({
        chunkId: chunk.id,
        documentId: chunk.documentId,
        docIndex,
        filename,
        citationId: formatCitationId(docIndex, chunk),
        text: chunk.text,
        score: 50,
        pageNumber: chunk.pageNumber,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        sectionHeading: chunk.sectionHeading,
      });
      tokenBudget += chunk.tokenCount;
    }
  }

  disambiguateDuplicateCitationIds(excerpts);
  return excerpts;
}

function disambiguateDuplicateCitationIds(excerpts: DocumentExcerpt[]): void {
  const citationCounts = new Map<string, number>();
  for (const exc of excerpts) {
    citationCounts.set(exc.citationId, (citationCounts.get(exc.citationId) || 0) + 1);
  }
  const seenCitationCount = new Map<string, number>();
  for (const exc of excerpts) {
    if ((citationCounts.get(exc.citationId) || 0) > 1) {
      const nextIndex = (seenCitationCount.get(exc.citationId) || 0) + 1;
      seenCitationCount.set(exc.citationId, nextIndex);
      exc.citationId = `${exc.citationId}.${nextIndex}`;
    }
  }
}

function formatCitationId(docIndex: number, chunk: DocumentChunk): string {
  if (chunk.pageNumber) {
    return `D${docIndex}:p${chunk.pageNumber}`;
  }
  if (chunk.startLine && chunk.endLine) {
    return `D${docIndex}:L${chunk.startLine}-L${chunk.endLine}`;
  }
  return `D${docIndex}:c${chunk.chunkIndex + 1}`;
}

function isSummarizationQuery(query: string): boolean {
  const lower = query.toLowerCase();
  return (
    /\b(summarize|summary|overview|tl;?dr|what is this (?:file|document|pdf) about|give me a breakdown|high level|executive summary)\b/.test(lower) ||
    /^(?:what does this (?:file|document|pdf) (?:say|contain|cover))\b/.test(lower)
  );
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

function extractCleanPhrase(query: string): string | null {
  const match = query.match(/"([^"]{4,80})"/);
  if (match) return match[1].trim();
  const tokens = query.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
  return tokens.length >= 2 && tokens.length <= 6 ? tokens.join(' ') : null;
}

function countOccurrences(tokens: string[], term: string): number {
  let count = 0;
  for (const t of tokens) {
    if (t === term || t.includes(term)) count++;
  }
  return count;
}

function isCodeIdentifier(term: string): boolean {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(term) && /[A-Z_]/.test(term);
}

export const tokenizeText = tokenize;

export function computeIdf(chunks: Array<{ text: string }>): Map<string, number> {
  const N = chunks.length;
  const dfMap = new Map<string, number>();
  for (const chunk of chunks) {
    const tokens = new Set(tokenize(chunk.text));
    for (const token of tokens) {
      dfMap.set(token, (dfMap.get(token) || 0) + 1);
    }
  }
  const idfMap = new Map<string, number>();
  for (const [term, df] of dfMap.entries()) {
    idfMap.set(term, Math.log((N - df + 0.5) / (df + 0.5) + 1));
  }
  return idfMap;
}

export function scoreBm25(
  queryTerms: string[],
  chunk: { text: string; tokenCount?: number },
  avgDocLength: number,
  idfMap?: Map<string, number>
): number {
  const chunkTokens = tokenize(chunk.text);
  const chunkLength = chunkTokens.length;
  let score = 0;

  for (const term of queryTerms) {
    const tf = countOccurrences(chunkTokens, term);
    if (tf === 0) continue;

    const idf = idfMap?.get(term) ?? 1.5;
    const numerator = tf * (BM25_K1 + 1);
    const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (chunkLength / Math.max(1, avgDocLength)));
    score += idf * (numerator / denominator);
  }

  return score;
}
