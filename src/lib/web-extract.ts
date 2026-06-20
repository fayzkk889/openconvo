import type { SearchResult } from '@/types/search';

const MAX_FETCH_BYTES = 1_000_000;
const MAX_EXTRACTED_CHARS = 5000;
const FETCH_TIMEOUT_MS = 7000;
const PAGE_CACHE_TTL_MS = 10 * 60 * 1000;
const PAGE_CACHE_MAX = 120;
const DEFAULT_USER_AGENT = 'OpenConvo/0.1 (+https://openconvo.vercel.app)';

const pageCache = new Map<string, { expiresAt: number; content: string | null }>();

export async function enrichSearchResults(
  results: SearchResult[],
  options: { maxPages?: number } = {}
): Promise<SearchResult[]> {
  const maxPages = options.maxPages ?? 3;
  const enriched = await Promise.all(
    results.map(async (result, index) => {
      if (index >= maxPages) return result;
      const extracted = await fetchReadablePage(result.url);
      if (!extracted) return result;

      return {
        ...result,
        content: extracted,
        extracted: true,
        fetchedAt: Date.now(),
      };
    })
  );

  return enriched;
}

export async function fetchReadablePage(url: string): Promise<string | null> {
  const safeUrl = parseSafeFetchUrl(url);
  if (!safeUrl) return null;
  const cacheKey = canonicalPageCacheKey(safeUrl);
  const cached = getCachedPage(cacheKey);
  if (cached.hit) return cached.content;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(safeUrl.href, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.8',
        'User-Agent': DEFAULT_USER_AGENT,
      },
    });

    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') || '';
    if (!isReadableContentType(contentType)) {
      setCachedPage(cacheKey, null);
      return null;
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_FETCH_BYTES) {
      setCachedPage(cacheKey, null);
      return null;
    }

    const html = await readLimitedResponse(response);
    if (!html.trim()) {
      setCachedPage(cacheKey, null);
      return null;
    }

    const text = contentType.includes('text/plain')
      ? html
      : extractReadableText(html);
    const content = text ? text.slice(0, MAX_EXTRACTED_CHARS) : null;
    setCachedPage(cacheKey, content);
    return content;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function parseSafeFetchUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (isBlockedHostname(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === 'metadata.google.internal'
  ) {
    return true;
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const parts = host.split('.').map(Number);
    const [a, b] = parts;
    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0
    );
  }

  return false;
}

function isReadableContentType(contentType: string): boolean {
  return (
    contentType.includes('text/html') ||
    contentType.includes('application/xhtml') ||
    contentType.includes('text/plain') ||
    contentType === ''
  );
}

function canonicalPageCacheKey(url: URL): string {
  const parsed = new URL(url.href);
  parsed.hash = '';
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
    parsed.searchParams.delete(key);
  }
  return parsed.href.toLowerCase();
}

function getCachedPage(key: string): { hit: boolean; content: string | null } {
  const cached = pageCache.get(key);
  if (!cached) return { hit: false, content: null };
  if (cached.expiresAt <= Date.now()) {
    pageCache.delete(key);
    return { hit: false, content: null };
  }
  return { hit: true, content: cached.content };
}

function setCachedPage(key: string, content: string | null): void {
  prunePageCache();
  pageCache.set(key, {
    expiresAt: Date.now() + PAGE_CACHE_TTL_MS,
    content,
  });
}

function prunePageCache(): void {
  const now = Date.now();
  for (const [key, value] of pageCache.entries()) {
    if (value.expiresAt <= now) pageCache.delete(key);
  }

  while (pageCache.size >= PAGE_CACHE_MAX) {
    const oldestKey = pageCache.keys().next().value;
    if (!oldestKey) break;
    pageCache.delete(oldestKey);
  }
}

async function readLimitedResponse(response: Response): Promise<string> {
  if (!response.body) {
    return (await response.text()).slice(0, MAX_FETCH_BYTES);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (total < MAX_FETCH_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    const remaining = MAX_FETCH_BYTES - total;
    chunks.push(value.length > remaining ? value.slice(0, remaining) : value);
    total += value.length;
  }

  try {
    await reader.cancel();
  } catch {
    // ignored
  }

  return new TextDecoder().decode(concatChunks(chunks));
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function extractReadableText(html: string): string {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ');

  const body = withoutNoise.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || withoutNoise;
  return decodeHtml(
    body
      .replace(/<\/(p|div|section|article|li|h1|h2|h3|h4|blockquote)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, ' ')
  )
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;|&#8212;/g, '-')
    .replace(/&ndash;|&#8211;/g, '-')
    .replace(/&rsquo;|&#8217;/g, "'")
    .replace(/&ldquo;|&#8220;/g, '"')
    .replace(/&rdquo;|&#8221;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
