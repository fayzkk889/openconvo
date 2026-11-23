export type DocumentProcessingStatus =
  | 'selected'
  | 'validating'
  | 'extracting'
  | 'indexing'
  | 'ready'
  | 'partially-processed'
  | 'failed'
  | 'cancelled';

export interface DocumentRecord {
  id: string; // doc_xxx
  conversationId: string;
  projectId?: string;
  filename: string;
  mediaType: string;
  fileSize: number;
  fingerprint: string;
  status: DocumentProcessingStatus;
  warning?: string;
  error?: string;
  pageCount?: number;
  chunkCount: number;
  totalTokens: number;
  createdAt: number;
  updatedAt: number;
}

export interface DocumentChunk {
  id: string; // chk_xxx
  documentId: string;
  conversationId: string;
  chunkIndex: number;
  text: string;
  tokenCount: number;
  pageNumber?: number;
  startLine?: number;
  endLine?: number;
  sectionHeading?: string;
}

export interface DocumentExcerpt {
  chunkId: string;
  documentId: string;
  docIndex: number; // 1-based index (e.g. 1 for D1)
  filename: string;
  citationId: string; // e.g. "D1:p4", "D1:L20-L45", "D1:c2"
  text: string;
  score: number;
  pageNumber?: number;
  startLine?: number;
  endLine?: number;
  sectionHeading?: string;
}

export interface DocumentCitationValidation {
  validCitations: string[];
  unknownCitations: string[];
  citedExcerpts: DocumentExcerpt[];
  hasFabricatedCitations: boolean;
  totalCitations: number;
}

export interface DocumentRetrievalOptions {
  topK?: number;
  maxTokens?: number;
  expandNeighbors?: boolean;
  isSummary?: boolean;
  targetDocumentIds?: string[];
}

export interface DocumentRetrievalResult {
  excerpts: DocumentExcerpt[];
  totalAvailableChunks: number;
  hasCoverageAcrossDocuments: boolean;
  warnings?: string[];
}
