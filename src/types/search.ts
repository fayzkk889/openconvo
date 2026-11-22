export interface SearchResult {
  id?: string; // Stable source identifier e.g. 'src_1', 'src_2'
  title: string;
  url: string;
  canonicalUrl?: string;
  domain?: string;
  snippet: string;
  content?: string;
  extracted?: boolean; // True only if page was actually opened and read
  fetchedAt?: number;
  publishedAt?: string;
  provider?: string;
  relevanceScore?: number;
  sourceScore?: number;
  sourceLabel?: string;
  sourceReason?: string;
  queryProvenance?: string;
  limitations?: string[];
}

export interface CanonicalEvidence extends SearchResult {
  id: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  extracted: boolean;
  retrievedAt: number;
}

export interface StructuredResearchPlan {
  originalQuery: string;
  primaryObjective: string;
  entities: string[];
  timeConstraints?: string;
  comparisonDimensions?: string[];
  researchQuestions: string[];
  queries: string[];
  knownLimitations?: string[];
  stoppingCriteria?: string;
}

export interface SearchResponse {
  query: string;
  plan?: StructuredResearchPlan;
  plannedQueries?: string[];
  plannedEntities?: string[];
  planner?: 'model' | 'heuristic';
  mode?: 'search' | 'research' | 'deep-research';
  results: SearchResult[];
  evidenceGaps?: string[];
  answer?: string;
  provider?: string;
  providers?: string[];
  providerErrors?: string[];
}
