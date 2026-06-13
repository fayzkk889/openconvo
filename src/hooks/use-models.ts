'use client';

import { useState, useEffect, useCallback } from 'react';
import { AIModel } from '@/types/models';
import { CURATED_FREE_MODELS, DEFAULT_MODEL_ID, resolveSafeModelId } from '@/lib/models';

const STORAGE_KEY = 'openconvo-selected-model';
const COOLDOWN_STORAGE_KEY = 'openconvo-model-cooldowns';

type CooldownMap = Record<string, number>;

export function useModels(apiKey?: string, defaultModel = DEFAULT_MODEL_ID) {
  const [models, setModels] = useState<AIModel[]>(CURATED_FREE_MODELS);
  const [selectedModel, setSelectedModelState] = useState<string>(() =>
    resolveSafeModelId(defaultModel, CURATED_FREE_MODELS)
  );
  const [loading, setLoading] = useState(true);

  const readCooldowns = useCallback((): CooldownMap => {
    try {
      const parsed = JSON.parse(localStorage.getItem(COOLDOWN_STORAGE_KEY) || '{}') as CooldownMap;
      const now = Date.now();
      return Object.fromEntries(
        Object.entries(parsed).filter(([, expiresAt]) => typeof expiresAt === 'number' && expiresAt > now)
      );
    } catch {
      return {};
    }
  }, []);

  const applyCooldowns = useCallback((items: AIModel[]) => {
    const cooldowns = readCooldowns();
    return items.map((model) => ({
      ...model,
      cooldownUntil: cooldowns[model.id],
    }));
  }, [readCooldowns]);

  // Load selected model from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const safeModel = resolveSafeModelId(saved || defaultModel, models);
    setSelectedModelState(safeModel);
    localStorage.setItem(STORAGE_KEY, safeModel);
  }, [defaultModel, models]);

  // Fetch models from API
  useEffect(() => {
    fetchModels();
  }, [apiKey]);

  useEffect(() => {
    const nextExpiry = models
      .map((model) => model.cooldownUntil)
      .filter((expiresAt): expiresAt is number => Boolean(expiresAt && expiresAt > Date.now()))
      .sort((a, b) => a - b)[0];

    if (!nextExpiry) return;

    const timeout = window.setTimeout(() => {
      setModels((prev) => applyCooldowns(prev));
    }, Math.max(nextExpiry - Date.now(), 1000));

    return () => window.clearTimeout(timeout);
  }, [applyCooldowns, models]);

  const fetchModels = async () => {
    try {
      const headers: Record<string, string> = {};
      if (apiKey) headers['x-openrouter-key'] = apiKey;
      
      const res = await fetch('/api/models', { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.models?.length > 0) {
          setModels(applyCooldowns(data.models));
          setSelectedModelState((current) => {
            const safeModel = resolveSafeModelId(current || defaultModel, data.models);
            localStorage.setItem(STORAGE_KEY, safeModel);
            return safeModel;
          });
        }
      }
    } catch (err) {
      console.error('Failed to fetch models:', err);
    } finally {
      setLoading(false);
    }
  };

  const setSelectedModel = useCallback((modelId: string) => {
    const safeModel = resolveSafeModelId(modelId, models);
    setSelectedModelState(safeModel);
    localStorage.setItem(STORAGE_KEY, safeModel);
  }, [models]);

  const markModelsCoolingDown = useCallback((modelIds: string[], retryAfterSeconds?: number) => {
    if (modelIds.length === 0) return;
    const cooldownMs = Math.max((retryAfterSeconds || 30) * 1000, 30 * 1000);
    const expiresAt = Date.now() + cooldownMs;
    const cooldowns = readCooldowns();
    for (const modelId of modelIds) {
      cooldowns[modelId] = expiresAt;
    }
    localStorage.setItem(COOLDOWN_STORAGE_KEY, JSON.stringify(cooldowns));
    setModels((prev) => applyCooldowns(prev));
  }, [applyCooldowns, readCooldowns]);

  return {
    models,
    selectedModel,
    setSelectedModel,
    markModelsCoolingDown,
    loading,
  };
}
