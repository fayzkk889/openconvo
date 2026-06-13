'use client';

import { useState, useEffect, useCallback } from 'react';
import { Settings, DEFAULT_SETTINGS } from '@/types/settings';

const STORAGE_KEY = 'openconvo-settings';

export function useSettings() {
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setSettingsState(normalizeSettings(parsed));
      }
    } catch {
      // Use defaults
    }
    setLoaded(true);
  }, []);

  // Apply theme
  useEffect(() => {
    if (!loaded) return;
    document.documentElement.classList.toggle('dark', settings.theme === 'dark');
    document.documentElement.classList.toggle('light', settings.theme === 'light');
  }, [settings.theme, loaded]);

  const updateSettings = useCallback((updates: Partial<Settings>) => {
    setSettingsState((prev) => {
      const next = normalizeSettings({ ...prev, ...updates });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const resetSettings = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setSettingsState(DEFAULT_SETTINGS);
  }, []);

  return {
    settings,
    loaded,
    updateSettings,
    resetSettings,
  };
}

function normalizeSettings(value: unknown): Settings {
  const candidate = value && typeof value === 'object'
    ? value as Partial<Settings>
    : {};

  return {
    theme: candidate.theme === 'light' ? 'light' : 'dark',
    defaultModel: typeof candidate.defaultModel === 'string' && candidate.defaultModel.trim()
      ? candidate.defaultModel
      : DEFAULT_SETTINGS.defaultModel,
    systemPrompt: typeof candidate.systemPrompt === 'string'
      ? candidate.systemPrompt.slice(0, 10000)
      : '',
    memory: typeof candidate.memory === 'string'
      ? candidate.memory.slice(0, 20000)
      : '',
    memoryEnabled: typeof candidate.memoryEnabled === 'boolean'
      ? candidate.memoryEnabled
      : DEFAULT_SETTINGS.memoryEnabled,
    promptSnippets: normalizePromptSnippets(candidate.promptSnippets),
    searchEnabled: typeof candidate.searchEnabled === 'boolean'
      ? candidate.searchEnabled
      : DEFAULT_SETTINGS.searchEnabled,
    onboardingDismissed: typeof candidate.onboardingDismissed === 'boolean'
      ? candidate.onboardingDismissed
      : DEFAULT_SETTINGS.onboardingDismissed,
    openrouterApiKey: typeof candidate.openrouterApiKey === 'string'
      ? candidate.openrouterApiKey.trim()
      : '',
    tavilyApiKey: typeof candidate.tavilyApiKey === 'string'
      ? candidate.tavilyApiKey.trim()
      : '',
  };
}

function normalizePromptSnippets(value: unknown): Settings['promptSnippets'] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const snippet = item as Partial<Settings['promptSnippets'][number]>;
    if (typeof snippet.id !== 'string' || typeof snippet.title !== 'string' || typeof snippet.content !== 'string') {
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
