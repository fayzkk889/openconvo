import { getDB } from './db';
import { Artifact, Conversation, Message, Project, TaskType } from '@/types/chat';
import { ModelReliability } from '@/types/models';
import { DocumentRecord, DocumentChunk } from '@/types/document';
import { generateId } from './utils';
import { DEFAULT_MODEL_ID } from './models';
import { normalizeTaskType } from './tasks';

// ---- Conversations ----

export async function createProject(name = 'New project'): Promise<Project> {
  const db = await getDB();
  const now = Date.now();
  const project: Project = {
    id: generateId(),
    name,
    createdAt: now,
    updatedAt: now,
  };
  await db.put('projects', project);
  return project;
}

export async function getAllProjects(): Promise<Project[]> {
  const db = await getDB();
  const all = await db.getAll('projects');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function updateProject(id: string, updates: Partial<Project>): Promise<void> {
  const db = await getDB();
  const existing = await db.get('projects', id);
  if (!existing) return;
  await db.put('projects', { ...existing, ...updates, updatedAt: Date.now() });
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['projects', 'conversations', 'artifacts'], 'readwrite');
  await tx.objectStore('projects').delete(id);

  const conversationStore = tx.objectStore('conversations');
  const index = conversationStore.index('by-project');
  let cursor = await index.openCursor(id);
  while (cursor) {
    const conversation = { ...cursor.value };
    delete conversation.projectId;
    await cursor.update(conversation);
    cursor = await cursor.continue();
  }

  const artifactStore = tx.objectStore('artifacts');
  const artifactIndex = artifactStore.index('by-project');
  let artifactCursor = await artifactIndex.openCursor(id);
  while (artifactCursor) {
    const artifact = { ...artifactCursor.value };
    delete artifact.projectId;
    await artifactCursor.update(artifact);
    artifactCursor = await artifactCursor.continue();
  }

  await tx.done;
}

// ---- Conversations ----

export async function createConversation(model?: string, projectId?: string): Promise<Conversation> {
  const db = await getDB();
  const now = Date.now();
  const conversation: Conversation = {
    id: generateId(),
    title: 'New conversation',
    model: model || DEFAULT_MODEL_ID,
    projectId,
    createdAt: now,
    updatedAt: now,
  };
  await db.put('conversations', conversation);
  return conversation;
}

export async function getConversation(id: string): Promise<Conversation | undefined> {
  const db = await getDB();
  return db.get('conversations', id);
}

export async function getAllConversations(): Promise<Conversation[]> {
  const db = await getDB();
  const all = await db.getAll('conversations');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function updateConversation(id: string, updates: Partial<Conversation>): Promise<void> {
  const db = await getDB();
  const existing = await db.get('conversations', id);
  if (!existing) return;
  await db.put('conversations', { ...existing, ...updates, updatedAt: Date.now() });
}

export async function deleteConversation(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['conversations', 'messages', 'artifacts', 'documents', 'documentChunks'], 'readwrite');
  await tx.objectStore('conversations').delete(id);

  const messageStore = tx.objectStore('messages');
  const messageIndex = messageStore.index('by-conversation');
  let messageCursor = await messageIndex.openCursor(id);
  while (messageCursor) {
    await messageCursor.delete();
    messageCursor = await messageCursor.continue();
  }

  const artifactStore = tx.objectStore('artifacts');
  const artifactIndex = artifactStore.index('by-conversation');
  let artifactCursor = await artifactIndex.openCursor(id);
  while (artifactCursor) {
    await artifactCursor.delete();
    artifactCursor = await artifactCursor.continue();
  }

  const documentStore = tx.objectStore('documents');
  const documentIndex = documentStore.index('by-conversation');
  let documentCursor = await documentIndex.openCursor(id);
  while (documentCursor) {
    await documentCursor.delete();
    documentCursor = await documentCursor.continue();
  }

  const chunkStore = tx.objectStore('documentChunks');
  const chunkIndex = chunkStore.index('by-conversation');
  let chunkCursor = await chunkIndex.openCursor(id);
  while (chunkCursor) {
    await chunkCursor.delete();
    chunkCursor = await chunkCursor.continue();
  }

  await tx.done;
}

// ---- Messages ----

export async function addMessage(
  conversationId: string,
  message: Omit<Message, 'id' | 'conversationId' | 'timestamp'>
): Promise<Message | null> {
  const db = await getDB();
  const tx = db.transaction(['conversations', 'messages'], 'readwrite');
  const convStore = tx.objectStore('conversations');
  const existingConv = await convStore.get(conversationId);
  if (!existingConv) {
    await tx.done;
    return null; // Atomic check: conversation does not exist, abort message write!
  }

  const fullMessage: Message = {
    ...message,
    id: generateId(),
    conversationId,
    timestamp: Date.now(),
  };
  await tx.objectStore('messages').put(fullMessage);
  await convStore.put({ ...existingConv, updatedAt: Date.now() });
  await tx.done;
  return fullMessage;
}

export async function updateAutoTitle(id: string, title: string): Promise<boolean> {
  const db = await getDB();
  const tx = db.transaction('conversations', 'readwrite');
  const store = tx.objectStore('conversations');
  const existing = await store.get(id);
  // Transactional guard: If conversation does not exist OR user already manually set the title, ABORT!
  if (!existing || existing.titleManuallySet) {
    await tx.done;
    return false;
  }
  await store.put({ ...existing, title, updatedAt: Date.now() });
  await tx.done;
  return true;
}

export async function getMessages(conversationId: string): Promise<Message[]> {
  const db = await getDB();
  const messages = await db.getAllFromIndex('messages', 'by-conversation', conversationId);
  return messages.sort((a, b) => a.timestamp - b.timestamp);
}

export async function updateMessage(id: string, updates: Partial<Message>): Promise<void> {
  const db = await getDB();
  const existing = await db.get('messages', id);
  if (!existing) return;
  await db.put('messages', { ...existing, ...updates });
}

export async function deleteMessage(id: string): Promise<void> {
  const db = await getDB();
  const message = await db.get('messages', id);
  await db.delete('messages', id);
  if (!message) return;

  const tx = db.transaction('artifacts', 'readwrite');
  const index = tx.store.index('by-conversation');
  let cursor = await index.openCursor(message.conversationId);
  while (cursor) {
    if (cursor.value.sourceMessageId === id) {
      await cursor.delete();
    }
    cursor = await cursor.continue();
  }
  await tx.done;
}

/**
 * Step 0 Invariants 1 & 2: Atomically replace a list of historical messages with a replacement message
 * inside a single IndexedDB transaction. If anything fails, the entire transaction rolls back.
 */
export async function replaceMessagesTransactional(
  conversationId: string,
  deleteMessageIds: string[],
  newMessage: Omit<Message, 'id' | 'conversationId' | 'timestamp'>
): Promise<Message> {
  const db = await getDB();
  const tx = db.transaction(['messages', 'artifacts', 'conversations'], 'readwrite');
  const messageStore = tx.objectStore('messages');

  for (const id of deleteMessageIds) {
    await messageStore.delete(id);
  }

  const artifactStore = tx.objectStore('artifacts');
  const artifactIndex = artifactStore.index('by-conversation');
  let cursor = await artifactIndex.openCursor(conversationId);
  while (cursor) {
    if (cursor.value.sourceMessageId && deleteMessageIds.includes(cursor.value.sourceMessageId)) {
      await cursor.delete();
    }
    cursor = await cursor.continue();
  }

  const fullMessage: Message = {
    ...newMessage,
    id: generateId(),
    conversationId,
    timestamp: Date.now(),
  };
  await messageStore.put(fullMessage);

  const conversationStore = tx.objectStore('conversations');
  const existingConv = await conversationStore.get(conversationId);
  if (existingConv) {
    await conversationStore.put({ ...existingConv, updatedAt: Date.now() });
  }

  await tx.done;
  return fullMessage;
}

// ---- Artifacts ----

export async function addArtifact(
  artifact: Omit<Artifact, 'id' | 'createdAt' | 'updatedAt'>
): Promise<Artifact> {
  const db = await getDB();
  const now = Date.now();
  const fullArtifact: Artifact = {
    ...artifact,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
  };
  await db.put('artifacts', fullArtifact);
  return fullArtifact;
}

export async function putArtifact(artifact: Artifact): Promise<void> {
  const db = await getDB();
  await db.put('artifacts', { ...artifact, updatedAt: Date.now() });
}

export async function getArtifacts(conversationId: string): Promise<Artifact[]> {
  const db = await getDB();
  const artifacts = await db.getAllFromIndex('artifacts', 'by-conversation', conversationId);
  return artifacts.sort((a, b) => a.updatedAt - b.updatedAt);
}

export async function updateArtifact(id: string, updates: Partial<Artifact>): Promise<void> {
  const db = await getDB();
  const existing = await db.get('artifacts', id);
  if (!existing) return;
  await db.put('artifacts', { ...existing, ...updates, updatedAt: Date.now() });
}

export async function deleteArtifact(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('artifacts', id);
}

// ---- Local model reliability ----

export async function getModelReliability(): Promise<ModelReliability[]> {
  const db = await getDB();
  return db.getAll('modelReliability');
}

export async function clearModelReliability(): Promise<void> {
  const db = await getDB();
  await db.clear('modelReliability');
}

export async function recordModelOutcome({
  modelId,
  taskType,
  outcome,
  latencyMs = 0,
}: {
  modelId: string;
  taskType?: TaskType;
  outcome: ModelReliability['lastOutcome'];
  latencyMs?: number;
}): Promise<ModelReliability> {
  const db = await getDB();
  const normalizedTask = normalizeTaskType(taskType);
  const id = modelReliabilityId(modelId, normalizedTask);
  const existing = await db.get('modelReliability', id);
  const now = Date.now();
  const next: ModelReliability = {
    id,
    modelId,
    taskType: normalizedTask,
    successes: existing?.successes || 0,
    failures: existing?.failures || 0,
    rateLimits: existing?.rateLimits || 0,
    emptyCount: existing?.emptyCount || 0,
    interruptedCount: existing?.interruptedCount || 0,
    preferenceWins: existing?.preferenceWins || 0,
    totalLatencyMs: existing?.totalLatencyMs || 0,
    lastOutcome: outcome,
    lastUsedAt: now,
    updatedAt: now,
  };

  if (outcome === 'success') {
    next.successes += 1;
    next.totalLatencyMs += Math.max(Math.floor(latencyMs), 0);
  } else if (outcome === 'rate_limited') {
    next.rateLimits += 1;
  } else if (outcome === 'empty') {
    next.emptyCount = (next.emptyCount || 0) + 1;
    next.failures += 1;
  } else if (outcome === 'interrupted') {
    next.interruptedCount = (next.interruptedCount || 0) + 1;
    // Interrupted is a partial success / partial failure; slight penalty
    next.failures += 1;
  } else {
    next.failures += 1;
  }

  await db.put('modelReliability', next);
  return next;
}

export async function recordModelPreference({
  modelId,
  taskType,
}: {
  modelId: string;
  taskType?: TaskType;
}): Promise<ModelReliability> {
  const db = await getDB();
  const normalizedTask = normalizeTaskType(taskType);
  const id = modelReliabilityId(modelId, normalizedTask);
  const existing = await db.get('modelReliability', id);
  const now = Date.now();
  const next: ModelReliability = {
    id,
    modelId,
    taskType: normalizedTask,
    successes: existing?.successes || 0,
    failures: existing?.failures || 0,
    rateLimits: existing?.rateLimits || 0,
    preferenceWins: (existing?.preferenceWins || 0) + 1,
    totalLatencyMs: existing?.totalLatencyMs || 0,
    lastOutcome: 'success',
    lastUsedAt: now,
    updatedAt: now,
  };
  await db.put('modelReliability', next);
  return next;
}

function modelReliabilityId(modelId: string, taskType: TaskType): string {
  return `${taskType}:${modelId}`;
}

// ---- Bulk operations ----

export async function clearAllData(): Promise<void> {
  const db = await getDB();
  await db.clear('projects');
  await db.clear('conversations');
  await db.clear('messages');
  await db.clear('artifacts');
  await db.clear('modelReliability');
  await db.clear('documents');
  await db.clear('documentChunks');
}

// ---- Documents & Document Chunks ----

export async function saveDocument(doc: DocumentRecord, chunks: DocumentChunk[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['documents', 'documentChunks'], 'readwrite');
  await tx.objectStore('documents').put(doc);
  const chunkStore = tx.objectStore('documentChunks');
  for (const chunk of chunks) {
    await chunkStore.put(chunk);
  }
  await tx.done;
}

export async function getDocument(id: string): Promise<DocumentRecord | undefined> {
  const db = await getDB();
  return db.get('documents', id);
}

export async function getDocumentsByConversation(conversationId: string): Promise<DocumentRecord[]> {
  const db = await getDB();
  return db.getAllFromIndex('documents', 'by-conversation', conversationId);
}

export async function getDocumentChunks(documentId: string): Promise<DocumentChunk[]> {
  const db = await getDB();
  return db.getAllFromIndex('documentChunks', 'by-document', documentId);
}

export async function getConversationChunks(conversationId: string): Promise<DocumentChunk[]> {
  const db = await getDB();
  return db.getAllFromIndex('documentChunks', 'by-conversation', conversationId);
}

export async function deleteDocument(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['documents', 'documentChunks'], 'readwrite');
  await tx.objectStore('documents').delete(id);
  const chunkStore = tx.objectStore('documentChunks');
  const index = chunkStore.index('by-document');
  let cursor = await index.openCursor(id);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function exportAllData(): Promise<{
  projects: Project[];
  conversations: Conversation[];
  messages: Message[];
  artifacts: Artifact[];
  documents?: DocumentRecord[];
  documentChunks?: DocumentChunk[];
}> {
  const db = await getDB();
  const projects = await db.getAll('projects');
  const conversations = await db.getAll('conversations');
  const messages = await db.getAll('messages');
  const artifacts = await db.getAll('artifacts');
  const documents = await db.getAll('documents');
  const documentChunks = await db.getAll('documentChunks');
  return { projects, conversations, messages, artifacts, documents, documentChunks };
}

export async function importAllData(data: {
  projects?: Project[];
  conversations: Conversation[];
  messages: Message[];
  artifacts?: Artifact[];
  documents?: DocumentRecord[];
  documentChunks?: DocumentChunk[];
}): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['projects', 'conversations', 'messages', 'artifacts', 'documents', 'documentChunks'], 'readwrite');
  const projectStore = tx.objectStore('projects');
  const conversationStore = tx.objectStore('conversations');
  const messageStore = tx.objectStore('messages');
  const artifactStore = tx.objectStore('artifacts');
  const documentStore = tx.objectStore('documents');
  const chunkStore = tx.objectStore('documentChunks');

  for (const project of data.projects || []) {
    await projectStore.put(project);
  }

  for (const conv of data.conversations) {
    await conversationStore.put(conv);
  }

  for (const msg of data.messages) {
    await messageStore.put(msg);
  }

  for (const artifact of data.artifacts || []) {
    await artifactStore.put(artifact);
  }

  for (const doc of data.documents || []) {
    await documentStore.put(doc);
  }

  for (const chunk of data.documentChunks || []) {
    await chunkStore.put(chunk);
  }

  await tx.done;
}
