import type { DocumentExcerpt, DocumentProcessingStatus, DocumentRecord, DocumentChunk } from '@/types/document';

export interface Attachment {
  id: string;
  name: string;
  type: string;
  size: number;
  content: string; // extracted text content
  documentId?: string;
  status?: DocumentProcessingStatus;
  pageCount?: number;
  chunkCount?: number;
  warning?: string;
  error?: string;
  documentRecord?: DocumentRecord;
  chunks?: DocumentChunk[];
}

export interface SearchResultRef {
  id?: string;
  title: string;
  url: string;
  canonicalUrl?: string;
  domain?: string;
  publishedAt?: string;
  snippet: string;
  content?: string;
  extracted?: boolean;
  fetchedAt?: number;
  sourceScore?: number;
  sourceLabel?: string;
  sourceReason?: string;
}

export interface ResearchTrace {
  query: string;
  plannedQueries?: string[];
  plannedEntities?: string[];
  planner?: 'model' | 'heuristic';
  provider?: string;
  providers?: string[];
  providerErrors?: string[];
  sourceCount: number;
  openedCount: number;
}

export interface ResearchStatus {
  phase: 'planning' | 'searching' | 'reading' | 'synthesizing';
  mode: 'search' | 'research' | 'deep-research';
  label: string;
  plannedQueries?: number;
  sourceCount?: number;
  openedCount?: number;
}

export type RequestLifecycleState =
  | 'idle'
  | 'preparing'
  | 'searching'
  | 'connecting'
  | 'streaming'
  | 'persisting'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type TaskType = 'auto' | 'quick' | 'research' | 'deep-research' | 'file' | 'code' | 'writing';

export type MessageStatus = 'complete' | 'interrupted' | 'failed' | 'degraded';

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export type StreamingChatEvent =
  | {
      type: 'meta';
      requestId: string;
      model: string;
      mode: 'byok' | 'hosted-free';
    }
  | {
      type: 'delta';
      content: string;
      model?: string;
    }
  | {
      type: 'fallback';
      fromModel: string;
      toModel: string;
      reason: string;
      rateLimitedModels?: string[];
      retryAfterSeconds?: number;
    }
  | {
      type: 'complete';
      model: string;
      finishReason?: 'stop' | 'length' | 'content_filter' | 'error' | string;
      usage?: TokenUsage;
    }
  | {
      type: 'interrupted';
      model: string;
      partialContent: string;
      reason: string;
      finishReason?: string;
    }
  | {
      type: 'error';
      error: string;
      code?: string;
      model?: string;
      failedModels?: string[];
      rateLimitedModels?: string[];
      retryAfterSeconds?: number;
    }
  | {
      type: 'research_fallback';
      content: string;
      model: string;
      reason: string;
    }
  | {
      type: 'tool';
      name: 'web_search' | 'read_page';
      status: 'running' | 'done' | 'failed';
      query?: string;
      kind?: 'web' | 'news';
      url?: string;
      resultCount?: number;
    }
  | {
      /** Withdraw the text streamed so far (pre-tool narration). */
      type: 'reset';
    }
  | {
      type: 'sources';
      sources: SearchResultRef[];
      queries: string[];
      providers: string[];
    };

/** How much the model may use web tools for one answer. */
export type WebSearchPolicy = 'auto' | 'required' | 'off';

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model?: string;
  attachments?: Attachment[];
  documentExcerpts?: DocumentExcerpt[];
  searchResults?: SearchResultRef[];
  researchTrace?: ResearchTrace;
  researchMode?: boolean;
  agentMode?: boolean;
  taskType?: TaskType;
  autoRouted?: boolean;
  routingNote?: string;
  compareRun?: boolean;
  preferred?: boolean;
  isError?: boolean;
  status?: MessageStatus;
  finishReason?: string;
  tokenUsage?: TokenUsage;
  timestamp: number;
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  projectId?: string;
  pinned?: boolean;
  archived?: boolean;
  titleManuallySet?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Project {
  id: string;
  name: string;
  instructions?: string;
  defaultModel?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Artifact {
  id: string;
  conversationId: string;
  projectId?: string;
  sourceMessageId?: string;
  sourceKey?: string;
  title: string;
  language: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}
