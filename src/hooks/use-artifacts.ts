'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Artifact, Conversation, Message } from '@/types/chat';
import { extractArtifacts, toStoredArtifact } from '@/lib/artifacts';
import * as storage from '@/lib/storage';

export function useArtifacts(conversation: Conversation | null, messages: Message[], isStreaming = false) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const extracted = useMemo(() => extractArtifacts(messages), [messages]);
  const activeConversationId = conversation?.id || null;
  const activeConvIdRef = useRef<string | null>(activeConversationId);
  activeConvIdRef.current = activeConversationId;

  const loadArtifacts = useCallback(async () => {
    if (!activeConversationId) {
      setArtifacts([]);
      return;
    }
    const currentConvId = activeConversationId;
    const loaded = await storage.getArtifacts(currentConvId);
    if (activeConvIdRef.current === currentConvId) {
      setArtifacts(loaded);
    }
  }, [activeConversationId]);

  useEffect(() => {
    loadArtifacts();
  }, [loadArtifacts]);

  useEffect(() => {
    if (!conversation || isStreaming || extracted.length === 0) return;

    const sync = async () => {
      const currentConvId = conversation.id;
      const current = await storage.getArtifacts(currentConvId);
      if (activeConvIdRef.current !== currentConvId) return;

      const existingKeys = new Set(
        current.map((artifact) => artifact.sourceKey || `${artifact.sourceMessageId || artifact.id}:${artifact.language}`)
      );

      let changed = false;
      for (const item of extracted) {
        const key = item.sourceKey;
        if (existingKeys.has(key)) continue;
        await storage.addArtifact(toStoredArtifact(item, conversation));
        changed = true;
      }

      if (changed && activeConvIdRef.current === currentConvId) {
        setArtifacts(await storage.getArtifacts(currentConvId));
      }
    };

    sync().catch((error) => {
      console.error('Failed to sync artifacts:', error);
    });
  }, [conversation, extracted, isStreaming]);

  const updateArtifact = useCallback(async (id: string, updates: Partial<Artifact>) => {
    await storage.updateArtifact(id, updates);
    await loadArtifacts();
  }, [loadArtifacts]);

  const deleteArtifact = useCallback(async (id: string) => {
    await storage.deleteArtifact(id);
    await loadArtifacts();
  }, [loadArtifacts]);

  return {
    artifacts,
    updateArtifact,
    deleteArtifact,
    refreshArtifacts: loadArtifacts,
  };
}
