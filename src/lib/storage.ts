import { getDB } from './db';
import { Artifact, Conversation, Message, Project } from '@/types/chat';
import { generateId } from './utils';
import { DEFAULT_MODEL_ID } from './models';

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
  const tx = db.transaction(['conversations', 'messages', 'artifacts'], 'readwrite');
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
  await tx.done;
}

// ---- Messages ----

export async function addMessage(
  conversationId: string,
  message: Omit<Message, 'id' | 'conversationId' | 'timestamp'>
): Promise<Message> {
  const db = await getDB();
  const fullMessage: Message = {
    ...message,
    id: generateId(),
    conversationId,
    timestamp: Date.now(),
  };
  await db.put('messages', fullMessage);
  // Update conversation timestamp
  await updateConversation(conversationId, {});
  return fullMessage;
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

// ---- Bulk operations ----

export async function clearAllData(): Promise<void> {
  const db = await getDB();
  await db.clear('projects');
  await db.clear('conversations');
  await db.clear('messages');
  await db.clear('artifacts');
}

export async function exportAllData(): Promise<{ projects: Project[]; conversations: Conversation[]; messages: Message[]; artifacts: Artifact[] }> {
  const db = await getDB();
  const projects = await db.getAll('projects');
  const conversations = await db.getAll('conversations');
  const messages = await db.getAll('messages');
  const artifacts = await db.getAll('artifacts');
  return { projects, conversations, messages, artifacts };
}

export async function importAllData(data: { projects?: Project[]; conversations: Conversation[]; messages: Message[]; artifacts?: Artifact[] }): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['projects', 'conversations', 'messages', 'artifacts'], 'readwrite');
  const projectStore = tx.objectStore('projects');
  const conversationStore = tx.objectStore('conversations');
  const messageStore = tx.objectStore('messages');
  const artifactStore = tx.objectStore('artifacts');

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

  await tx.done;
}
