import { NextRequest } from 'next/server';
import { searchWeb, searchWebMany } from '@/lib/search';
import { enrichSearchResults } from '@/lib/web-extract';
import { planResearchQueries, detectEvidenceGaps } from '@/lib/research-planner';
import { generateResearchPlan } from '@/lib/openrouter';
import { stripLeadingGreeting } from '@/lib/tasks';
import { getUsageIdentity } from '@/lib/request-identity';
import { isHostedFreeEnabled } from '@/lib/hosted-mode';

export const maxDuration = 60;

type SearchUsageMode = 'byok' | 'hosted-search';

const SEARCH_ROUTE_BUDGET_MS = 52_000;
const RESEARCH_PLANNER_BUDGET_MS = 9_000;
const MAX_SEARCH_PAYLOAD_BYTES = 500 * 1024;

interface HostedSearchQuota {
  allowed: boolean;
  mode: SearchUsageMode;
  limit: number;
  remaining: number;
  resetAt: number;
  identity?: string;
}

interface HostedSearchUsageEntry {
  count: number;
  inFlight: number;
  resetAt: number;
}

const hostedSearchUsage = new Map<string, HostedSearchUsageEntry>();

export async function POST(request: NextRequest) {
  // Step 5 Invariant: Request payload size bounds
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_SEARCH_PAYLOAD_BYTES) {
    return Response.json({ error: 'Request payload is too large (max 500KB)' }, { status: 413 });
  }

  let hostedQuota: HostedSearchQuota | null = null;
  let quotaCommitted = false;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error('Search took too long. Try a narrower query or add Tavily/SearxNG for more reliable hosted research.')),
    SEARCH_ROUTE_BUDGET_MS
  );

  const onClientAbort = () => {
    controller.abort(request.signal.reason || new Error('User stopped search'));
  };
  request.signal.addEventListener('abort', onClientAbort, { once: true });

  try {
    const key = getClientTavilyKey(request);
    const openrouterKey = getClientOpenRouterKey(request);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { query, mode, model, contextEntities } = body as Record<string, unknown>;
    if (!query || typeof query !== 'string') {
      return Response.json({ error: 'Query is required' }, { status: 400 });
    }
    const trimmedQuery = stripLeadingGreeting(query);
    if (!trimmedQuery) {
      return Response.json({ error: 'Query is required' }, { status: 400 });
    }
    if (trimmedQuery.length > 4000) {
      return Response.json({ error: 'Query is too long (max 4000 characters)' }, { status: 400 });
    }

    const cleanContextEntities = Array.isArray(contextEntities)
      ? contextEntities.filter((e): e is string => typeof e === 'string' && e.trim().length > 0).slice(0, 5)
      : undefined;

    // Without hosted capacity, search is only for visitors who brought their own
    // keys: an unauthenticated endpoint would otherwise be an open scraping proxy.
    if (!isHostedFreeEnabled() && !key && !openrouterKey) {
      return Response.json(
        { error: 'Web search needs your own OpenRouter or Tavily key on this deployment. Add one in Settings.' },
        { status: 401 }
      );
    }

    hostedQuota = getHostedSearchQuotaStatus(request, key);
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

    const searchMode = mode === 'deep-research' ? 'deep-research' : mode === 'research' ? 'research' : 'search';
    const heuristicPlan = searchMode !== 'search'
      ? planResearchQueries(trimmedQuery, { deep: searchMode === 'deep-research', contextEntities: cleanContextEntities })
      : null;
    const initialSearchQuery = heuristicPlan
      ? bestInitialSearchQuery(heuristicPlan.queries, trimmedQuery)
      : trimmedQuery;

    const initialSearch = searchMode !== 'search'
      ? await searchWeb(initialSearchQuery, key, 'search', controller.signal)
      : null;

    if (controller.signal.aborted) {
      throw controller.signal.reason || new Error('User stopped search');
    }

    const researchPlan = searchMode !== 'search'
      ? await buildResearchPlan(trimmedQuery, {
          deep: searchMode === 'deep-research',
          apiKey: openrouterKey,
          model: typeof model === 'string' ? model : undefined,
          planningContext: initialSearch?.results,
          fallbackPlan: heuristicPlan || undefined,
          contextEntities: cleanContextEntities,
          // The model planner spends OpenRouter requests. Without the visitor's own
          // OpenRouter key it runs on the shared hosted key, which is only allowed
          // when this search is metered against the hosted search quota. A
          // client-supplied Tavily key alone must not unlock hosted model calls.
          allowModelPlanner: Boolean(openrouterKey) || (hostedQuota.mode === 'hosted-search' && isHostedFreeEnabled()),
        })
      : null;

    if (controller.signal.aborted) {
      throw controller.signal.reason || new Error('User stopped search');
    }

    let results = researchPlan
      ? await searchWebMany(researchPlan.queries, key, searchMode, researchPlan.entities || [], controller.signal)
      : await searchWeb(trimmedQuery, key, searchMode, controller.signal);

    // Step 7: Bounded second-pass research if critical evidence gaps remain in deep research
    if (searchMode === 'deep-research' && researchPlan && !controller.signal.aborted) {
      const gapCheck = detectEvidenceGaps(
        {
          queries: researchPlan.queries,
          entities: researchPlan.entities,
          primaryObjective: trimmedQuery,
        },
        results.results
      );
      if (gapCheck.hasGaps && gapCheck.gapQueries.length > 0) {
        const gapResults = await searchWebMany(
          gapCheck.gapQueries.slice(0, 2),
          key,
          searchMode,
          researchPlan.entities || [],
          controller.signal
        );
        const existingUrls = new Set(results.results.map((r) => r.url));
        for (const item of gapResults.results) {
          if (!existingUrls.has(item.url)) {
            existingUrls.add(item.url);
            results.results.push(item);
          }
        }
        if (gapResults.providers) {
          results.providers = Array.from(new Set([...(results.providers || []), ...gapResults.providers]));
        }
      }
    }

    const enrichedResults = await enrichSearchResults(results.results, {
      maxPages: searchMode === 'deep-research' ? 8 : searchMode === 'research' ? 5 : 2,
      signal: controller.signal,
    });

    // Step 5: Canonical evidence tagging with stable IDs, domain, canonicalUrl
    const taggedResults = enrichedResults.map((r, index) => {
      let hostname = '';
      try {
        hostname = new URL(r.url).hostname.replace(/^www\./, '');
      } catch {
        hostname = '';
      }
      return {
        ...r,
        id: r.id || `src_${index + 1}`,
        canonicalUrl: r.canonicalUrl || r.url,
        domain: r.domain || hostname || undefined,
        fetchedAt: r.fetchedAt || Date.now(),
      };
    });

    quotaCommitted = true;
    const committedQuota = commitHostedSearchQuota(hostedQuota);

    return Response.json(
      {
        ...results,
        results: taggedResults,
        plannedEntities: researchPlan?.entities,
        planner: researchPlan?.planner,
        hostedSearchUsage: publicHostedSearchUsage(committedQuota),
      },
      {
        headers: {
          ...hostedSearchHeaders(committedQuota.mode, committedQuota),
          'X-OpenConvo-Search-Provider': results.providers?.join(',') || results.provider || 'unknown',
          'X-OpenConvo-Research-Queries': String(results.plannedQueries?.length || 1),
        },
      }
    );
  } catch (error) {
    if (request.signal.aborted || (error as Error).name === 'AbortError') {
      return Response.json({ error: 'Search cancelled by client' }, { status: 499 });
    }
    console.error('Search API error:', error);
    const message = error instanceof Error ? error.message : 'Search failed';
    const status = message.includes('took too long') ? 504 : message.includes('TAVILY_API_KEY') ? 503 : 500;
    return Response.json({ error: message }, { status });
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', onClientAbort);
    if (hostedQuota && !quotaCommitted) {
      releaseHostedSearchQuota(hostedQuota);
    }
  }
}

function getClientTavilyKey(request: NextRequest): string | null {
  const key = request.headers.get('x-tavily-key')?.trim();
  return key || null;
}

function getClientOpenRouterKey(request: NextRequest): string | null {
  const key = request.headers.get('x-openrouter-key')?.trim();
  return key || null;
}

async function buildResearchPlan(
  query: string,
  options: {
    deep: boolean;
    apiKey?: string | null;
    model?: string;
    planningContext?: Array<{ title: string; url: string; snippet?: string }>;
    fallbackPlan?: { queries: string[]; entities?: string[] };
    contextEntities?: string[];
    allowModelPlanner: boolean;
  }
): Promise<{ queries: string[]; entities?: string[]; planner: 'model' | 'heuristic' }> {
  const modelPlan = options.allowModelPlanner ? await generateResearchPlan(query, {
    apiKey: options.apiKey,
    preferredModel: options.model,
    deep: options.deep,
    timeoutMs: RESEARCH_PLANNER_BUDGET_MS,
    planningContext: options.planningContext,
  }) : null;
  if (modelPlan?.queries.length) {
    const maxQueries = options.deep ? 7 : 5;
    // Model plan queries prioritized over fallback queries so model-planned queries survive plan merging
    const mergedQueries = dedupeSearchQueries([
      ...modelPlan.queries,
      ...(options.fallbackPlan?.queries || []),
    ]).slice(0, maxQueries);
    return {
      queries: mergedQueries.length ? mergedQueries : modelPlan.queries,
      entities: modelPlan.entities || options.fallbackPlan?.entities || options.contextEntities,
      planner: 'model',
    };
  }

  return {
    ...(options.fallbackPlan || planResearchQueries(query, { deep: options.deep, contextEntities: options.contextEntities })),
    planner: 'heuristic',
  };
}

function bestInitialSearchQuery(queries: string[], originalQuery: string): string {
  return queries.find((query) => query !== originalQuery && !isConversationalSearchQuery(query)) || originalQuery;
}

function dedupeSearchQueries(queries: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const query of queries) {
    const normalized = query.replace(/\s+/g, ' ').trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function isConversationalSearchQuery(query: string): boolean {
  return /\b(?:can u|can you|tell me|give me|please|some)\b/i.test(query);
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
  const identity = getUsageIdentity(request.headers);
  const now = Date.now();
  const resetAt = getNextUtcMidnight(now);
  const existing = hostedSearchUsage.get(identity);
  const entry = existing && existing.resetAt > now
    ? existing
    : { count: 0, inFlight: 0, resetAt };

  // Step 5 Invariant: Concurrent reservation limits
  if (entry.count + entry.inFlight >= limit) {
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

  // Reserve slot
  entry.inFlight += 1;
  hostedSearchUsage.set(identity, entry);
  pruneHostedSearchUsage(now);

  return {
    allowed: true,
    mode: 'hosted-search',
    limit,
    remaining: Math.max(limit - (entry.count + entry.inFlight), 0),
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
    : { count: 0, inFlight: 0, resetAt: getNextUtcMidnight(now) };
  entry.inFlight = Math.max(0, entry.inFlight - 1);
  entry.count += 1;
  hostedSearchUsage.set(quota.identity, entry);

  return {
    ...quota,
    allowed: entry.count <= quota.limit,
    remaining: Math.max(quota.limit - entry.count, 0),
    resetAt: entry.resetAt,
  };
}

function releaseHostedSearchQuota(quota: HostedSearchQuota): void {
  if (quota.mode === 'byok' || !quota.identity) return;
  const existing = hostedSearchUsage.get(quota.identity);
  if (existing) {
    existing.inFlight = Math.max(0, existing.inFlight - 1);
  }
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
  const value = Number(process.env.OPENCONVO_HOSTED_SEARCH_DAILY_LIMIT || 15);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 15;
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
