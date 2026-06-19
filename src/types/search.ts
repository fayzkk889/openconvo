export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  content?: string;
  extracted?: boolean;
  fetchedAt?: number;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  answer?: string;
  provider?: string;
  providerErrors?: string[];
}
