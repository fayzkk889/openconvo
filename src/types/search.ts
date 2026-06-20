export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  content?: string;
  extracted?: boolean;
  fetchedAt?: number;
  sourceScore?: number;
  sourceLabel?: string;
  sourceReason?: string;
}

export interface SearchResponse {
  query: string;
  plannedQueries?: string[];
  plannedEntities?: string[];
  planner?: 'model' | 'heuristic';
  mode?: 'search' | 'research' | 'deep-research';
  results: SearchResult[];
  answer?: string;
  provider?: string;
  providers?: string[];
  providerErrors?: string[];
}
