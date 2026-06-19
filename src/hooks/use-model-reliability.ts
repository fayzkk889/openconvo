'use client';

import { useCallback, useEffect, useState } from 'react';
import type { TaskType } from '@/types/chat';
import type { ModelReliability } from '@/types/models';
import { getModelReliability, recordModelOutcome, recordModelPreference } from '@/lib/storage';

export function useModelReliability() {
  const [reliability, setReliability] = useState<ModelReliability[]>([]);

  const refresh = useCallback(async () => {
    try {
      setReliability(await getModelReliability());
    } catch (err) {
      console.error('Failed to load model reliability:', err);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const recordOutcome = useCallback(
    async ({
      modelId,
      taskType,
      outcome,
      latencyMs,
    }: {
      modelId: string;
      taskType?: TaskType;
      outcome: ModelReliability['lastOutcome'];
      latencyMs?: number;
    }) => {
      try {
        const updated = await recordModelOutcome({ modelId, taskType, outcome, latencyMs });
        setReliability((prev) => [
          ...prev.filter((item) => item.id !== updated.id),
          updated,
        ]);
      } catch (err) {
        console.error('Failed to record model reliability:', err);
      }
    },
    []
  );

  const recordRateLimitedModels = useCallback(
    async (modelIds: string[], taskType?: TaskType) => {
      await Promise.all(
        modelIds.map((modelId) =>
          recordOutcome({ modelId, taskType, outcome: 'rate_limited' })
        )
      );
    },
    [recordOutcome]
  );

  const recordPreference = useCallback(
    async ({ modelId, taskType }: { modelId: string; taskType?: TaskType }) => {
      try {
        const updated = await recordModelPreference({ modelId, taskType });
        setReliability((prev) => [
          ...prev.filter((item) => item.id !== updated.id),
          updated,
        ]);
      } catch (err) {
        console.error('Failed to record model preference:', err);
      }
    },
    []
  );

  return {
    reliability,
    recordOutcome,
    recordRateLimitedModels,
    recordPreference,
    refresh,
  };
}
