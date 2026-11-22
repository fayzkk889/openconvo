import { exportAllData, importAllData } from './storage';
import { Artifact, Attachment, Conversation, Message, Project, SearchResultRef, MessageStatus, TokenUsage } from '@/types/chat';
import { DocumentRecord, DocumentChunk, DocumentExcerpt, DocumentProcessingStatus } from '@/types/document';
import { DEFAULT_SETTINGS, ExportedSettings, Settings } from '@/types/settings';
import { resolveSafeModelId } from '@/lib/models';
import { normalizeTaskType } from '@/lib/tasks';

const MAX_IMPORT_ITEMS = 10000;
const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
const MAX_TITLE_CHARS = 200;
const MAX_MESSAGE_CHARS = 50000;
const MAX_ARTIFACT_CHARS = 250000;

export async function downloadExport(settings?: Settings): Promise<void> {
  const data = await exportAllData();
  const json = JSON.stringify({
    ...data,
    settings: settings ? toExportedSettings(settings) : undefined,
  }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `openconvo-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importFromFile(file: File): Promise<ExportedSettings | undefined> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error('Import file is too large');
  }
  const text = await file.text();
  const data = JSON.parse(text) as unknown;
  const validated = validateImportData(data);
  await importAllData(validated);
  return validated.settings;
}

export function validateImportData(data: unknown): {
  projects: Project[];
  conversations: Conversation[];
  messages: Message[];
  artifacts: Artifact[];
  settings?: ExportedSettings;
  documents?: DocumentRecord[];
  documentChunks?: DocumentChunk[];
} {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid export file format');
  }

  const candidate = data as { conversations?: unknown; messages?: unknown };
  if (!Array.isArray(candidate.conversations) || !Array.isArray(candidate.messages)) {
    throw new Error('Invalid export file format');
  }

  const rawProjects = Array.isArray((candidate as { projects?: unknown }).projects)
    ? (candidate as { projects: unknown[] }).projects
    : [];
  const rawArtifacts = Array.isArray((candidate as { artifacts?: unknown }).artifacts)
    ? (candidate as { artifacts: unknown[] }).artifacts
    : [];
  const rawDocuments = Array.isArray((candidate as { documents?: unknown }).documents)
    ? (candidate as { documents: unknown[] }).documents
    : [];
  const rawDocumentChunks = Array.isArray((candidate as { documentChunks?: unknown }).documentChunks)
    ? (candidate as { documentChunks: unknown[] }).documentChunks
    : [];

  if (
    rawProjects.length > MAX_IMPORT_ITEMS ||
    rawArtifacts.length > MAX_IMPORT_ITEMS ||
    rawDocuments.length > MAX_IMPORT_ITEMS ||
    rawDocumentChunks.length > MAX_IMPORT_ITEMS * 5 ||
    candidate.conversations.length > MAX_IMPORT_ITEMS ||
    candidate.messages.length > MAX_IMPORT_ITEMS
  ) {
    throw new Error('Import file is too large');
  }

  const projects = rawProjects.map(validateProject);
  const projectIds = new Set(projects.map((project) => project.id));
  const conversations = candidate.conversations.map(validateConversation);
  const conversationIds = new Set(conversations.map((conv) => conv.id));
  const messages = candidate.messages.map(validateMessage);
  const messageIds = new Set(messages.map((message) => message.id));
  const artifacts = rawArtifacts
    .map(validateArtifact)
    .filter((artifact) => !artifact.sourceMessageId || messageIds.has(artifact.sourceMessageId));
  const documents = rawDocuments.map(validateDocumentRecord);
  const documentIds = new Set(documents.map((doc) => doc.id));
  const documentChunks = rawDocumentChunks.map(validateDocumentChunk);

  for (const conversation of conversations) {
    if (conversation.projectId && !projectIds.has(conversation.projectId)) {
      throw new Error('Import contains conversations without matching projects');
    }
  }

  for (const message of messages) {
    if (!conversationIds.has(message.conversationId)) {
      throw new Error('Import contains messages without matching conversations');
    }
  }

  for (const artifact of artifacts) {
    if (!conversationIds.has(artifact.conversationId)) {
      throw new Error('Import contains artifacts without matching conversations');
    }
    if (artifact.projectId && !projectIds.has(artifact.projectId)) {
      throw new Error('Import contains artifacts without matching projects');
    }
  }

  for (const doc of documents) {
    if (!conversationIds.has(doc.conversationId)) {
      throw new Error('Import contains documents without matching conversations');
    }
    if (doc.projectId && !projectIds.has(doc.projectId)) {
      throw new Error('Import contains documents without matching projects');
    }
  }

  for (const chunk of documentChunks) {
    if (!documentIds.has(chunk.documentId)) {
      throw new Error('Import contains document chunks without matching documents');
    }
    if (!conversationIds.has(chunk.conversationId)) {
      throw new Error('Import contains document chunks without matching conversations');
    }
  }

  return {
    projects,
    conversations,
    messages,
    artifacts,
    settings: validateExportedSettings((candidate as { settings?: unknown }).settings),
    documents: documents.length > 0 ? documents : undefined,
    documentChunks: documentChunks.length > 0 ? documentChunks : undefined,
  };
}

export const validateExportData = validateImportData;

export function toExportedSettings(settings: Settings): ExportedSettings {
  return {
    theme: settings.theme,
    defaultModel: settings.defaultModel,
    systemPrompt: settings.systemPrompt,
    memory: settings.memory,
    memoryEnabled: settings.memoryEnabled,
    promptSnippets: settings.promptSnippets,
    searchEnabled: settings.searchEnabled,
  };
}

function validateExportedSettings(value: unknown): ExportedSettings | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const settings = value as Partial<ExportedSettings>;

  return {
    theme: settings.theme === 'light' ? 'light' : 'dark',
    defaultModel: resolveSafeModelId(
      typeof settings.defaultModel === 'string' && settings.defaultModel.trim()
        ? settings.defaultModel
        : DEFAULT_SETTINGS.defaultModel
    ),
    systemPrompt: typeof settings.systemPrompt === 'string' ? settings.systemPrompt.slice(0, 10000) : '',
    memory: typeof settings.memory === 'string' ? settings.memory.slice(0, 20000) : '',
    memoryEnabled: typeof settings.memoryEnabled === 'boolean' ? settings.memoryEnabled : true,
    promptSnippets: normalizePromptSnippets(settings.promptSnippets),
    searchEnabled: typeof settings.searchEnabled === 'boolean' ? settings.searchEnabled : false,
  };
}

function normalizePromptSnippets(value: unknown): ExportedSettings['promptSnippets'] {
  if (!Array.isArray(value)) return [];

  return value.slice(0, 100).flatMap((item): ExportedSettings['promptSnippets'] => {
    if (!item || typeof item !== 'object') return [];
    const snippet = item as Partial<ExportedSettings['promptSnippets'][number]>;
    if (
      typeof snippet.id !== 'string' ||
      typeof snippet.title !== 'string' ||
      typeof snippet.content !== 'string'
    ) {
      return [];
    }
    const now = Date.now();
    return [{
      id: snippet.id,
      title: snippet.title.slice(0, 120),
      content: snippet.content.slice(0, 10000),
      createdAt: typeof snippet.createdAt === 'number' ? snippet.createdAt : now,
      updatedAt: typeof snippet.updatedAt === 'number' ? snippet.updatedAt : now,
    }];
  });
}

function validateProject(value: unknown): Project {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid project in import file');
  }

  const project = value as Partial<Project>;
  if (
    typeof project.id !== 'string' ||
    typeof project.name !== 'string' ||
    typeof project.createdAt !== 'number' ||
    typeof project.updatedAt !== 'number'
  ) {
    throw new Error('Invalid project in import file');
  }

  return {
    id: project.id,
    name: project.name.slice(0, MAX_TITLE_CHARS),
    instructions: typeof project.instructions === 'string' ? project.instructions.slice(0, 10000) : undefined,
    defaultModel: typeof project.defaultModel === 'string' ? resolveSafeModelId(project.defaultModel) : undefined,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

export function validateConversation(value: unknown): Conversation {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid conversation in import file');
  }

  const conv = value as Partial<Conversation>;
  if (
    typeof conv.id !== 'string' ||
    typeof conv.title !== 'string' ||
    typeof conv.model !== 'string' ||
    typeof conv.createdAt !== 'number' ||
    typeof conv.updatedAt !== 'number'
  ) {
    throw new Error('Invalid conversation in import file');
  }

  return {
    id: conv.id,
    title: conv.title.slice(0, MAX_TITLE_CHARS),
    model: resolveSafeModelId(conv.model),
    projectId: typeof conv.projectId === 'string' ? conv.projectId : undefined,
    pinned: typeof conv.pinned === 'boolean' ? conv.pinned : undefined,
    archived: typeof conv.archived === 'boolean' ? conv.archived : undefined,
    titleManuallySet: typeof conv.titleManuallySet === 'boolean' ? conv.titleManuallySet : undefined,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
  };
}

export function validateMessage(value: unknown): Message {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid message in import file');
  }

  const message = value as Partial<Message>;
  if (
    typeof message.id !== 'string' ||
    typeof message.conversationId !== 'string' ||
    !['user', 'assistant', 'system'].includes(String(message.role)) ||
    typeof message.content !== 'string' ||
    typeof message.timestamp !== 'number'
  ) {
    throw new Error('Invalid message in import file');
  }

  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role as Message['role'],
    content: message.content.slice(0, MAX_MESSAGE_CHARS),
    model: typeof message.model === 'string' ? resolveSafeModelId(message.model) : undefined,
    attachments: normalizeImportedAttachments(message.attachments),
    searchResults: normalizeImportedSearchResults(message.searchResults),
    researchTrace: normalizeImportedResearchTrace(message.researchTrace),
    documentExcerpts: normalizeImportedDocumentExcerpts(message.documentExcerpts),
    researchMode: typeof message.researchMode === 'boolean' ? message.researchMode : undefined,
    agentMode: typeof message.agentMode === 'boolean' ? message.agentMode : undefined,
    taskType: normalizeTaskType(message.taskType),
    autoRouted: typeof message.autoRouted === 'boolean' ? message.autoRouted : undefined,
    routingNote: typeof message.routingNote === 'string' ? message.routingNote.slice(0, 500) : undefined,
    compareRun: typeof message.compareRun === 'boolean' ? message.compareRun : undefined,
    preferred: typeof message.preferred === 'boolean' ? message.preferred : undefined,
    isError: typeof message.isError === 'boolean' ? message.isError : undefined,
    status: isValidMessageStatus(message.status) ? message.status : undefined,
    finishReason: typeof message.finishReason === 'string' ? message.finishReason.slice(0, 100) : undefined,
    tokenUsage: normalizeTokenUsage(message.tokenUsage),
    timestamp: message.timestamp,
  };
}

function isValidMessageStatus(value: unknown): value is MessageStatus {
  return value === 'complete' || value === 'interrupted' || value === 'failed' || value === 'degraded';
}

function normalizeTokenUsage(value: unknown): TokenUsage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const usage = value as Record<string, unknown>;
  const promptTokens = typeof usage.promptTokens === 'number' && Number.isFinite(usage.promptTokens)
    ? Math.max(0, Math.floor(usage.promptTokens))
    : undefined;
  const completionTokens = typeof usage.completionTokens === 'number' && Number.isFinite(usage.completionTokens)
    ? Math.max(0, Math.floor(usage.completionTokens))
    : undefined;
  const totalTokens = typeof usage.totalTokens === 'number' && Number.isFinite(usage.totalTokens)
    ? Math.max(0, Math.floor(usage.totalTokens))
    : undefined;

  if (promptTokens === undefined && completionTokens === undefined && totalTokens === undefined) {
    return undefined;
  }

  return { promptTokens, completionTokens, totalTokens };
}

function normalizeImportedAttachments(value: unknown): Attachment[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const attachments = value.flatMap((item): Attachment[] => {
    if (!item || typeof item !== 'object') return [];
    const attachment = item as Partial<Attachment>;
    if (
      typeof attachment.id !== 'string' ||
      typeof attachment.name !== 'string' ||
      typeof attachment.type !== 'string' ||
      typeof attachment.size !== 'number' ||
      typeof attachment.content !== 'string'
    ) {
      return [];
    }
    return [{
      id: attachment.id,
      name: attachment.name.slice(0, 255),
      type: attachment.type.slice(0, 100),
      size: attachment.size,
      content: attachment.content.slice(0, 50000),
    }];
  });

  return attachments.length > 0 ? attachments : undefined;
}

function normalizeImportedSearchResults(value: unknown): SearchResultRef[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const results = value.flatMap((item): SearchResultRef[] => {
    if (!item || typeof item !== 'object') return [];
    const result = item as Partial<SearchResultRef>;
    if (
      typeof result.title !== 'string' ||
      typeof result.url !== 'string' ||
      typeof result.snippet !== 'string'
    ) {
      return [];
    }
    return [{
      id: typeof result.id === 'string' ? result.id.slice(0, 50) : undefined,
      canonicalUrl: typeof result.canonicalUrl === 'string' ? result.canonicalUrl.slice(0, 1000) : undefined,
      domain: typeof result.domain === 'string' ? result.domain.slice(0, 100) : undefined,
      publishedAt: typeof result.publishedAt === 'string' ? result.publishedAt.slice(0, 50) : undefined,
      title: result.title.slice(0, 200),
      url: result.url.slice(0, 1000),
      snippet: result.snippet.slice(0, 1000),
      content: typeof result.content === 'string' ? result.content.slice(0, 5000) : undefined,
      extracted: typeof result.extracted === 'boolean' ? result.extracted : undefined,
      fetchedAt: typeof result.fetchedAt === 'number' ? result.fetchedAt : undefined,
      sourceScore: typeof result.sourceScore === 'number' ? Math.max(0, Math.min(100, Math.floor(result.sourceScore))) : undefined,
      sourceLabel: typeof result.sourceLabel === 'string' ? result.sourceLabel.slice(0, 40) : undefined,
      sourceReason: typeof result.sourceReason === 'string' ? result.sourceReason.slice(0, 200) : undefined,
    }];
  });

  return results.length > 0 ? results : undefined;
}

function normalizeImportedResearchTrace(value: unknown): Message['researchTrace'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const trace = value as Partial<NonNullable<Message['researchTrace']>>;
  if (
    typeof trace.query !== 'string' ||
    typeof trace.sourceCount !== 'number' ||
    typeof trace.openedCount !== 'number'
  ) {
    return undefined;
  }

  return {
    query: trace.query.slice(0, 500),
    plannedQueries: normalizeStringList(trace.plannedQueries, 8, 500),
    plannedEntities: normalizeStringList(trace.plannedEntities, 8, 100),
    planner: trace.planner === 'model' || trace.planner === 'heuristic' ? trace.planner : undefined,
    provider: typeof trace.provider === 'string' ? trace.provider.slice(0, 80) : undefined,
    providers: normalizeStringList(trace.providers, 8, 80),
    providerErrors: normalizeStringList(trace.providerErrors, 10, 300),
    sourceCount: Math.max(Math.floor(trace.sourceCount), 0),
    openedCount: Math.max(Math.floor(trace.openedCount), 0),
  };
}

function normalizeStringList(value: unknown, maxItems: number, maxChars: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.flatMap((item): string[] =>
    typeof item === 'string' && item.trim()
      ? [item.trim().slice(0, maxChars)]
      : []
  ).slice(0, maxItems);
  return list.length > 0 ? list : undefined;
}

function validateArtifact(value: unknown): Artifact {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid artifact in import file');
  }

  const artifact = value as Partial<Artifact>;
  if (
    typeof artifact.id !== 'string' ||
    typeof artifact.conversationId !== 'string' ||
    typeof artifact.title !== 'string' ||
    typeof artifact.language !== 'string' ||
    typeof artifact.content !== 'string' ||
    typeof artifact.createdAt !== 'number' ||
    typeof artifact.updatedAt !== 'number'
  ) {
    throw new Error('Invalid artifact in import file');
  }

  return {
    id: artifact.id,
    conversationId: artifact.conversationId,
    projectId: typeof artifact.projectId === 'string' ? artifact.projectId : undefined,
    sourceMessageId: typeof artifact.sourceMessageId === 'string' ? artifact.sourceMessageId : undefined,
    sourceKey: typeof artifact.sourceKey === 'string' ? artifact.sourceKey : undefined,
    title: artifact.title.slice(0, MAX_TITLE_CHARS),
    language: artifact.language.slice(0, 50),
    content: artifact.content.slice(0, MAX_ARTIFACT_CHARS),
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
  };
}

function validateDocumentRecord(value: unknown): DocumentRecord {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid document in import file');
  }
  const doc = value as Partial<DocumentRecord>;
  if (
    typeof doc.id !== 'string' ||
    typeof doc.conversationId !== 'string' ||
    typeof doc.filename !== 'string' ||
    typeof doc.mediaType !== 'string' ||
    typeof doc.fileSize !== 'number' ||
    typeof doc.fingerprint !== 'string' ||
    typeof doc.chunkCount !== 'number' ||
    typeof doc.totalTokens !== 'number' ||
    typeof doc.createdAt !== 'number' ||
    typeof doc.updatedAt !== 'number'
  ) {
    throw new Error('Invalid document in import file');
  }
  return {
    id: doc.id,
    conversationId: doc.conversationId,
    projectId: typeof doc.projectId === 'string' ? doc.projectId : undefined,
    filename: doc.filename.slice(0, 255),
    mediaType: doc.mediaType.slice(0, 100),
    fileSize: Math.max(0, Math.floor(doc.fileSize)),
    fingerprint: doc.fingerprint.slice(0, 128),
    status: isValidDocumentStatus(doc.status) ? doc.status : 'ready',
    warning: typeof doc.warning === 'string' ? doc.warning.slice(0, 500) : undefined,
    error: typeof doc.error === 'string' ? doc.error.slice(0, 500) : undefined,
    pageCount: typeof doc.pageCount === 'number' ? Math.max(1, Math.floor(doc.pageCount)) : undefined,
    chunkCount: Math.max(0, Math.floor(doc.chunkCount)),
    totalTokens: Math.max(0, Math.floor(doc.totalTokens)),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function isValidDocumentStatus(value: unknown): value is DocumentProcessingStatus {
  return [
    'selected',
    'validating',
    'extracting',
    'indexing',
    'ready',
    'partially-processed',
    'failed',
    'cancelled',
  ].includes(value as string);
}

function validateDocumentChunk(value: unknown): DocumentChunk {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid document chunk in import file');
  }
  const chunk = value as Partial<DocumentChunk>;
  if (
    typeof chunk.id !== 'string' ||
    typeof chunk.documentId !== 'string' ||
    typeof chunk.conversationId !== 'string' ||
    typeof chunk.chunkIndex !== 'number' ||
    typeof chunk.text !== 'string' ||
    typeof chunk.tokenCount !== 'number'
  ) {
    throw new Error('Invalid document chunk in import file');
  }
  return {
    id: chunk.id,
    documentId: chunk.documentId,
    conversationId: chunk.conversationId,
    chunkIndex: Math.max(0, Math.floor(chunk.chunkIndex)),
    text: chunk.text.slice(0, 20000),
    tokenCount: Math.max(0, Math.floor(chunk.tokenCount)),
    pageNumber: typeof chunk.pageNumber === 'number' ? Math.max(1, Math.floor(chunk.pageNumber)) : undefined,
    startLine: typeof chunk.startLine === 'number' ? Math.max(1, Math.floor(chunk.startLine)) : undefined,
    endLine: typeof chunk.endLine === 'number' ? Math.max(1, Math.floor(chunk.endLine)) : undefined,
    sectionHeading: typeof chunk.sectionHeading === 'string' ? chunk.sectionHeading.slice(0, 200) : undefined,
  };
}

function normalizeImportedDocumentExcerpts(value: unknown): DocumentExcerpt[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const excerpts = value.flatMap((item): DocumentExcerpt[] => {
    if (!item || typeof item !== 'object') return [];
    const exc = item as Partial<DocumentExcerpt>;
    if (
      typeof exc.chunkId !== 'string' ||
      typeof exc.documentId !== 'string' ||
      typeof exc.docIndex !== 'number' ||
      typeof exc.filename !== 'string' ||
      typeof exc.citationId !== 'string' ||
      typeof exc.text !== 'string' ||
      typeof exc.score !== 'number'
    ) {
      return [];
    }
    return [{
      chunkId: exc.chunkId,
      documentId: exc.documentId,
      docIndex: Math.max(1, Math.floor(exc.docIndex)),
      filename: exc.filename.slice(0, 255),
      citationId: exc.citationId.slice(0, 50),
      text: exc.text.slice(0, 10000),
      score: exc.score,
      pageNumber: typeof exc.pageNumber === 'number' ? Math.max(1, Math.floor(exc.pageNumber)) : undefined,
      startLine: typeof exc.startLine === 'number' ? Math.max(1, Math.floor(exc.startLine)) : undefined,
      endLine: typeof exc.endLine === 'number' ? Math.max(1, Math.floor(exc.endLine)) : undefined,
      sectionHeading: typeof exc.sectionHeading === 'string' ? exc.sectionHeading.slice(0, 200) : undefined,
    }];
  });
  return excerpts.length > 0 ? excerpts : undefined;
}
