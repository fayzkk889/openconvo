import { SearchResponse, SearchResult } from '@/types/search';
import { rankSearchResults } from '@/lib/source-quality';

const TAVILY_BASE = 'https://api.tavily.com';
const BING_SEARCH = 'https://www.bing.com/search';
const DUCKDUCKGO_HTML = 'https://html.duckduckgo.com/html/';
const DUCKDUCKGO_LITE = 'https://lite.duckduckgo.com/lite/';
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
  const seededResults = seededReferenceResults(rankingQuery);
  const rankedResults = rankSearchResults(
    dedupeResults([
      ...seededResults,
      ...responses.flatMap((response) => response.results),
    ]),
    rankingQuery
  );
  const results = diversifyResearchResults(rankedResults, rankingQuery, entities)
    .slice(0, maxCombinedResultsForMode(mode));
  const providers = Array.from(new Set(responses.flatMap((response) =>
    response.provider && response.provider !== 'none' ? [response.provider] : []
  ).concat(seededResults.length > 0 ? ['source-seeds'] : [])));
  const providerErrors = Array.from(new Set(responses.flatMap((response) => response.providerErrors || [])));

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
    duckDuckGoLiteProvider,
    bingHtmlProvider,
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

    return {
      provider: 'duckduckgo-html',
      results: parseDuckDuckGoHtml(html),
    };
  },
};

const duckDuckGoLiteProvider: SearchProvider = {
  id: 'duckduckgo-lite',
  available: () => true,
  async search(context, signal) {
    const params = new URLSearchParams({ q: context.query });
    const response = await fetch(`${DUCKDUCKGO_LITE}?${params.toString()}`, {
      signal,
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'User-Agent': DEFAULT_USER_AGENT,
      },
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo Lite fallback error ${response.status}`);
    }

    const html = await response.text();
    return {
      provider: 'duckduckgo-lite',
      results: parseDuckDuckGoLiteHtml(html),
    };
  },
};

const bingHtmlProvider: SearchProvider = {
  id: 'bing-html',
  available: () => true,
  async search(context, signal) {
    const params = new URLSearchParams({ q: context.query, setlang: 'en-US' });
    const response = await fetch(`${BING_SEARCH}?${params.toString()}`, {
      signal,
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'User-Agent': DEFAULT_USER_AGENT,
      },
    });

    if (!response.ok) {
      throw new Error(`Bing fallback error ${response.status}`);
    }

    const html = await response.text();
    return {
      provider: 'bing-html',
      results: parseBingHtml(html),
    };
  },
};

function parseDuckDuckGoHtml(html: string): SearchResult[] {
  const blocks = html.match(/<div class="result[\s\S]*?<\/div>\s*<\/div>/g) || [];
  const blockResults = blocks.flatMap((block): SearchResult[] => {
    const linkMatch = block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!linkMatch) return [];

    const url = normalizeDuckDuckGoUrl(decodeHtml(linkMatch[1]));
    if (!url) return [];

    const snippetMatch = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/div>/);
    return [duckDuckGoResult(linkMatch[2], url, snippetMatch?.[1] || snippetMatch?.[2] || '')];
  });

  if (blockResults.length > 0) return blockResults;

  return Array.from(html.matchAll(/<a[^>]+class="[^"]*\bresult__a\b[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g))
    .flatMap((match): SearchResult[] => {
      const url = normalizeDuckDuckGoUrl(decodeHtml(match[1] || ''));
      return url ? [duckDuckGoResult(match[2] || '', url, '')] : [];
    });
}

function parseDuckDuckGoLiteHtml(html: string): SearchResult[] {
  return Array.from(html.matchAll(/<a[^>]+class="[^"]*\bresult-link\b[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g))
    .flatMap((match): SearchResult[] => {
      const rawTitle = cleanText(match[2] || '');
      if (!rawTitle || /^(images|videos|news|maps|settings)$/i.test(rawTitle)) return [];
      const url = normalizeDuckDuckGoUrl(decodeHtml(match[1] || ''));
      return url ? [duckDuckGoResult(rawTitle, url, '')] : [];
    });
}

function parseBingHtml(html: string): SearchResult[] {
  const blocks = html.match(/<li[^>]+class="[^"]*\bb_algo\b[^"]*"[\s\S]*?<\/li>/g) || [];
  return blocks.flatMap((block): SearchResult[] => {
    const linkMatch = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/);
    if (!linkMatch) return [];
    const url = normalizeBingUrl(decodeHtml(linkMatch[1] || ''));
    if (!url) return [];
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    return [duckDuckGoResult(linkMatch[2] || '', url, snippetMatch?.[1] || '')];
  });
}

function duckDuckGoResult(title: string, url: string, snippet: string): SearchResult {
  const cleanSnippet = cleanText(snippet);
  return {
    title: cleanText(title).slice(0, 200) || 'Untitled',
    url,
    snippet: cleanSnippet.slice(0, 300),
    content: cleanSnippet,
  };
}

function seededReferenceResults(query: string): SearchResult[] {
  return [
    ...seededTrendResults(query),
    ...seededShoppingResults(query),
    ...seededKnowledgeResults(query),
  ];
}

function seededTrendResults(query: string): SearchResult[] {
  if (!/\b(twitter|x\.com|x|trending|trends|hashtags?)\b/i.test(query)) return [];
  if (!/\b(twitter|x\.com|x)\b/i.test(query)) return [];

  const location = extractTrendLocationSlug(query);
  if (!location) return [];
  const label = titleCaseWords(location.replace(/-/g, ' '));

  return [
    {
      title: `${label} Twitter/X trends today`,
      url: `https://trends24.in/${location}/`,
      snippet: `Public trend snapshot page for Twitter/X trends in ${label}. Use as a cited snapshot, not as direct platform API data.`,
      content: '',
    },
    {
      title: `${label} X trending topics and hashtags`,
      url: `https://xtrends.iamrohit.in/${location}`,
      snippet: `Public trend tracker for X/Twitter topics and hashtags in ${label}. Freshness depends on the source page.`,
      content: '',
    },
    {
      title: `${label} Twitter trends snapshot`,
      url: `https://twitter-trends.snaplytics.io/${location}`,
      snippet: `Public snapshot page for Twitter trend tracking in ${label}. Verify timestamps on the opened page when available.`,
      content: '',
    },
  ];
}

function seededShoppingResults(query: string): SearchResult[] {
  if (!/\b(india|rupees?|rs|inr|lakh|₹|under|below|budget|price|prices|buy|buying|recommend|phones?|smartphones?|laptops?|mobiles?)\b/i.test(query)) return [];
  if (!/\b(phones?|smartphones?|laptops?|mobiles?|tablets?|earbuds?|headphones?|monitors?|bikes?|motorcycles?)\b/i.test(query)) return [];

  const compact = query.toLowerCase().replace(/\s+/g, ' ').trim();
  const encoded = encodeURIComponent(compact);
  return [
    {
      title: 'India product prices and comparison search - Smartprix',
      url: `https://www.smartprix.com/products/?q=${encoded}`,
      snippet: 'Indian product comparison and price-discovery source. Use it to verify current market options and prices.',
      content: '',
    },
    {
      title: 'India mobile and gadget buying guides - 91mobiles',
      url: `https://www.91mobiles.com/search_page.php?q=${encoded}`,
      snippet: 'India-focused phone and gadget database with prices, specifications, and buying filters.',
      content: '',
    },
    {
      title: 'India technology buying guides and prices - Gadgets 360',
      url: `https://www.gadgets360.com/search?searchtext=${encoded}`,
      snippet: 'India technology publication with phone, gadget, and laptop price/spec coverage.',
      content: '',
    },
  ];
}

function seededKnowledgeResults(query: string): SearchResult[] {
  if (!/\b(latest|recent|current|news|developments?|breakthroughs?|updates?|announcements?)\b/i.test(query)) return [];
  if (!/\b(ai|artificial intelligence|machine learning|llm|llms|generative ai|foundation models?)\b/i.test(query)) return [];

  return [
    {
      title: 'OpenAI News',
      url: 'https://openai.com/news/',
      snippet: 'Official OpenAI announcements and product/research updates.',
      content: '',
    },
    {
      title: 'Anthropic News',
      url: 'https://www.anthropic.com/news',
      snippet: 'Official Anthropic news, Claude updates, research, and company announcements.',
      content: '',
    },
    {
      title: 'Google AI Blog',
      url: 'https://blog.google/technology/ai/',
      snippet: 'Google AI announcements, Gemini updates, research, and product news.',
      content: '',
    },
    {
      title: 'Google DeepMind Blog',
      url: 'https://deepmind.google/discover/blog/',
      snippet: 'Google DeepMind research and AI systems announcements.',
      content: '',
    },
    {
      title: 'Meta AI Blog',
      url: 'https://ai.meta.com/blog/',
      snippet: 'Meta AI research, model releases, and open-source AI updates.',
      content: '',
    },
    {
      title: 'Hugging Face Blog',
      url: 'https://huggingface.co/blog',
      snippet: 'AI model, tooling, dataset, and open-source machine-learning updates.',
      content: '',
    },
  ];
}

function extractTrendLocationSlug(query: string): string {
  const normalized = query
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const matches = Array.from(normalized.matchAll(/\b(?:in|for|around)\s+([a-z][a-z\s-]{1,40}?)(?:\s+(?:today|now|currently|this week|this month|with|and|twitter|x|trends?|trending|hashtags?)\b|$)/g))
    .map((match) => (match[1] || '').trim())
    .filter(Boolean);
  const location = matches[matches.length - 1] || '';
  if (!location || /^(twitter|x|reddit|instagram|youtube|tiktok|social media)$/.test(location)) return '';
  return location
    .split(/\s+/)
    .filter((part) => !['today', 'now', 'currently'].includes(part))
    .join('-')
    .slice(0, 50);
}

function titleCaseWords(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

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

function normalizeBingUrl(value: string): string | null {
  try {
    const url = new URL(value, BING_SEARCH);
    const encodedTarget = url.searchParams.get('u');
    const decodedTarget = encodedTarget ? decodeBingTarget(encodedTarget) : '';
    return normalizeHttpUrl(decodedTarget || url.href);
  } catch {
    return null;
  }
}

function decodeBingTarget(value: string): string {
  try {
    const normalized = value.startsWith('a1') ? value.slice(2) : value;
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch {
    return '';
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
  const seenTitleHosts = new Set<string>();
  return results.filter((result) => {
    const key = canonicalUrlKey(result.url);
    const titleHostKey = `${hostKey(result.url)}::${normalizeDedupeTitle(result.title)}`;
    if (seen.has(key) || (titleHostKey.length > 3 && seenTitleHosts.has(titleHostKey))) return false;
    seen.add(key);
    if (titleHostKey.length > 3) seenTitleHosts.add(titleHostKey);
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

function normalizeDedupeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
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
