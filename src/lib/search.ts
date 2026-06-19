import { SearchResponse, SearchResult } from '@/types/search';

const TAVILY_BASE = 'https://api.tavily.com';
const DUCKDUCKGO_HTML = 'https://html.duckduckgo.com/html/';

export async function searchWeb(
  query: string,
  clientKey?: string | null,
  mode: 'search' | 'research' = 'search'
): Promise<SearchResponse> {
  const apiKey = clientKey || process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return searchDuckDuckGo(query, mode);
  }

  let data: {
    results?: Array<{ title?: unknown; url?: unknown; content?: unknown }>;
    answer?: unknown;
  };

  try {
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
      throw new Error(`Tavily search error ${response.status}: ${await response.text()}`);
    }

    data = await response.json() as {
      results?: Array<{ title?: unknown; url?: unknown; content?: unknown }>;
      answer?: unknown;
    };
  } catch {
    return searchDuckDuckGo(query, mode);
  }

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

async function searchDuckDuckGo(
  query: string,
  mode: 'search' | 'research'
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query });
  let html = '';
  try {
    const response = await fetch(`${DUCKDUCKGO_HTML}?${params.toString()}`, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'User-Agent': 'OpenConvo/0.1 (+https://openconvo.vercel.app)',
      },
    });

    if (!response.ok) {
      return { query, results: [] };
    }

    html = await response.text();
  } catch {
    return { query, results: [] };
  }
  const blocks = html.match(/<div class="result[\s\S]*?<\/div>\s*<\/div>/g) || [];
  const results = blocks.flatMap((block): SearchResult[] => {
    const linkMatch = block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!linkMatch) return [];

    const url = normalizeDuckDuckGoUrl(decodeHtml(linkMatch[1]));
    if (!url) return [];

    const snippetMatch = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/div>/);
    const title = stripTags(decodeHtml(linkMatch[2])).trim() || 'Untitled';
    const snippet = stripTags(decodeHtml(snippetMatch?.[1] || snippetMatch?.[2] || '')).trim();

    return [{
      title: title.slice(0, 200),
      url,
      snippet: snippet.slice(0, 300),
      content: snippet,
    }];
  });

  return {
    query,
    results: dedupeResults(results).slice(0, mode === 'research' ? 8 : 5),
  };
}

function normalizeDuckDuckGoUrl(value: string): string | null {
  try {
    const url = new URL(value, DUCKDUCKGO_HTML);
    const uddg = url.searchParams.get('uddg');
    const target = new URL(uddg || url.href);
    if (!['http:', 'https:'].includes(target.protocol)) return null;
    return target.href;
  } catch {
    return null;
  }
}

function dedupeResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = result.url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
