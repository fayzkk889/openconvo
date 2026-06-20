export interface Attachment {
  id: string;
  name: string;
  type: string;
  size: number;
  content: string; // extracted text content
}

export interface SearchResultRef {
  title: string;
  url: string;
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

export type TaskType = 'auto' | 'quick' | 'research' | 'deep-research' | 'file' | 'code' | 'writing';

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model?: string;
  attachments?: Attachment[];
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
  timestamp: number;
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  projectId?: string;
  pinned?: boolean;
  archived?: boolean;
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
