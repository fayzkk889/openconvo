import { SearchResponse, SearchResult } from '@/types/search';

const TAVILY_BASE = 'https://api.tavily.com';

export async function searchWeb(
  query: string,
  clientKey?: string | null,
  mode: 'search' | 'research' = 'search'
): Promise<SearchResponse> {
  const apiKey = clientKey || process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error('TAVILY_API_KEY is not set. Web search is unavailable.');
  }

  const response = await fetch(`${TAVILY_BASE}/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: mode === 'research' ? 'advanced' : 'basic',
      include_answer: true,
      max_results: mode === 'research' ? 8 : 5,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Tavily search error ${response.status}: ${errorText}`);
  }

  const data = await response.json() as {
    results?: Array<{ title?: unknown; url?: unknown; content?: unknown }>;
    answer?: unknown;
  };

  const results: SearchResult[] = (data.results || []).flatMap((r) => {
    if (typeof r.url !== 'string' || !r.url.trim()) return [];
    const content = typeof r.content === 'string' ? r.content : '';
    return [{
      title: typeof r.title === 'string' && r.title.trim() ? r.title : 'Untitled',
      url: r.url,
      snippet: content.slice(0, 300),
      content,
    }];
  });

  return {
    query,
    results,
    answer: typeof data.answer === 'string' ? data.answer : undefined,
  };
}
