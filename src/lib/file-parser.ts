import { Attachment } from '@/types/chat';
import { DocumentRecord, DocumentChunk, DocumentProcessingStatus } from '@/types/document';
import { generateId } from './utils';
import { chunkDocument, StructuredPageText } from './document-chunker';

interface PdfTextItem {
  str?: string;
}

export const TEXT_EXTENSIONS = [
  '.txt', '.md', '.json', '.csv', '.py', '.js', '.ts', '.tsx', '.jsx',
  '.html', '.css', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg',
  '.sh', '.bash', '.sql', '.r', '.go', '.rs', '.java', '.c', '.cpp',
  '.h', '.hpp', '.rb', '.php', '.swift', '.kt', '.scala', '.env',
  '.gitignore', '.dockerfile', '.makefile', '.log',
];

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_EXTRACTED_CHARS = 500_000;
export const MAX_PDF_PAGES = 100;

export interface ParsedAttachment extends Attachment {
  documentRecord?: DocumentRecord;
  chunks?: DocumentChunk[];
  warning?: string;
  error?: string;
  status: DocumentProcessingStatus;
}

export async function parseFile(
  file: File,
  options?: {
    conversationId?: string;
    projectId?: string;
    onProgress?: (percent: number, status: DocumentProcessingStatus) => void;
  }
): Promise<ParsedAttachment> {
  const conversationId = options?.conversationId || 'transient';
  options?.onProgress?.(5, 'validating');

  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File is too large (${formatSize(file.size)}). Maximum supported file size is 10MB.`);
  }

  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  let content = '';
  let pages: StructuredPageText[] | undefined;
  let pageCount: number | undefined;
  let warning: string | undefined;

  options?.onProgress?.(25, 'extracting');

  if (ext === '.pdf') {
    const pdfResult = await extractPdfPages(file);
    pages = pdfResult.pages;
    pageCount = pdfResult.pageCount;
    warning = pdfResult.warning;
    content = pages.map((p) => `--- Page ${p.pageNumber} ---\n${p.text}`).join('\n\n');
  } else if (TEXT_EXTENSIONS.includes(ext) || file.type.startsWith('text/')) {
    const rawText = await file.text();
    if (rawText.length > MAX_EXTRACTED_CHARS) {
      content = rawText.slice(0, MAX_EXTRACTED_CHARS);
      warning = `File exceeded ${MAX_EXTRACTED_CHARS.toLocaleString()} characters; remaining text was omitted.`;
    } else {
      content = rawText;
    }
  } else {
    // Attempt reading as text, fallback cleanly
    try {
      const rawText = await file.text();
      if (/[\x00-\x08\x0E-\x1F]/.test(rawText.slice(0, 1000))) {
        throw new Error(`Binary file format not supported for text extraction: ${file.name}`);
      }
      content = rawText.slice(0, MAX_EXTRACTED_CHARS);
    } catch (err) {
      throw new Error(`Unsupported or unreadable file format: ${file.name}`);
    }
  }

  options?.onProgress?.(65, 'indexing');

  const docId = `doc_${generateId()}`;
  const fingerprint = computeFingerprint(content);

  const chunkResult = chunkDocument({
    documentId: docId,
    conversationId,
    content,
    pages,
    mediaType: file.type || ext,
  });

  const finalWarning = warning || chunkResult.warning;
  const status: DocumentProcessingStatus = finalWarning ? 'partially-processed' : 'ready';

  const documentRecord: DocumentRecord = {
    id: docId,
    conversationId,
    projectId: options?.projectId,
    filename: file.name,
    mediaType: file.type || ext,
    fileSize: file.size,
    fingerprint,
    status,
    warning: finalWarning,
    pageCount,
    chunkCount: chunkResult.chunks.length,
    totalTokens: chunkResult.totalTokens,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  options?.onProgress?.(100, status);

  return {
    id: docId,
    name: file.name,
    type: file.type || ext,
    size: file.size,
    content: content.slice(0, 50000), // backward compatibility for legacy callers
    documentId: docId,
    status,
    pageCount,
    chunkCount: chunkResult.chunks.length,
    warning: finalWarning,
    documentRecord,
    chunks: chunkResult.chunks,
  };
}

interface PdfExtractionResult {
  pages: StructuredPageText[];
  pageCount: number;
  warning?: string;
}

export async function extractPdfPages(file: File): Promise<PdfExtractionResult> {
  let arrayBuffer: ArrayBuffer;
  try {
    arrayBuffer = await file.arrayBuffer();
  } catch (err) {
    throw new Error(`Failed to read PDF file data: ${file.name}`);
  }

  // Quick header check
  const headerBytes = new Uint8Array(arrayBuffer.slice(0, 8));
  const headerStr = String.fromCharCode(...headerBytes);
  if (!headerStr.startsWith('%PDF-')) {
    throw new Error(`Corrupted or invalid PDF header in ${file.name}`);
  }

  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

    // Use local version-matched worker endpoint without remote cdnjs dependency
    if (typeof window !== 'undefined') {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `/api/pdf-worker?v=${encodeURIComponent(pdfjsLib.version || '4.10.38')}`;
    }

    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer),
      isEvalSupported: false,
      useWorkerFetch: false,
      disableFontFace: true,
    });

    const pdf = await loadingTask.promise;
    const totalPages = pdf.numPages;
    const extractPages = Math.min(totalPages, MAX_PDF_PAGES);
    const pages: StructuredPageText[] = [];
    let totalExtractedChars = 0;

    for (let i = 1; i <= extractPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) => ('str' in item ? (item as PdfTextItem).str || '' : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (pageText) {
        pages.push({ pageNumber: i, text: pageText });
        totalExtractedChars += pageText.length;
      } else {
        pages.push({ pageNumber: i, text: '' });
      }
    }

    let warning: string | undefined;
    if (totalPages > MAX_PDF_PAGES) {
      warning = `PDF has ${totalPages} pages. Only the first ${MAX_PDF_PAGES} pages were indexed.`;
    } else if (totalExtractedChars < 30 && totalPages > 0) {
      warning = 'Scanned document detected. Optical Character Recognition (OCR) is required but unavailable locally.';
    }

    return {
      pages,
      pageCount: totalPages,
      warning,
    };
  } catch (error: any) {
    const msg = error?.message || String(error);
    if (error?.name === 'PasswordException' || /password/i.test(msg)) {
      throw new Error(`Password-protected PDF. Please decrypt "${file.name}" before uploading.`);
    }
    if (/corrupted|invalid|format error|trailer not found|xref/i.test(msg)) {
      throw new Error(`Corrupted or malformed PDF: ${file.name}`);
    }
    console.error('PDF extraction failed:', error);
    throw new Error(`Failed to extract text from PDF "${file.name}": ${msg}`);
  }
}

function computeFingerprint(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36) + '_' + content.length;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const ACCEPTED_FILE_TYPES = [
  '.txt', '.md', '.pdf', '.json', '.csv',
  '.py', '.js', '.ts', '.tsx', '.jsx',
  '.html', '.css', '.xml', '.yaml', '.yml',
  '.sql', '.sh', '.go', '.rs', '.java',
  '.c', '.cpp', '.rb', '.php', '.log',
].join(',');
