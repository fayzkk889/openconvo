'use client';

import { useState, useCallback } from 'react';
import { SearchResponse } from '@/types/search';

export function useSearch() {
  const [searchEnabled, setSearchEnabled] = useState(false);
  const [researchEnabled, setResearchEnabled] = useState(false);
  const [agentEnabled, setAgentEnabled] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  const toggleSearch = useCallback(() => {
    setSearchEnabled((prev) => !prev);
  }, []);

  const toggleResearch = useCallback(() => {
    setResearchEnabled((prev) => {
      const next = !prev;
      if (next) setSearchEnabled(true);
      return next;
    });
  }, []);

  const toggleAgent = useCallback(() => {
    setAgentEnabled((prev) => !prev);
  }, []);

  const performSearch = useCallback(async (query: string): Promise<SearchResponse | null> => {
    setIsSearching(true);
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Search failed');
      }
      return await res.json();
    } catch (error) {
      console.error('Search error:', error);
      return null;
    } finally {
      setIsSearching(false);
    }
  }, []);

  return {
    searchEnabled,
    researchEnabled,
    agentEnabled,
    setSearchEnabled,
    setResearchEnabled,
    setAgentEnabled,
    isSearching,
    toggleSearch,
    toggleResearch,
    toggleAgent,
    performSearch,
  };
}
