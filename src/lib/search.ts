import { SearchResponse, SearchResult } from '@/types/search';
import { rankSearchResults } from '@/lib/source-quality';
import { hostedTavilyKey } from '@/lib/hosted-mode';

const TAVILY_BASE = 'https://api.tavily.com';
const BING_SEARCH = 'https://www.bing.com/search';
const DUCKDUCKGO_HTML = 'https://html.duckduckgo.com/html/';
const DUCKDUCKGO_LITE = 'https://lite.duckduckgo.com/lite/';
const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
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
  mode: SearchMode = 'search',
  signal?: AbortSignal
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
  const hasConfiguredSearchProvider = Boolean(clientKey || hostedTavilyKey() || process.env.SEARXNG_URL);

  for (const provider of getSearchProviders()) {
    if (signal?.aborted) break;
    if (!provider.available(context)) continue;
    try {
      const result = await withTimeout(
        (provSignal) => provider.search(context, provSignal),
        SEARCH_TIMEOUT_MS,
        `${provider.id} timed out`,
        signal
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
      if (signal?.aborted) throw error;
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
  entities: string[] = [],
  signal?: AbortSignal
): Promise<SearchResponse> {
  const plannedQueries = queries.filter((query) => query.trim().length > 0);
  const responses: SearchResponse[] = [];
  const CONCURRENCY_LIMIT = 3;

  for (let i = 0; i < plannedQueries.length; i += CONCURRENCY_LIMIT) {
    if (signal?.aborted) break;
    const batch = plannedQueries.slice(i, i + CONCURRENCY_LIMIT);
    const batchResponses = await Promise.all(
      batch.map((query) => searchWeb(query, clientKey, mode, signal))
    );
    responses.push(...batchResponses);
  }

  const rankingQuery = plannedQueries.join(' ');
  const rawRankedResults = rankSearchResults(
    dedupeResults(responses.flatMap((response) => response.results)),
    rankingQuery
  );
  const seededResults = shouldUseSeededFallback(rawRankedResults)
    ? seededReferenceResults(rankingQuery)
    : [];
  const rankedResults = rankSearchResults(
    dedupeResults([...rawRankedResults, ...seededResults]),
    rankingQuery
  );
  const hasSubstantialSources = rankedResults.some((result) => (result.sourceScore || 0) >= 48);
  const gatedResults = hasSubstantialSources
    ? rankedResults.filter((result) => (result.sourceScore || 0) > 40)
    : rankedResults;
  const results = diversifyResearchResults(gatedResults, rankingQuery, entities)
    .slice(0, maxCombinedResultsForMode(mode));
  // Every provider that returned results for any planned query, not just the
  // first one per query, so the metadata reflects where evidence came from.
  const providers = Array.from(new Set(responses.flatMap((response) =>
    response.providers?.length
      ? response.providers
      : response.provider && response.provider !== 'none' ? [response.provider] : []
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
    wikipediaProvider,
  ];
}

/**
 * Keyless, documented API that works from cloud IPs (unlike HTML scraping of
 * DuckDuckGo, which returns 403 to Vercel). Returns each article's lead section
 * as plain text, which gives research answers real content to cite while page
 * extraction is disabled. Encyclopedic coverage only, so it is tried last.
 */
const wikipediaProvider: SearchProvider = {
  id: 'wikipedia',
  available: () => true,
  async search(context, signal) {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      generator: 'search',
      gsrsearch: context.query.slice(0, 300),
      gsrlimit: context.mode === 'search' ? '3' : '5',
      gsrnamespace: '0',
      prop: 'extracts|info',
      exintro: '1',
      explaintext: '1',
      exlimit: '5',
      exchars: '1200',
      inprop: 'url',
      redirects: '1',
      origin: '*',
    });
    const response = await fetch(`${WIKIPEDIA_API}?${params.toString()}`, {
      signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': DEFAULT_USER_AGENT,
      },
    });

    if (!response.ok) {
      throw new Error(`Wikipedia search error ${response.status}`);
    }

    return {
      provider: 'wikipedia',
      results: parseWikipediaResponse(await response.json(), context.query),
    };
  },
};

const WIKIPEDIA_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'what', 'which', 'how', 'why', 'who', 'are', 'was', 'were', 'does', 'did',
  'about', 'from', 'into', 'that', 'this', 'these', 'those', 'between', 'latest', 'best', 'can', 'you',
  'tell', 'give', 'explain', 'compare', 'difference', 'vs', 'versus', 'use', 'using', 'should',
]);

function significantTerms(query: string): string[] {
  return Array.from(new Set(
    query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 3 && !WIKIPEDIA_STOPWORDS.has(t))
  ));
}

/**
 * Wikipedia's full-text search returns loose matches (a query about React
 * server components also returns ReactOS). Keep only articles that contain at
 * least half of the query's significant terms as whole words.
 */
export function parseWikipediaResponse(data: unknown, query = ''): SearchResult[] {
  const terms = significantTerms(query);
  const needed = Math.ceil(terms.length / 2);
  const pages = (data as { query?: { pages?: unknown } })?.query?.pages;
  if (!Array.isArray(pages)) return [];
  return pages
    .filter((page): page is { title?: unknown; fullurl?: unknown; extract?: unknown; index?: unknown } =>
      Boolean(page) && typeof page === 'object')
    .filter((page) => typeof page.extract === 'string' && page.extract.trim().length > 0)
    .filter((page) => {
      if (!terms.length) return true;
      const words = new Set(`${page.title} ${page.extract}`.toLowerCase().split(/[^\p{L}\p{N}]+/u));
      return terms.filter((term) => words.has(term)).length >= needed;
    })
    .sort((a, b) => (Number(a.index) || 0) - (Number(b.index) || 0))
    .flatMap((page) => {
      const extract = String(page.extract).replace(/\s+/g, ' ').trim();
      return normalizeResult({
        title: typeof page.title === 'string' ? `${page.title} - Wikipedia` : undefined,
        url: page.fullurl,
        snippet: extract,
        content: extract,
      });
    });
}

const tavilyProvider: SearchProvider = {
  id: 'tavily',
  available: (context) => Boolean(context.clientTavilyKey || hostedTavilyKey()),
  async search(context, signal) {
    const apiKey = context.clientTavilyKey || hostedTavilyKey();
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

function shouldUseSeededFallback(results: SearchResult[]): boolean {
  if (results.length === 0) return true;
  return !results.some((result) => (result.sourceScore || 0) >= 48);
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
  const topicMatches = Array.from(normalized.matchAll(/\b(?:tracker|trends?|topics?|hashtags?)\s+([a-z][a-z\s-]{1,40}?)(?:\s+(?:today|now|currently|this week|this month)\b|$)/g))
    .map((match) => (match[1] || '').trim())
    .filter(Boolean);
  const location = matches[matches.length - 1] || topicMatches[topicMatches.length - 1] || '';
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

export function dedupeResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const seenTitleHosts = new Set<string>();
  const seenSnippets = new Set<string>();
  return results.filter((result) => {
    const key = canonicalUrlKey(result.url);
    const titleHostKey = `${hostKey(result.url)}::${normalizeDedupeTitle(result.title)}`;
    const cleanSnippet = (result.snippet || '').trim().toLowerCase().slice(0, 120);
    if (seen.has(key)) return false;
    if (titleHostKey.length > 3 && seenTitleHosts.has(titleHostKey)) return false;
    if (cleanSnippet.length > 40 && seenSnippets.has(cleanSnippet)) return false;
    seen.add(key);
    if (titleHostKey.length > 3) seenTitleHosts.add(titleHostKey);
    if (cleanSnippet.length > 40) seenSnippets.add(cleanSnippet);
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
  timeoutMessage: string,
  parentSignal?: AbortSignal
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(timeoutMessage)), timeoutMs);

  const onParentAbort = () => {
    controller.abort(parentSignal?.reason || new Error('User stopped search'));
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      clearTimeout(timeout);
      throw parentSignal.reason || new Error('User stopped search');
    }
    parentSignal.addEventListener('abort', onParentAbort, { once: true });
  }

  try {
    return await run(controller.signal);
  } catch (error) {
    if (parentSignal?.aborted) {
      throw parentSignal.reason || new Error('User stopped search');
    }
    if (controller.signal.aborted) {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    if (parentSignal) {
      parentSignal.removeEventListener('abort', onParentAbort);
    }
  }
}

export function searchCacheKey(query: string, clientKey: string | null | undefined, mode: SearchMode = 'search'): string {
  // Step 4 Invariant: Raw API keys never become cache keys.
  // Use a hash of clientKey to isolate BYOK users without leaking keys in memory.
  const identity = clientKey ? `byok:${simpleHashKey(clientKey)}` : 'hosted';
  return [
    mode,
    identity,
    query.replace(/\s+/g, ' ').trim().toLowerCase(),
  ].join(':');
}

function simpleHashKey(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
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
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d{1,7});/g, (_, dec: string) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/g, ' ')
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

// ---------------------------------------------------------------------------
// Model-driven search: what the model's web_search tool calls.
// ---------------------------------------------------------------------------

export type ToolSearchKind = 'web' | 'news';

const BING_NEWS_SEARCH = 'https://www.bing.com/news/search';
const GOOGLE_NEWS_RSS = 'https://news.google.com/rss/search';
const TOOL_SEARCH_TIMEOUT_MS = 6000;
const TOOL_SEARCH_MAX_RESULTS = 6;

/** Keyless news feed. Bing's links carry the publisher's own article URL. */
const bingNewsProvider: SearchProvider = {
  id: 'bing-news',
  available: () => newsFeedsEnabled(),
  async search(context, signal) {
    const params = new URLSearchParams({ q: context.query, format: 'rss', setlang: 'en-US' });
    const response = await fetch(`${BING_NEWS_SEARCH}?${params.toString()}`, {
      signal,
      headers: { 'Accept': 'application/rss+xml,text/xml', 'User-Agent': DEFAULT_USER_AGENT },
    });
    if (!response.ok) throw new Error(`Bing News error ${response.status}`);
    return { provider: 'bing-news', results: parseRssFeed(await response.text(), 'bing') };
  },
};

const googleNewsProvider: SearchProvider = {
  id: 'google-news',
  available: () => newsFeedsEnabled(),
  async search(context, signal) {
    const params = new URLSearchParams({ q: context.query, hl: 'en-US', gl: 'US', ceid: 'US:en' });
    const response = await fetch(`${GOOGLE_NEWS_RSS}?${params.toString()}`, {
      signal,
      headers: { 'Accept': 'application/rss+xml,text/xml', 'User-Agent': DEFAULT_USER_AGENT },
    });
    if (!response.ok) throw new Error(`Google News error ${response.status}`);
    return { provider: 'google-news', results: parseRssFeed(await response.text(), 'google') };
  },
};

function newsFeedsEnabled(): boolean {
  return process.env.OPENCONVO_NEWS_FEEDS !== 'off';
}

/**
 * Parse a Bing News or Google News RSS feed. Bing wraps each link in a click
 * tracker whose `url` parameter holds the article URL; Google titles end in
 * " - Publisher".
 */
export function parseRssFeed(xml: string, flavour: 'bing' | 'google'): SearchResult[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return items.slice(0, 12).flatMap((item): SearchResult[] => {
    const rawLink = decodeHtml(rssTag(item, 'link'));
    let url = rawLink;
    if (flavour === 'bing') {
      try {
        url = new URL(rawLink).searchParams.get('url') || rawLink;
      } catch {
        return [];
      }
    }
    const safeUrl = normalizeHttpUrl(url);
    if (!safeUrl) return [];
    let title = cleanText(rssTag(item, 'title'));
    const publisher = cleanText(rssTag(item, flavour === 'bing' ? 'News:Source' : 'source'));
    if (flavour === 'google' && publisher && title.endsWith(` - ${publisher}`)) {
      title = title.slice(0, -(publisher.length + 3));
    }
    const description = flavour === 'google' ? '' : cleanText(rssTag(item, 'description'));
    const pubDate = rssTag(item, 'pubDate');
    const published = pubDate && !Number.isNaN(Date.parse(pubDate))
      ? new Date(pubDate).toISOString().slice(0, 10)
      : undefined;
    const snippet = [publisher ? `${publisher}.` : '', description].filter(Boolean).join(' ');
    return [{
      title: title.slice(0, 200) || 'Untitled',
      url: safeUrl,
      snippet: snippet.slice(0, 300),
      content: snippet.slice(0, 1000),
      publishedAt: published,
    }];
  });
}

function rssTag(item: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = item.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`, 'i'));
  if (!match) return '';
  return match[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim();
}

const RELEVANCE_STOPWORDS = new Set([
  ...WIKIPEDIA_STOPWORDS,
  'whats', 'news', 'today', 'recent', 'current', 'currently', 'rumour', 'rumours', 'rumor', 'rumors',
  'report', 'reports', 'update', 'updates', 'official', 'there', 'any', 'some', 'like', 'will', 'has', 'have',
]);

function relevanceTerms(query: string): string[] {
  return Array.from(new Set(
    query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 3 && !RELEVANCE_STOPWORDS.has(t))
  ));
}

/**
 * Drop results that share too little with the query. A term counts when a word
 * of the result starts with its stem, so "layoff" matches "layoffs". Requires
 * every term for one- or two-term queries, otherwise at least half of them.
 */
export function isRelevantResult(result: Pick<SearchResult, 'title' | 'snippet' | 'url'>, query: string): boolean {
  const terms = relevanceTerms(query);
  if (terms.length === 0) return true;
  const haystack = `${result.title} ${result.snippet} ${safeDecodeUrl(result.url)}`.toLowerCase();
  const words = haystack.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const matched = terms.filter((term) => {
    const stem = term.length > 5 ? term.slice(0, term.length - 2) : term;
    return words.some((word) => word.startsWith(stem));
  }).length;
  const needed = terms.length <= 2 ? terms.length : Math.ceil(terms.length / 2);
  return matched >= needed;
}

function safeDecodeUrl(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

export type ToolSearchResponse = {
  query: string;
  kind: ToolSearchKind;
  results: SearchResult[];
  providers: string[];
  providerErrors: string[];
};

/**
 * Search for the model's web_search tool. Every available source for the kind
 * is queried in parallel; results are merged, deduplicated, filtered for
 * relevance and ranked. No key is needed; Tavily and SearxNG join in only when
 * configured.
 */
export async function searchForTool(
  query: string,
  kind: ToolSearchKind,
  options: { clientTavilyKey?: string | null; signal?: AbortSignal; maxResults?: number } = {}
): Promise<ToolSearchResponse> {
  const cleanQuery = query.replace(/\s+/g, ' ').trim().slice(0, 300);
  const cacheKey = `tool:${kind}:${searchCacheKey(cleanQuery, options.clientTavilyKey, 'search')}`;
  const cached = getCachedSearch(cacheKey);
  if (cached) {
    return {
      query: cleanQuery,
      kind,
      results: cached.results,
      providers: cached.providers || [],
      providerErrors: cached.providerErrors || [],
    };
  }

  const context: SearchProviderContext = { query: cleanQuery, mode: 'search', clientTavilyKey: options.clientTavilyKey };
  const providers = (kind === 'news'
    ? [bingNewsProvider, googleNewsProvider, tavilyProvider, searxngProvider]
    : [tavilyProvider, searxngProvider, bingHtmlProvider, duckDuckGoProvider, wikipediaProvider]
  ).filter((provider) => provider.available(context));

  const settled = await Promise.all(providers.map(async (provider): Promise<SearchProviderResult | Error> => {
    try {
      return await withTimeout(
        (signal) => provider.search(context, signal),
        TOOL_SEARCH_TIMEOUT_MS,
        `${provider.id} timed out`,
        options.signal
      );
    } catch (error) {
      if (options.signal?.aborted) throw error;
      return new Error(`${provider.id}: ${error instanceof Error ? error.message : 'failed'}`);
    }
  }));

  const providerErrors = settled.filter((item): item is Error => item instanceof Error).map((error) => error.message);
  const successful = settled.filter((item): item is SearchProviderResult => !(item instanceof Error));
  // Interleave providers so one source cannot crowd out the others.
  const interleaved: SearchResult[] = [];
  const maxLen = Math.max(0, ...successful.map((item) => item.results.length));
  for (let i = 0; i < maxLen; i++) {
    for (const item of successful) {
      const result = item.results[i];
      if (result) interleaved.push({ ...result, provider: item.provider });
    }
  }
  const relevant = dedupeResults(interleaved).filter((result) => isRelevantResult(result, cleanQuery));
  // News is newest first (undated items last, feed order otherwise); web results
  // are ranked by source quality.
  const ordered = kind === 'news'
    ? relevant
      .map((result, index) => ({ result, index, time: result.publishedAt ? Date.parse(result.publishedAt) : NaN }))
      .sort((a, b) => {
        const at = Number.isNaN(a.time) ? -Infinity : a.time;
        const bt = Number.isNaN(b.time) ? -Infinity : b.time;
        return bt - at || a.index - b.index;
      })
      .map(({ result }) => result)
    : rankSearchResults(relevant, cleanQuery);
  const results = ordered.slice(0, options.maxResults ?? TOOL_SEARCH_MAX_RESULTS);
  const usedProviders = Array.from(new Set(results.map((result) => result.provider).filter((p): p is string => Boolean(p))));

  if (results.length > 0) {
    setCachedSearch(cacheKey, { query: cleanQuery, results, providers: usedProviders, providerErrors });
  }
  return { query: cleanQuery, kind, results, providers: usedProviders, providerErrors };
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return ' ';
  return String.fromCodePoint(code);
}
