'use client';

import { useState, useEffect, useCallback } from 'react';
import { Conversation, Project } from '@/types/chat';
import * as storage from '@/lib/storage';

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  // Load all conversations on mount
  useEffect(() => {
    loadConversations();
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const all = await storage.getAllConversations();
      const allProjects = await storage.getAllProjects();
      setConversations(sortConversations(all));
      setProjects(allProjects);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const createNew = useCallback(async (model?: string): Promise<Conversation> => {
    const conv = await storage.createConversation(model, activeProjectId || undefined);
    setConversations((prev) => sortConversations([conv, ...prev]));
    setActiveId(conv.id);
    return conv;
  }, [activeProjectId]);

  const createProject = useCallback(async (): Promise<Project> => {
    const project = await storage.createProject();
    setProjects((prev) => [project, ...prev]);
    setActiveProjectId(project.id);
    setActiveId(null);
    return project;
  }, []);

  const selectProject = useCallback((id: string | null) => {
    setActiveProjectId(id);
    setActiveId(null);
  }, []);

  const renameProject = useCallback(async (id: string, name: string) => {
    await storage.updateProject(id, { name });
    setProjects((prev) =>
      prev.map((project) => (project.id === id ? { ...project, name, updatedAt: Date.now() } : project))
    );
  }, []);

  const updateProject = useCallback(async (id: string, updates: Partial<Project>) => {
    await storage.updateProject(id, updates);
    setProjects((prev) =>
      prev.map((project) =>
        project.id === id ? { ...project, ...updates, updatedAt: Date.now() } : project
      )
    );
  }, []);

  const removeProject = useCallback(async (id: string) => {
    await storage.deleteProject(id);
    setProjects((prev) => prev.filter((project) => project.id !== id));
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.projectId === id ? { ...conversation, projectId: undefined } : conversation
      )
    );
    if (activeProjectId === id) {
      setActiveProjectId(null);
      setActiveId(null);
    }
  }, [activeProjectId]);

  const select = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const rename = useCallback(async (id: string, title: string) => {
    await storage.updateConversation(id, { title });
    setConversations((prev) =>
      sortConversations(prev.map((c) => (c.id === id ? { ...c, title, updatedAt: Date.now() } : c)))
    );
  }, []);

  const remove = useCallback(async (id: string) => {
    await storage.deleteConversation(id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) {
      setActiveId(null);
    }
  }, [activeId]);

  const updateConversationModel = useCallback(async (id: string, model: string) => {
    await storage.updateConversation(id, { model });
    setConversations((prev) =>
      sortConversations(prev.map((c) => (c.id === id ? { ...c, model, updatedAt: Date.now() } : c)))
    );
  }, []);

  const togglePinned = useCallback(async (id: string) => {
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) return;
    const pinned = !conversation.pinned;
    await storage.updateConversation(id, { pinned });
    setConversations((prev) =>
      sortConversations(prev.map((c) => (c.id === id ? { ...c, pinned, updatedAt: Date.now() } : c)))
    );
  }, [conversations]);

  const toggleArchived = useCallback(async (id: string) => {
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) return;
    const archived = !conversation.archived;
    await storage.updateConversation(id, { archived, pinned: archived ? false : conversation.pinned });
    setConversations((prev) =>
      sortConversations(
        prev.map((c) =>
          c.id === id
            ? { ...c, archived, pinned: archived ? false : c.pinned, updatedAt: Date.now() }
            : c
        )
      )
    );
    if (archived && activeId === id) {
      setActiveId(null);
    }
  }, [activeId, conversations]);

  const refresh = useCallback(async () => {
    await loadConversations();
  }, [loadConversations]);

  const projectConversations = (activeProjectId
    ? conversations.filter((c) => c.projectId === activeProjectId)
    : conversations
  ).filter((c) => (showArchived ? c.archived : !c.archived));

  const filtered = searchQuery
    ? projectConversations.filter((c) =>
        c.title.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : projectConversations;

  const activeConversation = conversations.find((c) => c.id === activeId) || null;
  const activeProject = projects.find((project) => project.id === activeProjectId) || null;

  return {
    conversations: filtered,
    allConversations: conversations,
    projects,
    activeProjectId,
    activeProject,
    activeId,
    activeConversation,
    loading,
    searchQuery,
    setSearchQuery,
    showArchived,
    setShowArchived,
    createNew,
    createProject,
    selectProject,
    renameProject,
    updateProject,
    removeProject,
    select,
    rename,
    remove,
    updateConversationModel,
    togglePinned,
    toggleArchived,
    refresh,
  };
}

function sortConversations(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) {
      return a.pinned ? -1 : 1;
    }
    return b.updatedAt - a.updatedAt;
  });
}
