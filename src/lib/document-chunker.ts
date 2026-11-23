import { DocumentChunk } from '@/types/document';
import { generateId } from '@/lib/utils';

export interface ChunkingOptions {
  maxTokens?: number;       // default 500 tokens (~2000 chars)
  overlapTokens?: number;   // default 60 tokens (~240 chars)
  maxChunks?: number;       // default 250 chunks
}

export interface StructuredPageText {
  pageNumber: number;
  text: string;
}

export interface ChunkingResult {
  chunks: DocumentChunk[];
  totalTokens: number;
  warning?: string;
}

const CHARS_PER_TOKEN = 4;
const DEFAULT_MAX_TOKENS = 500;
const DEFAULT_OVERLAP_TOKENS = 60;
const DEFAULT_MAX_CHUNKS = 250;

/**
 * Structure-aware chunking for text, Markdown, code, CSV and PDF pages.
 * Preserves page numbers, headings, code blocks and line ranges.
 */
export function chunkDocument({
  documentId,
  conversationId,
  content,
  pages,
  mediaType,
  options = {},
}: {
  documentId: string;
  conversationId: string;
  content: string;
  pages?: StructuredPageText[];
  mediaType: string;
  options?: ChunkingOptions;
}): ChunkingResult {
  const maxTokens = options.maxTokens || DEFAULT_MAX_TOKENS;
  const overlapTokens = options.overlapTokens || DEFAULT_OVERLAP_TOKENS;
  const maxChunks = options.maxChunks || DEFAULT_MAX_CHUNKS;

  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const overlapChars = overlapTokens * CHARS_PER_TOKEN;

  const chunks: DocumentChunk[] = [];
  let warning: string | undefined;

  let processedContent = content || '';
  if (processedContent.length > 500_000) {
    processedContent = processedContent.slice(0, 500_000);
    warning = 'Document exceeded 500,000 characters; remaining text was omitted.';
  }

  // Case 1: PDF with per-page text structures
  if (pages && pages.length > 0) {
    let globalIndex = 0;
    for (const page of pages) {
      if (chunks.length >= maxChunks) {
        warning = `Document exceeded maximum chunk limit (${maxChunks} chunks). Content past page ${page.pageNumber} was partially indexed.`;
        break;
      }
      const pageText = page.text.trim();
      if (!pageText) continue;

      if (pageText.length <= maxChars) {
        chunks.push({
          id: `chk_${documentId.slice(-6)}_${globalIndex}`,
          documentId,
          conversationId,
          chunkIndex: globalIndex++,
          text: pageText,
          tokenCount: Math.ceil(pageText.length / CHARS_PER_TOKEN),
          pageNumber: page.pageNumber,
        });
      } else {
        // Split long page into paragraph-based subchunks
        const subChunks = splitTextIntoBlocks(pageText, maxChars, overlapChars);
        for (const sub of subChunks) {
          if (chunks.length >= maxChunks) {
            warning = `Document exceeded maximum chunk limit (${maxChunks} chunks). Content past page ${page.pageNumber} was partially indexed.`;
            break;
          }
          chunks.push({
            id: `chk_${documentId.slice(-6)}_${globalIndex}`,
            documentId,
            conversationId,
            chunkIndex: globalIndex++,
            text: sub.text,
            tokenCount: Math.ceil(sub.text.length / CHARS_PER_TOKEN),
            pageNumber: page.pageNumber,
            sectionHeading: sub.heading,
          });
        }
      }
    }

    if (chunks.length === 0) {
      warning = 'This PDF appears to be scanned or contains no extractable text. Text extraction yielded no content.';
    }

    const totalTokens = chunks.reduce((acc, c) => acc + c.tokenCount, 0);
    return { chunks, totalTokens, warning };
  }

  // Case 2: Code files (preserve line numbers)
  if (isCodeMediaType(mediaType)) {
    const lines = content.split(/\r?\n/);
    let currentLine = 1;
    let globalIndex = 0;

    let buffer: string[] = [];
    let bufferChars = 0;
    let chunkStartLine = 1;

    for (let i = 0; i < lines.length; i++) {
      if (chunks.length >= maxChunks) {
        warning = `Document exceeded maximum chunk limit (${maxChunks} chunks). Content past line ${i + 1} was partially indexed.`;
        break;
      }

      const line = lines[i];
      buffer.push(line);
      bufferChars += line.length + 1;

      if (bufferChars >= maxChars || i === lines.length - 1) {
        const chunkText = buffer.join('\n');
        chunks.push({
          id: `chk_${documentId.slice(-6)}_${globalIndex}`,
          documentId,
          conversationId,
          chunkIndex: globalIndex++,
          text: chunkText,
          tokenCount: Math.ceil(chunkText.length / CHARS_PER_TOKEN),
          startLine: chunkStartLine,
          endLine: i + 1,
        });

        // Compute overlap lines
        const overlapLinesCount = Math.min(Math.floor(overlapChars / 40), Math.floor(buffer.length / 3));
        if (overlapLinesCount > 0 && i < lines.length - 1) {
          buffer = buffer.slice(-overlapLinesCount);
          bufferChars = buffer.reduce((sum, l) => sum + l.length + 1, 0);
          chunkStartLine = (i + 1) - overlapLinesCount + 1;
        } else {
          buffer = [];
          bufferChars = 0;
          chunkStartLine = i + 2;
        }
      }
    }

    const totalTokens = chunks.reduce((acc, c) => acc + c.tokenCount, 0);
    return { chunks, totalTokens, warning };
  }

  // Case 3: CSV / Tabular (preserve rows)
  if (mediaType.includes('csv') || mediaType.includes('tabular')) {
    const lines = processedContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const header = lines[0] || '';
    let globalIndex = 0;

    let rowBuffer: string[] = [];
    let rowChars = 0;
    let startRow = 1;
    const rowsPerChunk = options.maxTokens ? Math.max(5, Math.floor(options.maxTokens / 15)) : 25;

    for (let i = 1; i < lines.length; i++) {
      if (chunks.length >= maxChunks) {
        warning = `Document exceeded maximum chunk limit (${maxChunks} chunks). Content past row ${i + 1} was partially indexed.`;
        break;
      }
      const line = lines[i];
      rowBuffer.push(line);
      rowChars += line.length + 1;

      if (rowBuffer.length >= rowsPerChunk || rowChars >= maxChars || i === lines.length - 1) {
        const chunkContent = `${header}\n` + rowBuffer.join('\n');
        chunks.push({
          id: `chk_${documentId.slice(-6)}_${globalIndex}`,
          documentId,
          conversationId,
          chunkIndex: globalIndex++,
          text: chunkContent,
          tokenCount: Math.ceil(chunkContent.length / CHARS_PER_TOKEN),
          startLine: startRow,
          endLine: i + 1,
        });

        rowBuffer = [];
        rowChars = 0;
        startRow = i + 2;
      }
    }

    if (chunks.length === 0 && lines.length > 0) {
      chunks.push({
        id: `chk_${documentId.slice(-6)}_0`,
        documentId,
        conversationId,
        chunkIndex: 0,
        text: processedContent.slice(0, maxChars),
        tokenCount: Math.ceil(processedContent.slice(0, maxChars).length / CHARS_PER_TOKEN),
        startLine: 1,
        endLine: lines.length,
      });
    }

    const totalTokens = chunks.reduce((acc, c) => acc + c.tokenCount, 0);
    return { chunks, totalTokens, warning };
  }

  // Case 4: General Markdown and Text
  const blocks = splitTextIntoBlocks(processedContent, maxChars, overlapChars);
  let globalIndex = 0;
  for (const block of blocks) {
    if (chunks.length >= maxChunks) {
      warning = `Document exceeded maximum chunk limit (${maxChunks} chunks). Content past chunk ${maxChunks} was partially indexed.`;
      break;
    }
    chunks.push({
      id: `chk_${documentId.slice(-6)}_${globalIndex}`,
      documentId,
      conversationId,
      chunkIndex: globalIndex++,
      text: block.text,
      tokenCount: Math.ceil(block.text.length / CHARS_PER_TOKEN),
      sectionHeading: block.heading,
      startLine: block.startLine,
      endLine: block.endLine,
    });
  }

  const totalTokens = chunks.reduce((acc, c) => acc + c.tokenCount, 0);
  return { chunks, totalTokens, warning };
}

interface TextBlock {
  text: string;
  heading?: string;
  startLine?: number;
  endLine?: number;
}

function splitTextIntoBlocks(text: string, maxChars: number, overlapChars: number): TextBlock[] {
  const paragraphs = text.split(/\n\s*\n/);
  const blocks: TextBlock[] = [];

  let currentHeading = '';
  let currentParagraphs: string[] = [];
  let currentLength = 0;
  let lineCounter = 1;
  let chunkStartLine = 1;

  for (let i = 0; i < paragraphs.length; i++) {
    const rawPara = paragraphs[i].trim();
    if (!rawPara) continue;

    // Detect Markdown headings
    const headingMatch = rawPara.match(/^(#{1,4}\s+[^\n]+)/);
    if (headingMatch && currentParagraphs.length > 0) {
      const blockText = currentParagraphs.join('\n\n');
      blocks.push({
        text: blockText,
        heading: currentHeading || undefined,
        startLine: chunkStartLine,
        endLine: lineCounter,
      });
      currentParagraphs = [];
      currentLength = 0;
      chunkStartLine = lineCounter + 1;
    }
    if (headingMatch) {
      currentHeading = headingMatch[1].replace(/^#+\s*/, '').trim();
    }

    const paraLines = rawPara.split('\n').length;

    if (currentLength + rawPara.length > maxChars && currentParagraphs.length > 0) {
      const blockText = currentParagraphs.join('\n\n');
      blocks.push({
        text: blockText,
        heading: currentHeading || undefined,
        startLine: chunkStartLine,
        endLine: lineCounter,
      });

      // Preserve overlap paragraph if reasonable
      const lastPara = currentParagraphs[currentParagraphs.length - 1];
      if (lastPara && lastPara.length <= overlapChars) {
        currentParagraphs = [lastPara, rawPara];
        currentLength = lastPara.length + rawPara.length + 2;
        chunkStartLine = lineCounter - lastPara.split('\n').length;
      } else {
        currentParagraphs = [rawPara];
        currentLength = rawPara.length;
        chunkStartLine = lineCounter;
      }
    } else {
      currentParagraphs.push(rawPara);
      currentLength += rawPara.length + 2;
    }

    lineCounter += paraLines + 1;
  }

  if (currentParagraphs.length > 0) {
    blocks.push({
      text: currentParagraphs.join('\n\n'),
      heading: currentHeading || undefined,
      startLine: chunkStartLine,
      endLine: lineCounter,
    });
  }

  return blocks;
}

function isCodeMediaType(mediaType: string): boolean {
  const lower = mediaType.toLowerCase();
  return (
    lower.includes('typescript') ||
    lower.includes('javascript') ||
    lower.includes('python') ||
    lower.includes('golang') ||
    lower.includes('rust') ||
    lower.includes('java') ||
    lower.includes('c++') ||
    lower.includes('shell') ||
    lower.includes('code') ||
    lower.endsWith('.ts') ||
    lower.endsWith('.tsx') ||
    lower.endsWith('.js') ||
    lower.endsWith('.jsx') ||
    lower.endsWith('.py') ||
    lower.endsWith('.rs') ||
    lower.endsWith('.go') ||
    lower.endsWith('.sql')
  );
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function chunkPdfPages({
  documentId,
  conversationId,
  pages,
  options,
}: {
  documentId: string;
  conversationId: string;
  pages: StructuredPageText[];
  options?: ChunkingOptions;
}): DocumentChunk[] {
  return chunkDocument({
    documentId,
    conversationId,
    content: '',
    pages,
    mediaType: 'application/pdf',
    options,
  }).chunks;
}

export function chunkCodeText({
  documentId,
  conversationId,
  content,
  targetLines,
  options,
}: {
  documentId: string;
  conversationId: string;
  content: string;
  targetLines?: number;
  options?: ChunkingOptions;
}): DocumentChunk[] {
  return chunkDocument({
    documentId,
    conversationId,
    content,
    mediaType: 'text/typescript',
    options: {
      ...options,
      maxTokens: targetLines ? targetLines * 10 : options?.maxTokens,
    },
  }).chunks;
}

export function chunkMarkdownText({
  documentId,
  conversationId,
  content,
  options,
}: {
  documentId: string;
  conversationId: string;
  content: string;
  options?: ChunkingOptions;
}): DocumentChunk[] {
  return chunkDocument({
    documentId,
    conversationId,
    content,
    mediaType: 'text/markdown',
    options,
  }).chunks;
}

export function chunkCsvText({
  documentId,
  conversationId,
  content,
  rowsPerChunk,
  options,
}: {
  documentId: string;
  conversationId: string;
  content: string;
  rowsPerChunk?: number;
  options?: ChunkingOptions;
}): DocumentChunk[] {
  return chunkDocument({
    documentId,
    conversationId,
    content,
    mediaType: 'text/csv',
    options: {
      ...options,
      maxTokens: rowsPerChunk ? rowsPerChunk * 20 : options?.maxTokens,
    },
  }).chunks;
}
