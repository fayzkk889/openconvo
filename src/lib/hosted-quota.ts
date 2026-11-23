import { createHmac } from 'node:crypto';

/**
 * Hosted-free usage accounting.
 *
 * Two layers are enforced for every hosted (keyless) request:
 *   - a per-visitor daily limit, so one visitor cannot drain shared capacity;
 *   - a deployment-wide daily limit, so all visitors together stay under the
 *     shared provider key's own cap (OpenRouter free keys allow ~50 requests a
 *     day, and failed requests count).
 *
 * With a shared Redis store (Upstash REST, or Vercel KV which exposes the same
 * API) the counters are global and atomic across serverless instances: every
 * reservation is a single INCR, so concurrent requests cannot both take the
 * last slot. Without one, counters live in this instance's memory, which is
 * only adequate for local runs and access-restricted Previews.
 *
 * Accounting model: a reservation counts immediately. If the request fails
 * before using the provider, the per-visitor slot is refunded; the
 * deployment-wide slot is not, because upstream attempts count against the
 * provider's cap even when they fail. If an instance dies mid-request, the
 * reservation simply stays counted (fails safe).
 */

export type QuotaScope = 'chat' | 'search';

export interface QuotaLimits {
  perIdentity: number;
  global: number;
}

export interface QuotaReservation {
  allowed: boolean;
  /** Which limit refused the request, if any. */
  reason?: 'identity' | 'global' | 'store-unavailable';
  scope: QuotaScope;
  identity: string;
  limit: number;
  remaining: number;
  resetAt: number;
  /** Day bucket the reservation was counted in (needed to refund it). */
  day: string;
}

interface QuotaBackend {
  /** Atomically add `by` and return the new value. */
  incr(key: string, by: number, ttlSeconds: number): Promise<number>;
}

const KEY_PREFIX = 'openconvo:quota';
const KEY_TTL_SECONDS = 2 * 24 * 60 * 60;
const STORE_TIMEOUT_MS = 2500;

// ---------------------------------------------------------------------------
// Backends
// ---------------------------------------------------------------------------

const memoryCounters = new Map<string, { value: number; expiresAt: number }>();

const memoryBackend: QuotaBackend = {
  async incr(key, by, ttlSeconds) {
    const now = Date.now();
    const existing = memoryCounters.get(key);
    const entry = existing && existing.expiresAt > now ? existing : { value: 0, expiresAt: now + ttlSeconds * 1000 };
    entry.value += by;
    memoryCounters.set(key, entry);
    if (memoryCounters.size > 5000) pruneMemory(now);
    return entry.value;
  },
};

function pruneMemory(now: number): void {
  for (const [key, entry] of memoryCounters) {
    if (entry.expiresAt <= now) memoryCounters.delete(key);
  }
}

export interface SharedStoreConfig {
  url: string;
  token: string;
}

/** Upstash Redis REST credentials, or Vercel KV's equivalent variables. */
export function sharedStoreConfig(env: NodeJS.ProcessEnv = process.env): SharedStoreConfig | null {
  const url = (env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL)?.trim();
  const token = (env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN)?.trim();
  if (!url || !token) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && !isLocalHost(parsed.hostname)) return null;
  } catch {
    return null;
  }
  return { url: url.replace(/\/+$/, ''), token };
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function restBackend(config: SharedStoreConfig): QuotaBackend {
  return {
    async incr(key, by, ttlSeconds) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), STORE_TIMEOUT_MS);
      try {
        // One pipeline: INCRBY is atomic. Keys are bucketed by UTC day, so
        // refreshing the two-day TTL on every write is harmless.
        const response = await fetch(`${config.url}/pipeline`, {
          method: 'POST',
          signal: controller.signal,
          cache: 'no-store',
          headers: {
            Authorization: `Bearer ${config.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify([
            ['INCRBY', key, String(by)],
            ['EXPIRE', key, String(ttlSeconds)],
          ]),
        });
        if (!response.ok) throw new Error(`quota store responded ${response.status}`);
        const data = (await response.json()) as Array<{ result?: unknown; error?: unknown }>;
        const first = Array.isArray(data) ? data[0] : undefined;
        if (!first || first.error !== undefined || typeof first.result !== 'number') {
          throw new Error('quota store returned an unexpected response');
        }
        return first.result;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function backendFor(env: NodeJS.ProcessEnv): { backend: QuotaBackend; shared: boolean } {
  const config = sharedStoreConfig(env);
  return config ? { backend: restBackend(config), shared: true } : { backend: memoryBackend, shared: false };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function nextUtcMidnight(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

/**
 * Visitor IPs never reach the shared store in clear text: keys use an HMAC of
 * the identity, keyed with the store token, so the stored keys cannot be
 * reversed by brute-forcing the IPv4 space without that secret.
 */
function identityKey(scope: QuotaScope, day: string, identity: string, env: NodeJS.ProcessEnv): string {
  const config = sharedStoreConfig(env);
  const id = config ? createHmac('sha256', config.token).update(identity).digest('hex').slice(0, 32) : identity;
  return `${KEY_PREFIX}:${scope}:${day}:id:${id}`;
}

function globalKey(scope: QuotaScope, day: string): string {
  return `${KEY_PREFIX}:${scope}:${day}:global`;
}

export async function reserveQuota(
  scope: QuotaScope,
  identity: string,
  limits: QuotaLimits,
  options: { env?: NodeJS.ProcessEnv; now?: number } = {}
): Promise<QuotaReservation> {
  const env = options.env || process.env;
  const now = options.now ?? Date.now();
  const day = utcDay(now);
  const resetAt = nextUtcMidnight(now);
  const base = { scope, identity, limit: limits.perIdentity, resetAt, day };
  const { backend } = backendFor(env);

  try {
    const used = await backend.incr(identityKey(scope, day, identity, env), 1, KEY_TTL_SECONDS);
    if (used > limits.perIdentity) {
      await backend.incr(identityKey(scope, day, identity, env), -1, KEY_TTL_SECONDS).catch(() => undefined);
      return { ...base, allowed: false, reason: 'identity', remaining: 0 };
    }

    const globalUsed = await backend.incr(globalKey(scope, day), 1, KEY_TTL_SECONDS);
    if (globalUsed > limits.global) {
      // The deployment is out of shared capacity; refund the visitor's slot.
      await backend.incr(identityKey(scope, day, identity, env), -1, KEY_TTL_SECONDS).catch(() => undefined);
      return { ...base, allowed: false, reason: 'global', remaining: 0 };
    }

    return { ...base, allowed: true, remaining: Math.max(limits.perIdentity - used, 0) };
  } catch (error) {
    // Fail closed: if the shared counter cannot be reached, do not lend capacity.
    console.error('Hosted quota store error:', error instanceof Error ? error.message : error);
    return { ...base, allowed: false, reason: 'store-unavailable', remaining: 0 };
  }
}

/**
 * Refund the visitor's slot for a request that never reached the provider or
 * produced nothing. Safe to call more than once only if the caller guards it.
 */
export async function releaseQuota(
  reservation: QuotaReservation,
  options: { env?: NodeJS.ProcessEnv } = {}
): Promise<void> {
  if (!reservation.allowed) return;
  const env = options.env || process.env;
  const { backend } = backendFor(env);
  try {
    await backend.incr(identityKey(reservation.scope, reservation.day, reservation.identity, env), -1, KEY_TTL_SECONDS);
  } catch (error) {
    console.error('Hosted quota release error:', error instanceof Error ? error.message : error);
  }
}

export function quotaRefusalMessage(reservation: QuotaReservation, product: 'chat' | 'search'): string {
  const when = new Date(reservation.resetAt).toUTCString();
  const own = product === 'chat' ? 'your own OpenRouter key' : 'your own Tavily or OpenRouter key';
  if (reservation.reason === 'global') {
    return `This deployment's shared free capacity is used up for today. Add ${own} in Settings, or try again after ${when}.`;
  }
  if (reservation.reason === 'store-unavailable') {
    return `Shared free capacity is temporarily unavailable. Add ${own} in Settings to continue.`;
  }
  const label = product === 'chat' ? 'Hosted free mode' : 'Hosted search';
  return `${label} daily limit reached. Add ${own} in Settings or try again after ${when}.`;
}

/** For tests only. */
export function __resetMemoryQuotaForTests(): void {
  memoryCounters.clear();
}
