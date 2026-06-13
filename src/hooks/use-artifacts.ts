'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Artifact, Conversation, Message } from '@/types/chat';
import { extractArtifacts, toStoredArtifact } from '@/lib/artifacts';
import * as storage from '@/lib/storage';

export function useArtifacts(conversation: Conversation | null, messages: Message[], isStreaming = false) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const extracted = useMemo(() => extractArtifacts(messages), [messages]);

  const loadArtifacts = useCallback(async () => {
    if (!conversation) {
      setArtifacts([]);
      return;
    }
    setArtifacts(await storage.getArtifacts(conversation.id));
  }, [conversation]);

  useEffect(() => {
    loadArtifacts();
  }, [loadArtifacts]);

  useEffect(() => {
    if (!conversation || isStreaming || extracted.length === 0) return;

    const sync = async () => {
      const current = await storage.getArtifacts(conversation.id);
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

      if (changed) {
        setArtifacts(await storage.getArtifacts(conversation.id));
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
