import { AIModel } from '@/types/models';
import { CURATED_FREE_MODELS, FALLBACK_CHAIN, isFreeModelId } from './models';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
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

  const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: getHeaders(apiKey),
    body: JSON.stringify({
      model,
      messages: allMessages,
      stream: true,
      provider: FREE_ONLY_PROVIDER_OPTIONS,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new OpenRouterError(response.status, errorBody);
  }

  return response;
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
  const words = firstUserMessage
    .replace(/[`*_#[\](){}>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 6)
    .join(' ');

  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'New conversation';
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
