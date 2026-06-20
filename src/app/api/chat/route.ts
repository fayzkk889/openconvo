import { NextRequest } from 'next/server';
import { streamChat, generateTitle, ChatMessage, OpenRouterError, formatOpenRouterError } from '@/lib/openrouter';
import { FALLBACK_CHAIN, isFreeModelId } from '@/lib/models';
import { buildSystemPrompt } from '@/lib/prompts';
import { SearchResult } from '@/types/search';
import { Attachment, TaskType } from '@/types/chat';
import { normalizeTaskType } from '@/lib/tasks';
import { buildResearchFallbackAnswer } from '@/lib/research-fallback';
import { ensureResearchCitations } from '@/lib/research-citations';

const MAX_MESSAGES = 100;
const MAX_MESSAGE_CHARS = 50000;
const MAX_CONTEXT_ITEMS = 10;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 30 * 1000;
const CHAT_STREAM_IDLE_TIMEOUT_MS = 25 * 1000;

const modelCooldowns = new Map<string, number>();
const hostedUsage = new Map<string, { count: number; resetAt: number }>();
type UsageMode = 'byok' | 'hosted-free';
type HostedQuota = {
  allowed: boolean;
  mode: UsageMode;
  limit: number;
  remaining: number;
  resetAt: number;
  identity?: string;
};

export async function POST(request: NextRequest) {
  try {
    const key = getClientOpenRouterKey(request);
    const body = validateChatBody(await request.json());
    const {
      messages,
      model,
      systemPrompt,
      searchResults,
      attachments,
      researchMode,
      agentMode,
      taskType,
      generateTitleFor,
      availableModels,
    } = body;

    if (!hasOpenRouterKey(key)) {
      return Response.json(
        {
          error: 'OpenRouter API key is missing. Add your key in Settings or set OPENROUTER_API_KEY in .env.local.',
          rateLimitedModels: [],
        },
        { status: 401 }
      );
    }

    const hostedQuota = getHostedQuotaStatus(request, key);
    if (!hostedQuota.allowed) {
      return Response.json(
        {
          error: `Hosted free mode daily limit reached. Add your own OpenRouter key in Settings or try again after ${new Date(hostedQuota.resetAt).toLocaleString()}.`,
          rateLimitedModels: [],
          hostedUsage: publicHostedUsage(hostedQuota),
        },
        {
          status: 429,
          headers: usageHeaders('hosted-free', hostedQuota),
        }
      );
    }

    // Title generation (non-streaming)
    if (generateTitleFor) {
      const title = await generateTitle(messages, key, model);
      const usage = commitHostedQuota(hostedQuota);
      return Response.json(
        { title, hostedUsage: publicHostedUsage(usage) },
        { headers: usageHeaders(usage.mode, usage) }
      );
    }

    // Try the selected model, then fallback chain
    const modelsToTry = uniqueFreeModels([
      model,
      ...availableModels,
      ...FALLBACK_CHAIN,
    ]);
    let lastError: Error | null = null;
    let usedModel = model;
    const failedModels: string[] = [];
    const rateLimitedModels: string[] = [];
    const providerRateLimits = new Map<string, number>();
    const skippedModels = modelsToTry.filter((tryModel) => isModelCoolingDown(tryModel));
    let retryAfterSeconds: number | undefined;

    for (const tryModel of modelsToTry) {
      if (isModelCoolingDown(tryModel)) {
        continue;
      }

      try {
        const fullSystemPrompt = buildSystemPrompt({
          customPrompt: systemPrompt,
          activeModel: tryModel,
          researchMode,
          agentMode,
          taskType,
          searchResults,
          attachments,
        });

        const response = await streamChat(messages, tryModel, fullSystemPrompt, key);

        if (!response.body) {
          throw new Error('No response body');
        }

        usedModel = tryModel;
        const usage = commitHostedQuota(hostedQuota);

        // Transform the SSE stream to extract content deltas
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        const stream = new ReadableStream({
          async start(controller) {
            let buffer = '';
            let emittedContent = '';
            let controllerErrored = false;
            const encoder = new TextEncoder();
            if (failedModels.length > 0 || rateLimitedModels.length > 0) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                model: usedModel,
                failedModels,
                rateLimitedModels,
                retryAfterSeconds,
              })}\n\n`));
            }
            const emitSseLine = (line: string) => {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data: ')) return;
              const data = trimmed.slice(6);
              if (data === '[DONE]') return;

              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) {
                  emittedContent += content;
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content, model: usedModel })}\n\n`));
                }
              } catch {
                // skip malformed chunks
              }
            };

            try {
              while (true) {
                const { done, value } = await readStreamChunkWithTimeout(reader, CHAT_STREAM_IDLE_TIMEOUT_MS);
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                  emitSseLine(line);
                }
              }
              buffer += decoder.decode();
              if (buffer.trim()) {
                emitSseLine(buffer);
              }
              if (emittedContent.trim() && researchMode && searchResults?.length) {
                const finalContent = ensureResearchCitations(emittedContent, searchResults);
                const citationTail = finalContent.slice(emittedContent.trim().length);
                if (citationTail.trim()) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: citationTail, model: usedModel, citations: true })}\n\n`));
                }
              }
              if (!emittedContent.trim() && researchMode && searchResults?.length) {
                const fallback = buildResearchFallbackAnswer({
                  question: lastUserQuestion(messages),
                  sources: searchResults,
                  reason: 'the selected free model returned an empty response',
                });
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: fallback, model: usedModel, fallback: true })}\n\n`));
              }
            } catch (err) {
              await reader.cancel().catch(() => undefined);
              if (researchMode && searchResults?.length) {
                const fallback = buildResearchFallbackAnswer({
                  question: lastUserQuestion(messages),
                  sources: searchResults,
                  reason: emittedContent.trim()
                    ? 'the selected free model stopped streaming before it finished'
                    : 'the selected free model did not stream a response in time',
                });
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: emittedContent.trim() ? `\n\n${fallback}` : fallback, model: usedModel, fallback: true })}\n\n`));
              } else {
                controllerErrored = true;
                controller.error(err);
              }
            } finally {
              try {
                reader.releaseLock();
              } catch {
                // The upstream reader may already be released/cancelled after a timeout.
              }
              if (!controllerErrored) {
                controller.close();
              }
            }
          },
        });

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Model-Used': usedModel,
            ...usageHeaders(usage.mode, usage),
          },
        });
      } catch (err) {
        lastError = err as Error;
        failedModels.push(tryModel);
        if (err instanceof OpenRouterError && err.status === 429) {
          rateLimitedModels.push(tryModel);
          retryAfterSeconds = err.retryAfterSeconds || retryAfterSeconds;
          rememberModelCooldown(tryModel, err);
          console.warn(`Model ${tryModel} rate-limited; trying fallback.`);
          if (err.providerName) {
            const providerHits = (providerRateLimits.get(err.providerName) || 0) + 1;
            providerRateLimits.set(err.providerName, providerHits);
            if (providerHits >= 2) {
              break;
            }
          }
        } else if (err instanceof OpenRouterError && isOpenRouterAuthError(err)) {
          console.warn('OpenRouter authentication failed; not trying fallback models.');
          break;
        } else {
          console.error(`Model ${tryModel} failed:`, err);
        }
        continue;
      }
    }

    // All models failed
    return Response.json(
      {
        error: formatChatFailure(lastError, failedModels, skippedModels),
        rateLimitedModels,
        retryAfterSeconds: lastError instanceof OpenRouterError ? lastError.retryAfterSeconds : undefined,
        hostedUsage: publicHostedUsage(hostedQuota),
      },
      {
        status: 502,
        headers: usageHeaders(hostedQuota.mode, hostedQuota),
      }
    );
  } catch (error) {
    console.error('Chat API error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = isValidationError(message) ? 400 : 500;
    return Response.json(
      { error: message },
      { status }
    );
  }
}

async function readStreamChunkWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Chat stream timed out waiting for model output')), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function lastUserQuestion(messages: ChatMessage[]): string {
  return [...messages].reverse().find((message) => message.role === 'user')?.content || '';
}

function formatChatFailure(error: Error | null, failedModels: string[], skippedModels: string[]): string {
  const attemptedText = failedModels.length > 1
    ? ` OpenConvo tried ${failedModels.length} free models before giving up.`
    : '';
  const skippedText = skippedModels.length > 0
    ? ` ${skippedModels.length} temporarily rate-limited model${skippedModels.length === 1 ? ' was' : 's were'} skipped.`
    : '';
  if (error instanceof OpenRouterError) {
    return `${formatOpenRouterError(error)}${attemptedText}${skippedText}`;
  }
  return `${error?.message || 'All free models failed. Please try again shortly or choose another free model.'}${attemptedText}${skippedText}`;
}

function isModelCoolingDown(model: string): boolean {
  const expiresAt = modelCooldowns.get(model);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    modelCooldowns.delete(model);
    return false;
  }
  return true;
}

function rememberModelCooldown(model: string, error: OpenRouterError): void {
  modelCooldowns.set(model, Date.now() + getCooldownMs(error));
}

function getCooldownMs(error: OpenRouterError): number {
  return Math.max((error.retryAfterSeconds || 0) * 1000, DEFAULT_RATE_LIMIT_COOLDOWN_MS);
}

function isValidationError(message: string): boolean {
  return message.startsWith('Invalid ') || message === 'Messages are required';
}

function hasOpenRouterKey(clientKey: string | null): boolean {
  return Boolean(clientKey || process.env.OPENROUTER_API_KEY);
}

function isOpenRouterAuthError(error: OpenRouterError): boolean {
  return error.status === 401 || error.status === 403;
}

function getClientOpenRouterKey(request: NextRequest): string | null {
  const key = request.headers.get('x-openrouter-key')?.trim();
  return key || null;
}

function getHostedQuotaStatus(request: NextRequest, clientKey: string | null): HostedQuota {
  if (clientKey) {
    return {
      allowed: true,
      mode: 'byok',
      limit: 0,
      remaining: 0,
      resetAt: 0,
    };
  }

  const limit = getHostedFreeDailyLimit();
  const identity = getUsageIdentity(request);
  const now = Date.now();
  const resetAt = getNextUtcMidnight(now);
  const existing = hostedUsage.get(identity);
  const entry = existing && existing.resetAt > now
    ? existing
    : { count: 0, resetAt };

  if (entry.count >= limit) {
    hostedUsage.set(identity, entry);
    return {
      allowed: false,
      mode: 'hosted-free',
      limit,
      remaining: 0,
      resetAt: entry.resetAt,
      identity,
    };
  }

  hostedUsage.set(identity, entry);
  pruneHostedUsage(now);

  return {
    allowed: true,
    mode: 'hosted-free',
    limit,
    remaining: Math.max(limit - entry.count, 0),
    resetAt: entry.resetAt,
    identity,
  };
}

function commitHostedQuota(quota: HostedQuota): HostedQuota {
  if (quota.mode === 'byok' || !quota.identity) return quota;

  const now = Date.now();
  const existing = hostedUsage.get(quota.identity);
  const entry = existing && existing.resetAt > now
    ? existing
    : { count: 0, resetAt: getNextUtcMidnight(now) };
  entry.count += 1;
  hostedUsage.set(quota.identity, entry);

  return {
    ...quota,
    allowed: entry.count <= quota.limit,
    remaining: Math.max(quota.limit - entry.count, 0),
    resetAt: entry.resetAt,
  };
}

function publicHostedUsage(quota: HostedQuota): Omit<HostedQuota, 'identity'> | undefined {
  if (quota.mode !== 'hosted-free') return undefined;
  return {
    allowed: quota.allowed,
    mode: quota.mode,
    limit: quota.limit,
    remaining: quota.remaining,
    resetAt: quota.resetAt,
  };
}

function usageHeaders(mode: UsageMode, usage: { limit: number; remaining: number; resetAt: number }): Record<string, string> {
  if (mode === 'byok') {
    return {
      'X-OpenConvo-Mode': 'byok',
    };
  }

  return {
    'X-OpenConvo-Mode': 'hosted-free',
    'X-OpenConvo-Hosted-Limit': String(usage.limit),
    'X-OpenConvo-Hosted-Remaining': String(usage.remaining),
    'X-OpenConvo-Hosted-Reset': String(usage.resetAt),
  };
}

function getHostedFreeDailyLimit(): number {
  const value = Number(process.env.OPENCONVO_HOSTED_FREE_DAILY_LIMIT || 20);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 20;
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

function pruneHostedUsage(now: number): void {
  for (const [identity, usage] of hostedUsage.entries()) {
    if (usage.resetAt <= now) {
      hostedUsage.delete(identity);
    }
  }
}

function validateChatBody(body: unknown): {
  messages: ChatMessage[];
  model: string;
  systemPrompt?: string;
  searchResults?: SearchResult[];
  attachments?: Attachment[];
  researchMode?: boolean;
  agentMode?: boolean;
  taskType?: TaskType;
  generateTitleFor?: boolean;
  availableModels: string[];
} {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid request body');
  }

  const candidate = body as Record<string, unknown>;
  if (!Array.isArray(candidate.messages)) {
    throw new Error('Messages are required');
  }

  const messages = candidate.messages.slice(0, MAX_MESSAGES).map((message) => {
    if (!message || typeof message !== 'object') {
      throw new Error('Invalid message');
    }
    const msg = message as Record<string, unknown>;
    if (!['user', 'assistant', 'system'].includes(String(msg.role)) || typeof msg.content !== 'string') {
      throw new Error('Invalid message');
    }
    return {
      role: msg.role as ChatMessage['role'],
      content: msg.content.slice(0, MAX_MESSAGE_CHARS),
    };
  });

  const model = typeof candidate.model === 'string' && candidate.model.trim()
    ? candidate.model.trim()
    : FALLBACK_CHAIN[0];
  const safeModel = isFreeModelId(model) ? model : FALLBACK_CHAIN[0];

  return {
    messages,
    model: safeModel,
    systemPrompt: typeof candidate.systemPrompt === 'string'
      ? candidate.systemPrompt.slice(0, 10000)
      : undefined,
    searchResults: normalizeSearchResults(candidate.searchResults),
    attachments: normalizeAttachments(candidate.attachments),
    researchMode: candidate.researchMode === true,
    agentMode: candidate.agentMode === true,
    taskType: normalizeTaskType(candidate.taskType),
    generateTitleFor: candidate.generateTitleFor === true,
    availableModels: normalizeAvailableModels(candidate.availableModels),
  };
}

function normalizeAvailableModels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(isFreeModelId)
    .slice(0, 40);
}

function uniqueFreeModels(models: string[]): string[] {
  return Array.from(new Set(models.filter(isFreeModelId)));
}

function normalizeSearchResults(value: unknown): SearchResult[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, MAX_CONTEXT_ITEMS).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const result = item as Record<string, unknown>;
    if (typeof result.title !== 'string' || typeof result.url !== 'string') return [];
    return [{
      title: result.title.slice(0, 200),
      url: result.url.slice(0, 1000),
      snippet: typeof result.snippet === 'string' ? result.snippet.slice(0, 1000) : '',
      content: typeof result.content === 'string' ? result.content.slice(0, 5000) : undefined,
      extracted: typeof result.extracted === 'boolean' ? result.extracted : undefined,
      fetchedAt: typeof result.fetchedAt === 'number' ? result.fetchedAt : undefined,
      sourceScore: typeof result.sourceScore === 'number' ? Math.max(0, Math.min(100, Math.floor(result.sourceScore))) : undefined,
      sourceLabel: typeof result.sourceLabel === 'string' ? result.sourceLabel.slice(0, 40) : undefined,
      sourceReason: typeof result.sourceReason === 'string' ? result.sourceReason.slice(0, 200) : undefined,
    }];
  });
}

function normalizeAttachments(value: unknown): Attachment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, MAX_CONTEXT_ITEMS).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const attachment = item as Record<string, unknown>;
    if (
      typeof attachment.id !== 'string' ||
      typeof attachment.name !== 'string' ||
      typeof attachment.type !== 'string' ||
      typeof attachment.size !== 'number' ||
      typeof attachment.content !== 'string'
    ) {
      return [];
    }
    return [{
      id: attachment.id,
      name: attachment.name.slice(0, 255),
      type: attachment.type.slice(0, 100),
      size: attachment.size,
      content: attachment.content.slice(0, 50000),
    }];
  });
}
