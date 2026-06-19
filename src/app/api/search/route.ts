import { NextRequest } from 'next/server';
import { searchWeb } from '@/lib/search';

type SearchUsageMode = 'byok' | 'hosted-search';

interface HostedSearchQuota {
  allowed: boolean;
  mode: SearchUsageMode;
  limit: number;
  remaining: number;
  resetAt: number;
  identity?: string;
}

const hostedSearchUsage = new Map<string, { count: number; resetAt: number }>();

export async function POST(request: NextRequest) {
  try {
    const key = getClientTavilyKey(request);
    const { query, mode } = await request.json();
    if (!query || typeof query !== 'string') {
      return Response.json({ error: 'Query is required' }, { status: 400 });
    }
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return Response.json({ error: 'Query is required' }, { status: 400 });
    }
    if (trimmedQuery.length > 500) {
      return Response.json({ error: 'Query is too long' }, { status: 400 });
    }

    const hostedQuota = getHostedSearchQuotaStatus(request, key);
    if (!hostedQuota.allowed) {
      return Response.json(
        {
          error: `Hosted search daily limit reached. Add your own Tavily key in Settings or try again after ${new Date(hostedQuota.resetAt).toLocaleString()}.`,
          hostedSearchUsage: publicHostedSearchUsage(hostedQuota),
        },
        {
          status: 429,
          headers: hostedSearchHeaders(hostedQuota.mode, hostedQuota),
        }
      );
    }

    const results = await searchWeb(trimmedQuery, key, mode === 'research' ? 'research' : 'search');
    const committedQuota = commitHostedSearchQuota(hostedQuota);

    return Response.json(
      {
        ...results,
        hostedSearchUsage: publicHostedSearchUsage(committedQuota),
      },
      {
        headers: hostedSearchHeaders(committedQuota.mode, committedQuota),
      }
    );
  } catch (error) {
    console.error('Search API error:', error);
    const message = error instanceof Error ? error.message : 'Search failed';
    const status = message.includes('TAVILY_API_KEY') ? 503 : 500;
    return Response.json({ error: message }, { status });
  }
}

function getClientTavilyKey(request: NextRequest): string | null {
  const key = request.headers.get('x-tavily-key')?.trim();
  return key || null;
}

function getHostedSearchQuotaStatus(request: NextRequest, clientKey: string | null): HostedSearchQuota {
  if (clientKey) {
    return {
      allowed: true,
      mode: 'byok',
      limit: 0,
      remaining: 0,
      resetAt: 0,
    };
  }

  const limit = getHostedSearchDailyLimit();
  const identity = getUsageIdentity(request);
  const now = Date.now();
  const resetAt = getNextUtcMidnight(now);
  const existing = hostedSearchUsage.get(identity);
  const entry = existing && existing.resetAt > now
    ? existing
    : { count: 0, resetAt };

  if (entry.count >= limit) {
    hostedSearchUsage.set(identity, entry);
    return {
      allowed: false,
      mode: 'hosted-search',
      limit,
      remaining: 0,
      resetAt: entry.resetAt,
      identity,
    };
  }

  hostedSearchUsage.set(identity, entry);
  pruneHostedSearchUsage(now);

  return {
    allowed: true,
    mode: 'hosted-search',
    limit,
    remaining: Math.max(limit - entry.count, 0),
    resetAt: entry.resetAt,
    identity,
  };
}

function commitHostedSearchQuota(quota: HostedSearchQuota): HostedSearchQuota {
  if (quota.mode === 'byok' || !quota.identity) return quota;

  const now = Date.now();
  const existing = hostedSearchUsage.get(quota.identity);
  const entry = existing && existing.resetAt > now
    ? existing
    : { count: 0, resetAt: getNextUtcMidnight(now) };
  entry.count += 1;
  hostedSearchUsage.set(quota.identity, entry);

  return {
    ...quota,
    allowed: entry.count <= quota.limit,
    remaining: Math.max(quota.limit - entry.count, 0),
    resetAt: entry.resetAt,
  };
}

function publicHostedSearchUsage(quota: HostedSearchQuota): Omit<HostedSearchQuota, 'identity'> | undefined {
  if (quota.mode !== 'hosted-search') return undefined;
  return {
    allowed: quota.allowed,
    mode: quota.mode,
    limit: quota.limit,
    remaining: quota.remaining,
    resetAt: quota.resetAt,
  };
}

function hostedSearchHeaders(
  mode: SearchUsageMode,
  usage: { limit: number; remaining: number; resetAt: number }
): Record<string, string> {
  if (mode === 'byok') {
    return {
      'X-OpenConvo-Search-Mode': 'byok',
    };
  }

  return {
    'X-OpenConvo-Search-Mode': 'hosted-search',
    'X-OpenConvo-Search-Limit': String(usage.limit),
    'X-OpenConvo-Search-Remaining': String(usage.remaining),
    'X-OpenConvo-Search-Reset': String(usage.resetAt),
  };
}

function getHostedSearchDailyLimit(): number {
  const value = Number(process.env.OPENCONVO_HOSTED_SEARCH_DAILY_LIMIT || 5);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 5;
}

function getUsageIdentity(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const realIp = request.headers.get('x-real-ip')?.trim();
  const cfIp = request.headers.get('cf-connecting-ip')?.trim();
  return cfIp || forwardedFor || realIp || 'local';
}

function getNextUtcMidnight(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

function pruneHostedSearchUsage(now: number): void {
  for (const [identity, usage] of hostedSearchUsage.entries()) {
    if (usage.resetAt <= now) {
      hostedSearchUsage.delete(identity);
    }
  }
}
