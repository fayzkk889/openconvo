import { SearchResponse, SearchResult } from '@/types/search';
import { rankSearchResults } from '@/lib/source-quality';

const TAVILY_BASE = 'https://api.tavily.com';
const DUCKDUCKGO_HTML = 'https://html.duckduckgo.com/html/';
const DEFAULT_USER_AGENT = 'OpenConvo/0.1 (+https://openconvo.vercel.app)';
const SEARCH_TIMEOUT_MS = 8000;
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const SEARCH_CACHE_MAX = 80;
const MIN_DIVERSIFIED_RESULTS = 6;

export type SearchMode = 'search' | 'research' | 'deep-research';

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
  search: (context: SearchProviderContext, signal: AbortSignal) => Promise<SearchProviderResult>;
};

const searchCache = new Map<string, { expiresAt: number; response: SearchResponse }>();

export async function searchWeb(
  query: string,
  clientKey?: string | null,
  mode: SearchMode = 'search'
): Promise<SearchResponse> {
  const cacheKey = searchCacheKey(query, clientKey, mode);
  const cached = getCachedSearch(cacheKey);
  if (cached) return cached;

  const context: SearchProviderContext = {
    query,
    mode,
    clientTavilyKey: clientKey,
  };
  const providerErrors: string[] = [];
  const providerResults: SearchProviderResult[] = [];
  const hasConfiguredSearchProvider = Boolean(clientKey || process.env.TAVILY_API_KEY || process.env.SEARXNG_URL);

  for (const provider of getSearchProviders()) {
    if (!provider.available(context)) continue;
    try {
      const result = await withTimeout(
        (signal) => provider.search(context, signal),
        SEARCH_TIMEOUT_MS,
        `${provider.id} timed out`
      );
      if (result.results.length > 0 || result.answer) {
        providerResults.push(result);
        if (mode === 'search') {
          const response = {
            query,
            answer: result.answer,
            provider: result.provider,
            mode,
            results: rankSearchResults(dedupeResults(result.results), query).slice(0, maxResultsForMode(mode)),
          };
          setCachedSearch(cacheKey, response);
          return response;
        }
      }
    } catch (error) {
      providerErrors.push(`${provider.id}: ${error instanceof Error ? error.message : 'failed'}`);
    }
  }

  if (providerResults.length > 0) {
    const providers = Array.from(new Set(providerResults.map((result) => result.provider)));
    const response = {
      query,
      answer: providerResults.find((result) => result.answer)?.answer,
      provider: providers[0] || 'unknown',
      providers,
      mode,
      results: rankSearchResults(
        dedupeResults(providerResults.flatMap((result) => result.results)),
        query
      ).slice(0, maxResultsForMode(mode)),
      providerErrors,
    };
    setCachedSearch(cacheKey, response);
    return response;
  }

  return {
    query,
    provider: 'none',
    mode,
    results: [],
    providerErrors: [
      ...providerErrors,
      ...(!hasConfiguredSearchProvider ? ['keyless-search: hosted keyless search depends on DuckDuckGo HTML and may be blocked or rate-limited from cloud IPs; configure Tavily or SearxNG for reliable live research'] : []),
    ],
  };
}

export async function searchWebMany(
  queries: string[],
  clientKey?: string | null,
  mode: SearchMode = 'research',
  entities: string[] = []
): Promise<SearchResponse> {
  const plannedQueries = queries.filter((query) => query.trim().length > 0);
  const responses = await Promise.all(
    plannedQueries.map((query) => searchWeb(query, clientKey, mode))
  );
  const rankingQuery = plannedQueries.join(' ');
  const rankedResults = rankSearchResults(dedupeResults(responses.flatMap((response) => response.results)), rankingQuery);
  const results = diversifyResearchResults(rankedResults, rankingQuery, entities)
    .slice(0, maxCombinedResultsForMode(mode));
  const providers = Array.from(new Set(responses.flatMap((response) =>
    response.provider ? [response.provider] : []
  )));
  const providerErrors = responses.flatMap((response) => response.providerErrors || []);

  return {
    query: plannedQueries[0] || '',
    plannedQueries,
    mode,
    results,
    providers,
    provider: providers[0] || 'none',
    answer: responses.find((response) => response.answer)?.answer,
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
  async search(context, signal) {
    const apiKey = context.clientTavilyKey || process.env.TAVILY_API_KEY;
    if (!apiKey) throw new Error('Tavily key is missing');

    const response = await fetch(`${TAVILY_BASE}/search`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        query: context.query,
        search_depth: context.mode === 'search' ? 'basic' : 'advanced',
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
  async search(context, signal) {
    const baseUrl = process.env.SEARXNG_URL;
    if (!baseUrl) throw new Error('SearxNG URL is missing');

    const url = new URL('/search', baseUrl);
    url.searchParams.set('q', context.query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('language', 'en');
    url.searchParams.set('safesearch', '1');

    const response = await fetch(url.href, {
      signal,
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
  async search(context, signal) {
    const params = new URLSearchParams({ q: context.query });
    const response = await fetch(`${DUCKDUCKGO_HTML}?${params.toString()}`, {
      signal,
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
    for (const key of TRACKING_QUERY_PARAMS) {
      url.searchParams.delete(key);
    }
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
    for (const key of TRACKING_QUERY_PARAMS) {
      parsed.searchParams.delete(key);
    }
    return parsed.href.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

const TRACKING_QUERY_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'msclkid',
  'ref',
  'ref_src',
  'source',
  'os',
];

function maxResultsForMode(mode: SearchMode): number {
  if (mode === 'deep-research') return 10;
  return mode === 'research' ? 8 : 5;
}

function maxCombinedResultsForMode(mode: SearchMode): number {
  if (mode === 'deep-research') return 18;
  return mode === 'research' ? 12 : 6;
}

function diversifyResearchResults(results: SearchResult[], query: string, entities: string[] = []): SearchResult[] {
  const comparisonResults = diversifyComparisonResults(results, query, entities);
  const selected = new Map<string, SearchResult>();
  const hostCounts = new Map<string, number>();

  for (const result of comparisonResults) {
    const host = hostKey(result.url);
    const count = hostCounts.get(host) || 0;
    if (count >= 3) continue;
    selected.set(canonicalUrlKey(result.url), result);
    hostCounts.set(host, count + 1);
  }

  for (const result of comparisonResults) {
    if (selected.size >= MIN_DIVERSIFIED_RESULTS) break;
    selected.set(canonicalUrlKey(result.url), result);
  }

  return Array.from(selected.values());
}

function diversifyComparisonResults(results: SearchResult[], query: string, plannedEntities: string[] = []): SearchResult[] {
  const entities = plannedEntities.length ? plannedEntities : comparisonEntities(query);
  if (entities.length > 0) {
    return diversifyByEntities(results, entities);
  }

  return results;
}

function diversifyByEntities(results: SearchResult[], entities: string[]): SearchResult[] {
  const selected = new Map<string, SearchResult>();
  for (const entity of entities.slice(0, 6)) {
    const pattern = entityPattern(entity);
    const result = results.find((item) => pattern.test(`${item.title} ${item.snippet} ${item.url}`));
    if (result) selected.set(canonicalUrlKey(result.url), result);
  }

  const hostCounts = new Map<string, number>();
  for (const result of selected.values()) {
    const host = hostKey(result.url);
    hostCounts.set(host, (hostCounts.get(host) || 0) + 1);
  }

  for (const result of results) {
    const host = hostKey(result.url);
    const count = hostCounts.get(host) || 0;
    if (count < 2) {
      selected.set(canonicalUrlKey(result.url), result);
      hostCounts.set(host, count + 1);
    }
  }

  for (const result of results) {
    if (selected.size >= MIN_DIVERSIFIED_RESULTS) break;
    selected.set(canonicalUrlKey(result.url), result);
  }

  return Array.from(selected.values());
}

function comparisonEntities(query: string): string[] {
  if (!/\b(compare|comparison|versus|vs\.?|alternative|best|which|choose|recommend|better)\b/i.test(query)) {
    return [];
  }

  const splitEntities = query
    .split(/\b(?:vs\.?|versus|or|compared with|compared to)\b|,/i)
    .map((part) => part.replace(/\b(which|one|is|better|best|should|i|use|choose|tell|me|can|you|with|for|pocket|friendly|cheap|cheaper)\b/gi, ' '))
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => part.length >= 3 && part.length <= 80);

  return Array.from(new Set(splitEntities.map((entity) => entity.trim()).filter(Boolean))).slice(0, 8);
}

function entityPattern(entity: string): RegExp {
  const escaped = entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(escaped, 'i');
}

function hostKey(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return 'unknown';
  }
}

async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function searchCacheKey(query: string, clientKey: string | null | undefined, mode: SearchMode): string {
  return [
    mode,
    clientKey ? 'byok' : 'hosted',
    query.replace(/\s+/g, ' ').trim().toLowerCase(),
  ].join(':');
}

function getCachedSearch(key: string): SearchResponse | null {
  const cached = searchCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    searchCache.delete(key);
    return null;
  }
  return cloneSearchResponse(cached.response);
}

function setCachedSearch(key: string, response: SearchResponse): void {
  pruneSearchCache();
  searchCache.set(key, {
    expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
    response: cloneSearchResponse(response),
  });
}

function pruneSearchCache(): void {
  const now = Date.now();
  for (const [key, value] of searchCache.entries()) {
    if (value.expiresAt <= now) searchCache.delete(key);
  }

  while (searchCache.size >= SEARCH_CACHE_MAX) {
    const oldestKey = searchCache.keys().next().value;
    if (!oldestKey) break;
    searchCache.delete(oldestKey);
  }
}

function cloneSearchResponse(response: SearchResponse): SearchResponse {
  return {
    ...response,
    results: response.results.map((result) => ({ ...result })),
    plannedQueries: response.plannedQueries ? [...response.plannedQueries] : undefined,
    providers: response.providers ? [...response.providers] : undefined,
    providerErrors: response.providerErrors ? [...response.providerErrors] : undefined,
  };
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
