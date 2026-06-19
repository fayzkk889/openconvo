import { openDB, IDBPDatabase } from 'idb';
import { Artifact, Conversation, Message, Project } from '@/types/chat';
import { ModelReliability } from '@/types/models';

const DB_NAME = 'openconvo';
const DB_VERSION = 4;

interface OpenConvoDB {
  projects: {
    key: string;
    value: Project;
    indexes: {};
  };
  conversations: {
    key: string;
    value: Conversation;
    indexes: { 'by-project': string };
  };
  messages: {
    key: string;
    value: Message;
    indexes: { 'by-conversation': string };
  };
  artifacts: {
    key: string;
    value: Artifact;
    indexes: { 'by-conversation': string; 'by-project': string };
  };
  modelReliability: {
    key: string;
    value: ModelReliability;
    indexes: { 'by-model': string; 'by-task': string };
  };
}

let dbPromise: Promise<IDBPDatabase<OpenConvoDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<OpenConvoDB>> {
  if (!dbPromise) {
    dbPromise = openDB<OpenConvoDB>(DB_NAME, DB_VERSION, {
      upgrade(db, _oldVersion, _newVersion, transaction) {
        if (!db.objectStoreNames.contains('projects')) {
          db.createObjectStore('projects', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('conversations')) {
          const conversationStore = db.createObjectStore('conversations', { keyPath: 'id' });
          conversationStore.createIndex('by-project', 'projectId');
        } else {
          const conversationStore = transaction.objectStore('conversations');
          if (!conversationStore.indexNames.contains('by-project')) {
            conversationStore.createIndex('by-project', 'projectId');
          }
        }
        if (!db.objectStoreNames.contains('messages')) {
          const messageStore = db.createObjectStore('messages', { keyPath: 'id' });
          messageStore.createIndex('by-conversation', 'conversationId');
        }
        if (!db.objectStoreNames.contains('artifacts')) {
          const artifactStore = db.createObjectStore('artifacts', { keyPath: 'id' });
          artifactStore.createIndex('by-conversation', 'conversationId');
          artifactStore.createIndex('by-project', 'projectId');
        } else {
          const artifactStore = transaction.objectStore('artifacts');
          if (!artifactStore.indexNames.contains('by-conversation')) {
            artifactStore.createIndex('by-conversation', 'conversationId');
          }
          if (!artifactStore.indexNames.contains('by-project')) {
            artifactStore.createIndex('by-project', 'projectId');
          }
        }
        if (!db.objectStoreNames.contains('modelReliability')) {
          const reliabilityStore = db.createObjectStore('modelReliability', { keyPath: 'id' });
          reliabilityStore.createIndex('by-model', 'modelId');
          reliabilityStore.createIndex('by-task', 'taskType');
        } else {
          const reliabilityStore = transaction.objectStore('modelReliability');
          if (!reliabilityStore.indexNames.contains('by-model')) {
            reliabilityStore.createIndex('by-model', 'modelId');
          }
          if (!reliabilityStore.indexNames.contains('by-task')) {
            reliabilityStore.createIndex('by-task', 'taskType');
          }
        }
      },
    });
  }
  return dbPromise;
}
