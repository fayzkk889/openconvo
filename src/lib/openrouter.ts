import { AIModel } from '@/types/models';
import { CURATED_FREE_MODELS, FALLBACK_CHAIN, isFreeModelId } from './models';
import { buildConversationTitle } from './title';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const OPENROUTER_REQUEST_TIMEOUT_MS = 45 * 1000;
const FREE_ONLY_PROVIDER_OPTIONS = {
  sort: 'price',
  max_price: {
    prompt: 0,
    completion: 0,
    request: 0,
    image: 0,
  },
};

export class OpenRouterError extends Error {
  status: number;
  body: string;
  retryAfterSeconds?: number;
  providerName?: string;
  providerMessage?: string;

  constructor(status: number, body: string) {
    super(`OpenRouter error ${status}: ${body}`);
    this.name = 'OpenRouterError';
    this.status = status;
    this.body = body;

    const details = parseOpenRouterErrorBody(body);
    this.retryAfterSeconds = details.retryAfterSeconds;
    this.providerName = details.providerName;
    this.providerMessage = details.message;
  }
}

export function formatOpenRouterError(error: OpenRouterError, model?: string): string {
  const retryText = error.retryAfterSeconds
    ? ` Retry in about ${Math.ceil(error.retryAfterSeconds)} seconds.`
    : '';
  const providerText = error.providerName ? ` (${error.providerName})` : '';
  const modelText = model ? ` for ${model}` : '';

  if (error.status === 429) {
    return `The free OpenRouter provider${providerText} is temporarily rate-limited${modelText}.${retryText} Try again shortly or switch to another free model.`;
  }

  if (error.status === 402) {
    return 'OpenRouter rejected the request because it was not available at zero price. OpenConvo blocked paid routing; choose a :free model and try again.';
  }

  if (error.status === 401 || error.status === 403) {
    return 'OpenRouter rejected the API key. Check your OpenRouter key in Settings or your .env.local file.';
  }

  return error.providerMessage
    ? `OpenRouter error ${error.status}${modelText}: ${error.providerMessage}`
    : `OpenRouter error ${error.status}${modelText}. Please try another free model.`;
}

function parseOpenRouterErrorBody(body: string): {
  message?: string;
  providerName?: string;
  retryAfterSeconds?: number;
} {
  try {
    const parsed = JSON.parse(body) as {
      error?: {
        message?: unknown;
        metadata?: {
          provider_name?: unknown;
          retry_after_seconds?: unknown;
          retry_after_seconds_raw?: unknown;
        };
      };
    };
    const metadata = parsed.error?.metadata;
    const retryAfter = metadata?.retry_after_seconds ?? metadata?.retry_after_seconds_raw;
    return {
      message: typeof parsed.error?.message === 'string' ? parsed.error.message : undefined,
      providerName: typeof metadata?.provider_name === 'string' ? metadata.provider_name : undefined,
      retryAfterSeconds: typeof retryAfter === 'number' ? retryAfter : undefined,
    };
  } catch {
    return {};
  }
}

function getApiKey(clientKey?: string | null): string {
  if (clientKey) return clientKey;
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY is not set');
  return key;
}

function getHeaders(clientKey?: string | null): Record<string, string> {
  return {
    'Authorization': `Bearer ${getApiKey(clientKey)}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://openconvo.app',
    'X-Title': 'OpenConvo',
  };
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export type GeneratedResearchPlan = {
  queries: string[];
  entities: string[];
};

export async function streamChat(
  messages: ChatMessage[],
  model: string,
  systemPrompt?: string,
  apiKey?: string | null
): Promise<Response> {
  const allMessages: ChatMessage[] = [];
  if (systemPrompt) {
    allMessages.push({ role: 'system', content: systemPrompt });
  }
  allMessages.push(...messages);

  const response = await fetchOpenRouterWithTimeout({
    model,
    messages: allMessages,
    stream: true,
    provider: FREE_ONLY_PROVIDER_OPTIONS,
  }, apiKey);

  if (!response.ok) {
    const errorBody = await response.text();
    throw new OpenRouterError(response.status, errorBody);
  }

  return response;
}

async function fetchOpenRouterWithTimeout(body: Record<string, unknown>, apiKey?: string | null): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENROUTER_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: getHeaders(apiKey),
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('OpenRouter did not start a response in time. Please retry or choose another free model.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateTitle(
  messages: ChatMessage[],
  apiKey?: string | null,
  preferredModel?: string
): Promise<string> {
  const titleMessages: ChatMessage[] = [
    { role: 'system', content: 'Generate a brief, descriptive title (3-6 words) for this conversation. Respond with ONLY the title text, nothing else. No quotes.' },
    ...messages.slice(0, 4),
    { role: 'user', content: 'Generate a short title for the conversation above.' },
  ];

  const modelsToTry = [
    preferredModel,
    ...FALLBACK_CHAIN,
  ].filter((model, index, all): model is string =>
    Boolean(model) && isFreeModelId(model) && all.indexOf(model) === index
  );

  for (const model of modelsToTry) {
    try {
      const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: 'POST',
        headers: getHeaders(apiKey),
        body: JSON.stringify({
          model,
          messages: titleMessages,
          max_tokens: 30,
          provider: FREE_ONLY_PROVIDER_OPTIONS,
        }),
      });

      if (!response.ok) continue;

      const data = await response.json();
      const title = data.choices?.[0]?.message?.content?.trim();
      if (title) return cleanGeneratedTitle(title);
    } catch {
      // Title generation is best-effort; try the next model.
    }
  }

  return fallbackTitle(messages);
}

export async function generateResearchPlan(
  query: string,
  options?: {
    apiKey?: string | null;
    preferredModel?: string;
    deep?: boolean;
  }
): Promise<GeneratedResearchPlan | null> {
  const normalizedQuery = query.replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!normalizedQuery) return null;

  const maxQueries = options?.deep ? 7 : 5;
  const plannerMessages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You are a search query planner for a web research assistant.',
        'Create generic web search queries for ANY user topic. Do not rely on topic-specific rules.',
        'Extract the key entities, products, people, places, constraints, dates, and comparison sides from the user request.',
        'Return ONLY valid JSON in this exact shape: {"queries":["..."],"entities":["..."]}.',
        `Use ${maxQueries} or fewer queries. Queries should be short, precise, and searchable.`,
        'Prefer official/source/price/review/spec/news terms only when they match the user intent.',
        'Never answer the question. Never include markdown.',
      ].join(' '),
    },
    { role: 'user', content: normalizedQuery },
  ];

  const modelsToTry = [
    options?.preferredModel,
    ...FALLBACK_CHAIN,
  ].filter((model, index, all): model is string =>
    Boolean(model) && isFreeModelId(model) && all.indexOf(model) === index
  );

  for (const model of modelsToTry) {
    try {
      const response = await fetchOpenRouterWithTimeout({
        model,
        messages: plannerMessages,
        max_tokens: 220,
        temperature: 0.2,
        provider: FREE_ONLY_PROVIDER_OPTIONS,
      }, options?.apiKey);

      if (!response.ok) continue;
      const data = await response.json() as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string') continue;
      const parsed = parseGeneratedResearchPlan(content, maxQueries);
      if (parsed?.queries.length) return parsed;
    } catch {
      // Planner generation is best-effort; deterministic planner remains the fallback.
    }
  }

  return null;
}

function cleanGeneratedTitle(title: string): string {
  const cleaned = title
    .replace(/^["']|["']$/g, '')
    .replace(/^title:\s*/i, '')
    .replace(/\.$/, '')
    .trim();
  return cleaned ? cleaned.slice(0, 60) : 'New conversation';
}

function fallbackTitle(messages: ChatMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === 'user')?.content || '';
  return buildConversationTitle(firstUserMessage);
}

function parseGeneratedResearchPlan(content: string, maxQueries: number): GeneratedResearchPlan | null {
  const jsonText = extractJsonObject(content);
  if (!jsonText) return null;

  try {
    const parsed = JSON.parse(jsonText) as {
      queries?: unknown;
      entities?: unknown;
    };
    const queries = normalizePlannerStrings(parsed.queries, maxQueries, 120);
    const entities = normalizePlannerStrings(parsed.entities, 8, 80);
    if (!queries.length) return null;
    return { queries, entities };
  } catch {
    return null;
  }
}

function extractJsonObject(content: string): string | null {
  const trimmed = content.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  const match = trimmed.match(/\{[\s\S]*\}/);
  return match?.[0] || null;
}

function normalizePlannerStrings(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const normalized = item.replace(/\s+/g, ' ').trim().slice(0, maxChars);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= maxItems) break;
  }
  return result;
}

export async function fetchModels(apiKey?: string | null): Promise<AIModel[]> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://openconvo.app',
      'X-Title': 'OpenConvo',
    };
    
    // Add auth only if available to prevent throwing errors on initial load
    const key = apiKey || process.env.OPENROUTER_API_KEY;
    if (key) {
      headers['Authorization'] = `Bearer ${key}`;
    }

    const response = await fetch(`${OPENROUTER_BASE}/models`, {
      headers,
    });

    if (!response.ok) return CURATED_FREE_MODELS;

    const data = await response.json() as { data?: unknown };
    const rawModels = Array.isArray(data.data) ? data.data : [];
    const freeModels: AIModel[] = rawModels
      .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === 'object')
      .filter((m) => {
        if (typeof m.id !== 'string') return false;
        if (!m.id.endsWith(':free')) return false;
        const pricing = m.pricing as Record<string, unknown> | undefined;
        return pricing && isZeroPrice(pricing.prompt) && isZeroPrice(pricing.completion);
      })
      .map((m) => ({
        id: m.id as string,
        name: typeof m.name === 'string' ? m.name : m.id as string,
        provider: ((m.id as string).split('/')[0] || 'unknown'),
        contextLength: typeof m.context_length === 'number' ? m.context_length : 4096,
        description: typeof m.description === 'string' ? m.description.slice(0, 120) : '',
        isFree: true,
      }))
      .sort((a: AIModel, b: AIModel) => a.name.localeCompare(b.name));

    return freeModels.length > 0 ? freeModels : CURATED_FREE_MODELS;
  } catch {
    return CURATED_FREE_MODELS;
  }
}

function isZeroPrice(value: unknown): boolean {
  if (value === 0 || value === '0') return true;
  if (typeof value === 'number') return value === 0;
  if (typeof value !== 'string') return false;
  return Number(value) === 0;
}
