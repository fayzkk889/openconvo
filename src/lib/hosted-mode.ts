import { sharedStoreConfig } from '@/lib/hosted-quota';

/**
 * Whether this deployment lends its own provider keys (OPENROUTER_API_KEY,
 * TAVILY_API_KEY) to visitors who have not added their own.
 *
 * Public deployments default to bring-your-own-key. Shared capacity is lent
 * only when:
 *   - OPENCONVO_HOSTED_FREE=on is set explicitly by the operator. On a Vercel
 *     production deployment this additionally requires a shared quota store
 *     (UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN), because
 *     per-instance memory counters cannot enforce a global daily cap across
 *     serverless instances; or
 *   - the deployment is a Vercel Preview (access-restricted by Vercel
 *     Authentication) and OPENCONVO_HOSTED_FREE is not set to "off".
 */
export function isHostedFreeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const setting = env.OPENCONVO_HOSTED_FREE?.trim().toLowerCase();
  if (setting === 'off') return false;
  if (setting === 'on') {
    return env.VERCEL_ENV === 'production' ? Boolean(sharedStoreConfig(env)) : true;
  }
  return env.VERCEL_ENV === 'preview';
}

/** The server's OpenRouter key, only when hosted capacity may be lent out. */
export function hostedOpenRouterKey(env: NodeJS.ProcessEnv = process.env): string | null {
  return isHostedFreeEnabled(env) ? env.OPENROUTER_API_KEY?.trim() || null : null;
}

/** The server's Tavily key, only when hosted capacity may be lent out. */
export function hostedTavilyKey(env: NodeJS.ProcessEnv = process.env): string | null {
  return isHostedFreeEnabled(env) ? env.TAVILY_API_KEY?.trim() || null : null;
}
