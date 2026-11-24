import type { SearchResult } from '@/types/search';

const MAX_FETCH_BYTES = 1_000_000;
const MAX_EXTRACTED_CHARS = 5000;
const FETCH_TIMEOUT_MS = 7000;
const PAGE_CACHE_TTL_MS = 10 * 60 * 1000;
const PAGE_CACHE_MAX = 120;
const MAX_REDIRECTS = 3;
const DEFAULT_USER_AGENT = 'OpenConvo/0.1 (+https://openconvo.vercel.app)';

const pageCache = new Map<string, { expiresAt: number; content: string | null }>();

export interface DestinationValidationResult {
  safe: boolean;
  reason?: string;
  url?: URL;
}

/**
 * Step 2: Authoritative Outbound Destination Validation Policy
 * Enforces:
 * - Protocol strictly http: or https:
 * - Credentials in URLs rejected
 * - Private/loopback/link-local IPv4 and IPv6 prohibited
 * - IPv4-mapped IPv6 unmapped and evaluated
 * - Internal TLDs, hostnames, and cloud metadata endpoints prohibited
 */
export function validateOutboundDestination(value: string | URL): DestinationValidationResult {
  let url: URL;
  try {
    url = typeof value === 'string' ? new URL(value) : value;
  } catch {
    return { safe: false, reason: 'Malformed URL' };
  }

  // 1. Protocol validation
  if (!['http:', 'https:'].includes(url.protocol)) {
    return { safe: false, reason: `Unsupported protocol: ${url.protocol}` };
  }

  // 2. Prohibit embedded credentials
  if (url.username || url.password) {
    return { safe: false, reason: 'Embedded credentials are prohibited' };
  }

  // 3. Port restrictions (allow standard web ports only if non-default)
  if (url.port) {
    const port = Number(url.port);
    if (![80, 443, 8080, 8443].includes(port)) {
      return { safe: false, reason: `Port ${port} is outside permitted outbound web ports` };
    }
  }

  // 4. Hostname and IP validation
  if (isBlockedHostname(url.hostname)) {
    return { safe: false, reason: `Destination host ${url.hostname} is blocked by SSRF policy` };
  }

  return { safe: true, url };
}

/**
 * Checks whether a hostname or IP represents a private, loopback, link-local,
 * multicast, broadcast, cloud-metadata, or internal domain.
 */
export function isBlockedHostname(hostname: string): boolean {
  if (!hostname || typeof hostname !== 'string') return true;
  let host = hostname.trim().toLowerCase();

  // Strip enclosing brackets for IPv6 if present
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }

  // 1. Prohibit local and internal hostnames
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.lan') ||
    host.endsWith('.home') ||
    host.endsWith('.corp') ||
    host.endsWith('.intranet') ||
    host.endsWith('.arpa') ||
    host === 'metadata.google.internal' ||
    host === 'instance-data'
  ) {
    return true;
  }

  // 2. Handle IPv4 formats
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const parts = host.split('.').map(Number);
    if (parts.some((p) => p < 0 || p > 255 || isNaN(p))) {
      return true; // invalid octet
    }
    const [a, b, c, d] = parts;

    // 0.0.0.0/8
    if (a === 0) return true;
    // 10.0.0.0/8
    if (a === 10) return true;
    // 100.64.0.0/10 (Carrier-Grade NAT)
    if (a === 100 && b >= 64 && b <= 127) return true;
    // 127.0.0.0/8 (Loopback)
    if (a === 127) return true;
    // 169.254.0.0/16 (Link-Local / AWS/GCP metadata)
    if (a === 169 && b === 254) return true;
    // 172.16.0.0/12 (Private)
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (a === 192 && b === 0 && c === 0) return true;
    // 192.0.2.0/24 (TEST-NET-1)
    if (a === 192 && b === 0 && c === 2) return true;
    // 192.88.99.0/24 (6to4 Relay Anycast)
    if (a === 192 && b === 88 && c === 99) return true;
    // 192.168.0.0/16 (Private)
    if (a === 192 && b === 168) return true;
    // 198.18.0.0/15 (Benchmarking)
    if (a === 198 && (b === 18 || b === 19)) return true;
    // 198.51.100.0/24 (TEST-NET-2)
    if (a === 198 && b === 51 && c === 100) return true;
    // 203.0.113.0/24 (TEST-NET-3)
    if (a === 203 && b === 0 && c === 113) return true;
    // 224.0.0.0/4 (Multicast)
    if (a >= 224 && a <= 239) return true;
    // 240.0.0.0/4 (Reserved)
    if (a >= 240) return true;
    // 255.255.255.255 (Broadcast)
    if (a === 255 && b === 255 && c === 255 && d === 255) return true;

    return false;
  }

  // Numeric single-integer or hex-encoded IPv4 (e.g. 2130706433 or 0x7f000001)
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) {
    return true; // Reject integer-encoded IPs
  }

  // 3. Handle IPv6 formats
  // Check loopback
  if (host === '::1' || host === '0:0:0:0:0:0:0:1' || host === '::' || host === '0:0:0:0:0:0:0:0') {
    return true;
  }

  // Check IPv4-mapped IPv6 (::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (host.includes('::ffff:') || host.startsWith('0:0:0:0:0:ffff:')) {
    const parts = host.split(':');
    const lastPart = parts[parts.length - 1];
    if (lastPart && lastPart.includes('.')) {
      return isBlockedHostname(lastPart);
    }
    return true; // Reject hex-based mapped addresses
  }

  // Check IPv6 private / link-local / ULA ranges
  // fc00::/7 (Unique Local Address) starts with fc or fd
  if (host.startsWith('fc') || host.startsWith('fd')) {
    return true;
  }
  // fe80::/10 (Link-Local) starts with fe8, fe9, fea, feb
  if (/^fe[89ab]/i.test(host)) {
    return true;
  }
  // ff00::/8 (Multicast)
  if (host.startsWith('ff')) {
    return true;
  }
  // 2001:db8::/32 (Documentation)
  if (host.startsWith('2001:db8') || host.startsWith('2001:0db8')) {
    return true;
  }

  return false;
}

export async function enrichSearchResults(
  results: SearchResult[],
  options: { maxPages?: number; signal?: AbortSignal } = {}
): Promise<SearchResult[]> {
  const maxPages = options.maxPages ?? 3;
  const enriched = await Promise.all(
    results.map(async (result, index) => {
      if (index >= maxPages || options.signal?.aborted) return result;
      const extracted = await fetchReadablePage(result.url, options.signal);
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

export async function validateOutboundDestinationWithDns(value: string | URL): Promise<DestinationValidationResult> {
  const syncCheck = validateOutboundDestination(value);
  if (!syncCheck.safe || !syncCheck.url) return syncCheck;

  const hostname = syncCheck.url.hostname;
  // If hostname is already an explicit IP, isBlockedHostname in syncCheck already validated it
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')) {
    return syncCheck;
  }

  // If running in a Node.js runtime, perform DNS pre-resolution against blocked IP ranges
  try {
    if (typeof process !== 'undefined' && process.versions?.node) {
      const dns = await import('node:dns/promises');
      const lookups = await dns.lookup(hostname, { all: true });
      for (const entry of lookups) {
        if (isBlockedHostname(entry.address)) {
          return {
            safe: false,
            reason: `Destination host ${hostname} resolves to blocked IP ${entry.address}`,
          };
        }
      }
    }
  } catch (dnsErr) {
    return {
      safe: false,
      reason: `DNS lookup failed for ${hostname}: ${(dnsErr as Error).message}`,
    };
  }

  return syncCheck;
}

export type PageResponse = {
  status: number;
  location?: string;
  contentType: string;
  contentLength?: number;
  body: string;
};

export type PageTransport = (url: URL, signal: AbortSignal) => Promise<PageResponse>;

/**
 * Page extraction is on unless OPENCONVO_ENABLE_PAGE_EXTRACTION=false. The
 * DNS-rebinding gap that kept it off is closed by pinnedTransport: the socket
 * connects only to an address that passed the private-network check.
 */
export function isPageExtractionEnabled(): boolean {
  return process.env.OPENCONVO_ENABLE_PAGE_EXTRACTION !== 'false';
}

/**
 * Resolve a hostname and refuse it when ANY returned address is private,
 * loopback, link-local or otherwise blocked. Used as the socket's `lookup`, so
 * the address that was checked is the address that is connected to: a second
 * DNS answer cannot redirect the connection to an internal host.
 */
export function safeLookup(
  hostname: string,
  options: { all?: boolean; family?: number } | number | undefined,
  callback: (...args: unknown[]) => void
): void {
  const wantAll = typeof options === 'object' && options !== null && options.all === true;
  import('node:dns').then((dns) => {
    dns.lookup(hostname, { all: true }, (error, addresses) => {
      if (error) {
        callback(error);
        return;
      }
      const list = (addresses as Array<{ address: string; family: number }>) || [];
      const blocked = list.find((entry) => isBlockedHostname(entry.address));
      if (list.length === 0 || blocked) {
        const err = new Error(`Destination ${hostname} resolves to a blocked address`) as NodeJS.ErrnoException;
        err.code = 'EBLOCKED';
        callback(err);
        return;
      }
      if (wantAll) callback(null, list);
      else callback(null, list[0].address, list[0].family);
    });
  }, (error) => callback(error));
}

/** GET over node:http(s) with the socket pinned through safeLookup. */
export const pinnedTransport: PageTransport = async (url, signal) => {
  const mod = url.protocol === 'https:' ? await import('node:https') : await import('node:http');
  return new Promise<PageResponse>((resolve, reject) => {
    const req = mod.request(url, {
      method: 'GET',
      signal,
      lookup: safeLookup as never,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.8',
        'User-Agent': DEFAULT_USER_AGENT,
      },
    }, (res) => {
      const status = res.statusCode || 0;
      const contentType = String(res.headers['content-type'] || '');
      const lengthHeader = Number(res.headers['content-length'] || 0);
      const location = typeof res.headers.location === 'string' ? res.headers.location : undefined;
      if ((status >= 300 && status < 400) || status >= 400 || !isReadableContentType(contentType) ||
        (Number.isFinite(lengthHeader) && lengthHeader > MAX_FETCH_BYTES)) {
        res.resume();
        resolve({ status, location, contentType, contentLength: lengthHeader || undefined, body: '' });
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      res.on('data', (chunk: Buffer) => {
        if (total >= MAX_FETCH_BYTES) return;
        const remaining = MAX_FETCH_BYTES - total;
        chunks.push(chunk.length > remaining ? chunk.subarray(0, remaining) : chunk);
        total += chunk.length;
        if (total >= MAX_FETCH_BYTES) res.destroy();
      });
      const finish = () => resolve({
        status,
        contentType,
        contentLength: lengthHeader || undefined,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      res.on('end', finish);
      res.on('close', finish);
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
};

let pageTransport: PageTransport = pinnedTransport;

/** Tests replace the network transport; production always uses pinnedTransport. */
export function __setPageTransportForTests(transport: PageTransport | null): void {
  pageTransport = transport || pinnedTransport;
}

export async function fetchReadablePage(url: string, parentSignal?: AbortSignal): Promise<string | null> {
  if (!isPageExtractionEnabled()) return null;

  const validation = validateOutboundDestination(url);
  if (!validation.safe || !validation.url) return null;

  let currentUrl = validation.url;
  const cacheKey = canonicalPageCacheKey(currentUrl);
  const cached = getCachedPage(cacheKey);
  if (cached.hit) return cached.content;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('Page fetch timed out')), FETCH_TIMEOUT_MS);
  const onParentAbort = () => controller.abort(parentSignal?.reason || new Error('User stopped request'));

  if (parentSignal) {
    if (parentSignal.aborted) {
      clearTimeout(timeout);
      return null;
    }
    parentSignal.addEventListener('abort', onParentAbort, { once: true });
  }

  try {
    let response: PageResponse | null = null;

    // Follow redirects manually, revalidating every hop.
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (controller.signal.aborted) break;
      const res = await pageTransport(currentUrl, controller.signal);

      if ([301, 302, 303, 307, 308].includes(res.status)) {
        if (!res.location) return null;
        const nextValidation = validateOutboundDestination(new URL(res.location, currentUrl));
        if (!nextValidation.safe || !nextValidation.url) return null;
        currentUrl = nextValidation.url;
        continue;
      }

      response = res;
      break;
    }

    if (!response || response.status < 200 || response.status >= 300) return null;
    if (!isReadableContentType(response.contentType) || !response.body.trim()) {
      setCachedPage(cacheKey, null);
      return null;
    }

    const text = response.contentType.includes('text/plain')
      ? response.body
      : extractReadableText(response.body);
    const content = text ? text.slice(0, MAX_EXTRACTED_CHARS) : null;
    setCachedPage(cacheKey, content);
    return content;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    if (parentSignal) parentSignal.removeEventListener('abort', onParentAbort);
  }
}

export function parseSafeFetchUrl(value: string): URL | null {
  const result = validateOutboundDestination(value);
  return result.safe && result.url ? result.url : null;
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
  for (const key of TRACKING_QUERY_PARAMS) {
    parsed.searchParams.delete(key);
  }
  return parsed.href.toLowerCase();
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
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d{1,7});/g, (_, dec: string) => safeCodePoint(parseInt(dec, 10)))
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

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return ' ';
  return String.fromCodePoint(code);
}
