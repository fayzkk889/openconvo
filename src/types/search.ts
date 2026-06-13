export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  content?: string;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  answer?: string;
}
