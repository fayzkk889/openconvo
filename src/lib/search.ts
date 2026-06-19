import { SearchResponse, SearchResult } from '@/types/search';

const TAVILY_BASE = 'https://api.tavily.com';
const DUCKDUCKGO_HTML = 'https://html.duckduckgo.com/html/';
const DEFAULT_USER_AGENT = 'OpenConvo/0.1 (+https://openconvo.vercel.app)';

type SearchMode = 'search' | 'research';

type SearchProviderContext = {
  query: string;
  mode: SearchMode;
  clientTavilyKey?: string | null;
};

type SearchProviderResult = {
  provider: string;
  answer?: string;
  results: SearchResult[];
};

type SearchProvider = {
  id: string;
  available: (context: SearchProviderContext) => boolean;
  search: (context: SearchProviderContext) => Promise<SearchProviderResult>;
};

export async function searchWeb(
  query: string,
  clientKey?: string | null,
  mode: SearchMode = 'search'
): Promise<SearchResponse> {
  const context: SearchProviderContext = {
    query,
    mode,
    clientTavilyKey: clientKey,
  };
  const providerErrors: string[] = [];

  for (const provider of getSearchProviders()) {
    if (!provider.available(context)) continue;
    try {
      const result = await provider.search(context);
      if (result.results.length > 0 || result.answer) {
        return {
          query,
          answer: result.answer,
          provider: result.provider,
          results: dedupeResults(result.results).slice(0, maxResultsForMode(mode)),
        };
      }
    } catch (error) {
      providerErrors.push(`${provider.id}: ${error instanceof Error ? error.message : 'failed'}`);
    }
  }

  return {
    query,
    provider: 'none',
    results: [],
    providerErrors,
  };
}

function getSearchProviders(): SearchProvider[] {
  return [
    tavilyProvider,
    searxngProvider,
    duckDuckGoProvider,
  ];
}

const tavilyProvider: SearchProvider = {
  id: 'tavily',
  available: (context) => Boolean(context.clientTavilyKey || process.env.TAVILY_API_KEY),
  async search(context) {
    const apiKey = context.clientTavilyKey || process.env.TAVILY_API_KEY;
    if (!apiKey) throw new Error('Tavily key is missing');

    const response = await fetch(`${TAVILY_BASE}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        query: context.query,
        search_depth: context.mode === 'research' ? 'advanced' : 'basic',
        include_answer: true,
        max_results: maxResultsForMode(context.mode),
      }),
    });

    if (!response.ok) {
      throw new Error(`Tavily search error ${response.status}: ${await response.text()}`);
    }

    const data = await response.json() as {
      results?: Array<{ title?: unknown; url?: unknown; content?: unknown }>;
      answer?: unknown;
    };

    return {
      provider: 'tavily',
      answer: typeof data.answer === 'string' ? data.answer : undefined,
      results: (data.results || []).flatMap((item) => normalizeResult({
        title: item.title,
        url: item.url,
        snippet: item.content,
        content: item.content,
      })),
    };
  },
};

const searxngProvider: SearchProvider = {
  id: 'searxng',
  available: () => Boolean(process.env.SEARXNG_URL),
  async search(context) {
    const baseUrl = process.env.SEARXNG_URL;
    if (!baseUrl) throw new Error('SearxNG URL is missing');

    const url = new URL('/search', baseUrl);
    url.searchParams.set('q', context.query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('language', 'en');
    url.searchParams.set('safesearch', '1');

    const response = await fetch(url.href, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': DEFAULT_USER_AGENT,
      },
    });

    if (!response.ok) {
      throw new Error(`SearxNG search error ${response.status}: ${await response.text()}`);
    }

    const data = await response.json() as {
      answers?: unknown;
      results?: Array<{ title?: unknown; url?: unknown; content?: unknown; snippet?: unknown }>;
    };

    return {
      provider: 'searxng',
      answer: Array.isArray(data.answers) && typeof data.answers[0] === 'string'
        ? data.answers[0]
        : undefined,
      results: (data.results || []).flatMap((item) => normalizeResult({
        title: item.title,
        url: item.url,
        snippet: item.content || item.snippet,
        content: item.content || item.snippet,
      })),
    };
  },
};

const duckDuckGoProvider: SearchProvider = {
  id: 'duckduckgo-html',
  available: () => true,
  async search(context) {
    const params = new URLSearchParams({ q: context.query });
    const response = await fetch(`${DUCKDUCKGO_HTML}?${params.toString()}`, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'User-Agent': DEFAULT_USER_AGENT,
      },
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo fallback error ${response.status}`);
    }

    const html = await response.text();
    const blocks = html.match(/<div class="result[\s\S]*?<\/div>\s*<\/div>/g) || [];
    const results = blocks.flatMap((block): SearchResult[] => {
      const linkMatch = block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (!linkMatch) return [];

      const url = normalizeDuckDuckGoUrl(decodeHtml(linkMatch[1]));
      if (!url) return [];

      const snippetMatch = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/div>/);
      return [{
        title: cleanText(linkMatch[2]).slice(0, 200) || 'Untitled',
        url,
        snippet: cleanText(snippetMatch?.[1] || snippetMatch?.[2] || '').slice(0, 300),
        content: cleanText(snippetMatch?.[1] || snippetMatch?.[2] || ''),
      }];
    });

    return {
      provider: 'duckduckgo-html',
      results,
    };
  },
};

function normalizeResult({
  title,
  url,
  snippet,
  content,
}: {
  title?: unknown;
  url?: unknown;
  snippet?: unknown;
  content?: unknown;
}): SearchResult[] {
  if (typeof url !== 'string' || !url.trim()) return [];
  const safeUrl = normalizeHttpUrl(url);
  if (!safeUrl) return [];
  const text = typeof snippet === 'string' ? snippet : '';
  return [{
    title: typeof title === 'string' && title.trim() ? title.slice(0, 200) : 'Untitled',
    url: safeUrl,
    snippet: text.slice(0, 300),
    content: typeof content === 'string' ? content.slice(0, 5000) : text.slice(0, 5000),
  }];
}

function normalizeDuckDuckGoUrl(value: string): string | null {
  try {
    const url = new URL(value, DUCKDUCKGO_HTML);
    const uddg = url.searchParams.get('uddg');
    return normalizeHttpUrl(uddg || url.href);
  } catch {
    return null;
  }
}

function normalizeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function dedupeResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = canonicalUrlKey(result.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function canonicalUrlKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
      parsed.searchParams.delete(key);
    }
    return parsed.href.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function maxResultsForMode(mode: SearchMode): number {
  return mode === 'research' ? 8 : 5;
}

function cleanText(value: string): string {
  return decodeHtml(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&mdash;|&#8212;/g, '-')
    .replace(/&ndash;|&#8211;/g, '-')
    .replace(/&rsquo;|&#8217;/g, "'")
    .replace(/&ldquo;|&#8220;/g, '"')
    .replace(/&rdquo;|&#8221;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
