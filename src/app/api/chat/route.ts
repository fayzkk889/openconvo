import { NextRequest } from 'next/server';
import { streamChat, generateTitle, ChatMessage, OpenRouterError, formatOpenRouterError, getLiveFreeModelIds } from '@/lib/openrouter';
import { FALLBACK_CHAIN, isFreeModelId, getModelById, selectCandidateModels } from '@/lib/models';
import { buildSystemPrompt } from '@/lib/prompts';
import { SearchResult } from '@/types/search';
import { Attachment, TaskType, StreamingChatEvent, TokenUsage, WebSearchPolicy } from '@/types/chat';
import { DocumentExcerpt } from '@/types/document';
import { normalizeTaskType } from '@/lib/tasks';
import { buildResearchFallbackAnswer } from '@/lib/research-fallback';
import { buildSourcesAppendixIfMissing } from '@/lib/research-citations';
import { buildDocumentAppendixIfMissing } from '@/lib/document-citations';
import { selectBoundedContext } from '@/lib/context-usage';
import { SseChunkParser, parseOpenRouterPayload, ToolCallAccumulator } from '@/lib/sse-parser';
import { ToolSession, webTools } from '@/lib/web-tools';
import { getUsageIdentity } from '@/lib/request-identity';
import { hostedOpenRouterKey } from '@/lib/hosted-mode';
import { reserveQuota, releaseQuota, quotaRefusalMessage, QuotaReservation } from '@/lib/hosted-quota';

export const maxDuration = 60;

const MAX_MESSAGES = 100;
const MAX_MESSAGE_CHARS = 50000;
const MAX_CONTEXT_ITEMS = 10;
const MAX_SEARCH_CONTENT_CHARS = 2500;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 30 * 1000;

// Bounded deadlines and timeouts (Step 4)
const REQUEST_ABSOLUTE_DEADLINE_MS = 52 * 1000;
const MAX_MODEL_ATTEMPTS = 3;
const ATTEMPT_CONNECT_TIMEOUT_MS = 10 * 1000;
const CHAT_STREAM_IDLE_TIMEOUT_MS = 15 * 1000;
// A tool round is offered only while enough time is left to search and answer.
const TOOL_ROUND_MIN_REMAINING_MS = 18 * 1000;
const MAX_TOOL_CALLS_PER_ROUND = 3;

const modelCooldowns = new Map<string, number>();
type UsageMode = 'byok' | 'hosted-free';
type HostedQuota = {
  allowed: boolean;
  mode: UsageMode;
  limit: number;
  remaining: number;
  resetAt: number;
  identity?: string;
  reservation?: QuotaReservation;
};

export async function POST(request: NextRequest) {
  let reservedQuota: HostedQuota | null = null;
  let quotaFinalized = false;

  try {
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > 2 * 1024 * 1024) {
      return Response.json({ error: 'Request body exceeds 2MB limit' }, { status: 413 });
    }

    const rawBody = await request.text();
    if (rawBody.length > 2 * 1024 * 1024) {
      return Response.json({ error: 'Request body exceeds 2MB limit' }, { status: 413 });
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody);
    } catch {
      return Response.json({ error: 'Invalid JSON request body' }, { status: 400 });
    }

    const key = getClientOpenRouterKey(request);
    const body = validateChatBody(parsedJson);
    const {
      rawMessages,
      model,
      systemPrompt,
      searchResults,
      attachments,
      documentExcerpts,
      researchMode,
      agentMode,
      taskType,
      generateTitleFor,
      availableModels,
      webSearch,
    } = body;

    if (!hasOpenRouterKey(key)) {
      return Response.json(
        {
          error: 'This deployment uses your own OpenRouter key. Add a free key in Settings to start chatting.',
          rateLimitedModels: [],
        },
        { status: 401 }
      );
    }

    const hostedQuota = await reserveHostedQuota(request, key);
    reservedQuota = hostedQuota;

    if (!hostedQuota.allowed) {
      reservedQuota = null;
      return Response.json(
        {
          error: hostedQuota.reservation
            ? quotaRefusalMessage(hostedQuota.reservation, 'chat')
            : 'Hosted free mode daily limit reached. Add your own OpenRouter key in Settings.',
          rateLimitedModels: [],
          hostedUsage: publicHostedUsage(hostedQuota),
        },
        {
          status: hostedQuota.reservation?.reason === 'store-unavailable' ? 503 : 429,
          headers: usageHeaders('hosted-free', hostedQuota),
        }
      );
    }

    // Title generation (non-streaming)
    if (generateTitleFor) {
      try {
        const messages = selectBoundedContext(rawMessages, MAX_MESSAGES, MAX_MESSAGE_CHARS);
        const title = await generateTitle(messages, key, model);
        const usage = commitHostedQuota(hostedQuota);
        quotaFinalized = true;
        return Response.json(
          { title, hostedUsage: publicHostedUsage(usage) },
          { headers: usageHeaders(usage.mode, usage) }
        );
      } catch (err) {
        if (!quotaFinalized && reservedQuota) {
          releaseHostedQuota(reservedQuota);
          quotaFinalized = true;
        }
        throw err;
      }
    }

    // Try the selected model, then fallback chain (bounded to free models only)
    const modelsToTry = selectCandidateModels(
      [model, ...availableModels, ...FALLBACK_CHAIN],
      await getLiveFreeModelIds()
    );

    const requestId = 'req_' + Math.random().toString(36).slice(2, 10);
    const encoder = new TextEncoder();
    const overallDeadline = Date.now() + REQUEST_ABSOLUTE_DEADLINE_MS;
    const isHosted = hostedQuota.mode === 'hosted-free';
    const deep = taskType === 'deep-research';
    // Each tool round is one more OpenRouter request, so hosted visitors (who
    // share one key) get a single search round.
    const maxToolRounds = webSearch === 'off' ? 0 : isHosted ? 1 : deep ? 4 : 3;

    const stream = new ReadableStream({
      async start(controller) {
        let quotaCommitted = false;
        const commitQuotaOnce = () => {
          if (!quotaCommitted) {
            quotaCommitted = true;
            quotaFinalized = true;
            commitHostedQuota(hostedQuota);
          }
        };

        const releaseQuotaIfUncommitted = () => {
          if (!quotaCommitted && !quotaFinalized) {
            quotaFinalized = true;
            releaseHostedQuota(hostedQuota);
          }
        };

        try {
          const emitEvent = (event: StreamingChatEvent) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {
            // Controller might be closed
          }
        };

        const tools = new ToolSession({
          clientTavilyKey: getClientTavilyKey(request),
          signal: request.signal,
          maxSearches: isHosted ? 2 : deep ? 8 : 4,
          maxPageReads: isHosted ? 1 : deep ? 5 : 3,
          beforeSearch: isHosted ? () => reserveHostedSearch(hostedQuota) : undefined,
          onActivity: (activity) => emitEvent(
            activity.name === 'web_search'
              ? { type: 'tool', name: 'web_search', status: activity.status, query: activity.query, kind: activity.kind, resultCount: activity.resultCount }
              : { type: 'tool', name: 'read_page', status: activity.status, url: activity.url }
          ),
        });
        const emitSources = () => emitEvent({
          type: 'sources',
          sources: tools.sources.map((source) => ({
            ...source,
            snippet: source.snippet.slice(0, 500),
            content: source.content?.slice(0, 1500),
          })),
          queries: [...tools.queries],
          providers: Array.from(tools.providers),
        });
        // Tool calls and their results, carried over if a model fails mid-way so
        // the next model continues from the same evidence.
        const toolTranscript: ChatMessage[] = [];
        let toolRoundsUsed = 0;
        let metaSent = false;
        let emittedContent = '';

        let lastError: Error | null = null;
        let usedModel = model;
        const failedModels: string[] = [];
        const rateLimitedModels: string[] = [];
        const providerRateLimits = new Map<string, number>();
        let retryAfterSeconds: number | undefined;
        let attemptsCount = 0;

        for (let i = 0; i < modelsToTry.length; i++) {
          const tryModel = modelsToTry[i];

          // Check overall request deadline budget
          const remainingDeadlineMs = overallDeadline - Date.now();
          if (remainingDeadlineMs <= 5000) {
            lastError = new Error('Overall request time limit reached before connecting to a responsive model');
            break;
          }

          // Enforce maximum candidate attempts
          if (attemptsCount >= MAX_MODEL_ATTEMPTS) {
            break;
          }

          if (isModelCoolingDown(tryModel)) {
            continue;
          }

          attemptsCount++;
          usedModel = tryModel;

          // Step 7: Context budgeting for this candidate model's context window
          const candidateModelMeta = getModelById(tryModel);
          const candidateContextLimit = candidateModelMeta?.contextLength || 32768;
          const candidateMessages = selectBoundedContext(
            rawMessages,
            MAX_MESSAGES,
            MAX_MESSAGE_CHARS,
            candidateContextLimit
          );
          let toolsSupported = true;

          try {
            // One model attempt: rounds of (stream → run any tool calls) until
            // the model answers without calling a tool.
            while (true) {
              const offerTools =
                toolsSupported &&
                toolRoundsUsed < maxToolRounds &&
                overallDeadline - Date.now() > TOOL_ROUND_MIN_REMAINING_MS;
              // Without tools, gathered sources go into the system prompt so any
              // model (with or without tool support) can answer from them.
              const evidence = tools.sources.length ? tools.sources : searchResults;
              const fullSystemPrompt = buildSystemPrompt({
                customPrompt: systemPrompt,
                activeModel: tryModel,
                researchMode: researchMode || (!offerTools && tools.sources.length > 0),
                agentMode,
                taskType,
                searchResults: offerTools ? searchResults : evidence,
                attachments,
                documentExcerpts,
                webTools: offerTools ? { policy: webSearch, canReadPages: webTools().length > 1, roundsLeft: maxToolRounds - toolRoundsUsed } : undefined,
                webUnavailable: webSearch !== 'off' && !offerTools && !evidence?.length,
              });
              const roundMessages = offerTools ? [...candidateMessages, ...toolTranscript] : candidateMessages;
              const connectTimeoutMs = Math.min(ATTEMPT_CONNECT_TIMEOUT_MS, Math.max(overallDeadline - Date.now(), 1000));

              let response: Response;
              try {
                response = await streamChat(
                  roundMessages,
                  tryModel,
                  fullSystemPrompt,
                  key,
                  request.signal,
                  connectTimeoutMs,
                  offerTools ? webTools() : undefined
                );
              } catch (error) {
                // Some free endpoints reject tool definitions: retry the same model
                // without tools, answering from whatever evidence exists.
                if (offerTools && isToolUnsupportedError(error)) {
                  toolsSupported = false;
                  continue;
                }
                throw error;
              }

              if (!response.body) {
                throw new Error('No response body from OpenRouter');
              }

              if (!metaSent) {
                metaSent = true;
                emitEvent({
                  type: 'meta',
                  requestId,
                  model: usedModel,
                  mode: hostedQuota.mode,
                });
              }

              const reader = response.body.getReader();
              const decoder = new TextDecoder();
              const sseParser = new SseChunkParser();
              const toolCalls = new ToolCallAccumulator();
              let roundContent = '';
              let finishReason: string | undefined;
              let usage: TokenUsage | undefined;
              let streamSuccess = false;

              const handlePayload = (rawPayload: string) => {
                const parsed = parseOpenRouterPayload(rawPayload);
                if (!parsed) return;
                if (parsed.isDone) {
                  streamSuccess = true;
                  return;
                }
                if (parsed.finishReason) finishReason = parsed.finishReason;
                if (parsed.usage) usage = parsed.usage;
                if (parsed.toolCalls) toolCalls.add(parsed.toolCalls);
                if (parsed.content) {
                  roundContent += parsed.content;
                  emittedContent += parsed.content;
                  emitEvent({ type: 'delta', content: parsed.content, model: usedModel });
                }
              };

              try {
                while (true) {
                  const chunkBudgetMs = Math.min(
                    CHAT_STREAM_IDLE_TIMEOUT_MS,
                    Math.max(overallDeadline - Date.now(), 1000)
                  );
                  const { done, value } = await readStreamChunkWithTimeout(reader, chunkBudgetMs, request.signal);
                  if (done) break;
                  for (const rawPayload of sseParser.feed(decoder.decode(value, { stream: true }))) {
                    handlePayload(rawPayload);
                    if (streamSuccess) break;
                  }
                  if (streamSuccess) break;
                }
                for (const rawPayload of sseParser.flush()) handlePayload(rawPayload);
              } catch (streamError) {
                await reader.cancel().catch(() => undefined);
                // Content already reached the user: never switch models mid-answer.
                if (emittedContent.trim().length > 0) {
                  const errMessage = (streamError as Error).message || 'Stream interrupted';
                  if (emittedContent.trim().length >= 20) commitQuotaOnce();
                  emitEvent({
                    type: 'interrupted',
                    model: usedModel,
                    partialContent: emittedContent,
                    reason: errMessage,
                    finishReason: 'interrupted',
                  });
                  controller.close();
                  return;
                }
                throw streamError;
              } finally {
                try {
                  reader.releaseLock();
                } catch {
                  // Ignore lock release error
                }
              }

              // The model asked for tools: run them and go round again.
              if (offerTools && toolCalls.size > 0) {
                toolRoundsUsed++;
                const calls = toolCalls.toToolCalls().slice(0, MAX_TOOL_CALLS_PER_ROUND);
                toolTranscript.push({ role: 'assistant', content: roundContent || null, tool_calls: calls });
                for (const call of calls) {
                  const result = await tools.execute(call);
                  toolTranscript.push({ role: 'tool', tool_call_id: call.id, content: result });
                }
                if (tools.sources.length) emitSources();
                if (roundContent.trim()) {
                  emittedContent += '\n\n';
                  emitEvent({ type: 'delta', content: '\n\n', model: usedModel });
                }
                continue;
              }

              // Final answer for this request.
              const citedSources = tools.sources.length ? tools.sources : (researchMode ? searchResults : undefined);
              if (emittedContent.trim() && citedSources?.length) {
                const citationTail = buildSourcesAppendixIfMissing(emittedContent, citedSources);
                if (citationTail) {
                  emittedContent += citationTail;
                  emitEvent({ type: 'delta', content: citationTail, model: usedModel });
                }
              }

              if (emittedContent.trim() && documentExcerpts?.length) {
                const docAppendix = buildDocumentAppendixIfMissing(emittedContent, documentExcerpts);
                if (docAppendix) {
                  emittedContent += docAppendix;
                  emitEvent({ type: 'delta', content: docAppendix, model: usedModel });
                }
              }

              if (!emittedContent.trim()) {
                throw new Error('Model returned an empty response');
              }

              // The upstream stream must confirm completion ([DONE] or a known
              // finish_reason); otherwise the answer may be cut short.
              const isConfirmedTerminal = streamSuccess || (Boolean(finishReason) && finishReason !== 'unknown');
              if (!isConfirmedTerminal) {
                if (emittedContent.trim().length >= 20) commitQuotaOnce();
                emitEvent({
                  type: 'interrupted',
                  model: usedModel,
                  partialContent: emittedContent,
                  reason: 'Upstream stream closed unexpectedly without terminal completion confirmation',
                  finishReason: 'stream_closed',
                });
                controller.close();
                return;
              }

              commitQuotaOnce();
              emitEvent({
                type: 'complete',
                model: usedModel,
                finishReason: finishReason || 'stop',
                usage,
              });
              controller.close();
              return;
            }
          } catch (modelError) {
            lastError = modelError as Error;
            // A client disconnect is not a model failure: stop instead of spending
            // further upstream requests on fallback candidates nobody will read.
            if (request.signal.aborted) break;
            failedModels.push(tryModel);

            if (modelError instanceof OpenRouterError && modelError.status === 429) {
              rateLimitedModels.push(tryModel);
              retryAfterSeconds = modelError.retryAfterSeconds || retryAfterSeconds;
              rememberModelCooldown(tryModel, modelError);
              if (modelError.providerName) {
                const hits = (providerRateLimits.get(modelError.providerName) || 0) + 1;
                providerRateLimits.set(modelError.providerName, hits);
                if (hits >= 2) break; // Don't pound the same provider
              }
            } else if (modelError instanceof OpenRouterError && isOpenRouterAuthError(modelError)) {
              break; // Auth error won't be resolved by fallback
            }

            // If another candidate exists within deadline and attempt budget, notify client of fallback
            const nextCandidate = modelsToTry
              .slice(i + 1)
              .find((m) => !isModelCoolingDown(m));
            if (nextCandidate && attemptsCount < MAX_MODEL_ATTEMPTS && overallDeadline - Date.now() > 5000) {
              const sanitizedReason = modelError instanceof OpenRouterError
                ? formatOpenRouterError(modelError, tryModel)
                : ((modelError as Error)?.message || 'Provider failed');
              emitEvent({
                type: 'fallback',
                fromModel: tryModel,
                toModel: nextCandidate,
                reason: sanitizedReason,
                rateLimitedModels,
                retryAfterSeconds,
              });
            }
          }
        }

        // All attempts failed
        const cleanLastErrorMsg = lastError instanceof OpenRouterError
          ? formatOpenRouterError(lastError)
          : (lastError?.message || 'Inference failed across candidate models');

        const fallbackSources = tools.sources.length ? tools.sources : (researchMode ? searchResults : undefined);
        if (fallbackSources?.length && !request.signal.aborted) {
          commitQuotaOnce();
          const fallbackAnswer = buildResearchFallbackAnswer({
            question: lastUserQuestion(rawMessages),
            sources: fallbackSources,
            reason: cleanLastErrorMsg || 'the selected free model did not stream a response in time',
          });
          emitEvent({
            type: 'research_fallback',
            content: fallbackAnswer,
            model: usedModel,
            reason: cleanLastErrorMsg || 'the selected free model did not stream a response in time',
          });
        } else {
          emitEvent({
            type: 'error',
            error: formatChatFailure(lastError, failedModels, []),
            model: usedModel,
            failedModels,
            rateLimitedModels,
            retryAfterSeconds,
          });
        }

        controller.close();
        } finally {
          releaseQuotaIfUncommitted();
        }
      },
      cancel() {
        if (!quotaFinalized) {
          quotaFinalized = true;
          releaseHostedQuota(hostedQuota);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Model-Used': model,
        ...usageHeaders(hostedQuota.mode, hostedQuota),
      },
    });
  } catch (error) {
    if (reservedQuota && !quotaFinalized) {
      releaseHostedQuota(reservedQuota);
      quotaFinalized = true;
    }
    console.error('Chat API error:', error);
    const rawMsg = error instanceof Error ? error.message : 'Internal server error';
    const cleanMessage = error instanceof OpenRouterError
      ? formatOpenRouterError(error)
      : (isValidationError(rawMsg) ? rawMsg : 'Internal server error');
    const status = isValidationError(rawMsg) ? 400 : (error instanceof OpenRouterError ? error.status : 500);
    return Response.json({ error: cleanMessage }, { status });
  }
}

async function readStreamChunkWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
  abortSignal?: AbortSignal
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  try {
    return await Promise.race([
      reader.read(),
      new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Chat stream timed out waiting for model output')),
          timeoutMs
        );
        if (abortSignal) {
          onAbort = () => reject(new Error('User cancelled request'));
          abortSignal.addEventListener('abort', onAbort, { once: true });
        }
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (abortSignal && onAbort) {
      abortSignal.removeEventListener('abort', onAbort);
    }
  }
}

function lastUserQuestion(messages: unknown[]): string {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const item = messages[i] as Record<string, unknown> | null;
    if (item && item.role === 'user' && typeof item.content === 'string') {
      return item.content;
    }
  }
  return '';
}

function formatChatFailure(error: Error | null, failedModels: string[], skippedModels: string[]): string {
  const attemptedText =
    failedModels.length > 1
      ? ` OpenConvo tried ${failedModels.length} free models before giving up.`
      : '';
  const skippedText =
    skippedModels.length > 0
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
  return Boolean(clientKey || hostedOpenRouterKey());
}

function isOpenRouterAuthError(error: OpenRouterError): boolean {
  return error.status === 401 || error.status === 403;
}

function getClientTavilyKey(request: NextRequest): string | null {
  const key = request.headers.get('x-tavily-key')?.trim();
  return key || null;
}

/** OpenRouter answers 404 "No endpoints found that support tool use" (or a 400) for such models. */
function isToolUnsupportedError(error: unknown): boolean {
  if (!(error instanceof OpenRouterError)) return false;
  if (![400, 404, 422].includes(error.status)) return false;
  return /tool/i.test(`${error.providerMessage || ''} ${error.body || ''}`);
}

/** In hosted mode each web search spends one slot of the visitor's search quota. */
async function reserveHostedSearch(quota: HostedQuota): Promise<{ allowed: boolean; message?: string }> {
  if (quota.mode !== 'hosted-free' || !quota.identity) return { allowed: true };
  const reservation = await reserveQuota('search', quota.identity, {
    perIdentity: positiveIntEnv('OPENCONVO_HOSTED_SEARCH_DAILY_LIMIT', 15),
    global: positiveIntEnv('OPENCONVO_HOSTED_SEARCH_GLOBAL_DAILY_LIMIT', 20),
  });
  return reservation.allowed
    ? { allowed: true }
    : { allowed: false, message: quotaRefusalMessage(reservation, 'search') };
}

function positiveIntEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function getClientOpenRouterKey(request: NextRequest): string | null {
  const key = request.headers.get('x-openrouter-key')?.trim();
  return key || null;
}

async function reserveHostedQuota(request: NextRequest, clientKey: string | null): Promise<HostedQuota> {
  if (clientKey) {
    return {
      allowed: true,
      mode: 'byok',
      limit: 0,
      remaining: 0,
      resetAt: 0,
    };
  }

  const identity = getUsageIdentity(request.headers);
  const reservation = await reserveQuota('chat', identity, {
    perIdentity: getHostedFreeDailyLimit(),
    global: getHostedFreeGlobalDailyLimit(),
  });
  return {
    allowed: reservation.allowed,
    mode: 'hosted-free',
    limit: reservation.limit,
    remaining: reservation.remaining,
    resetAt: reservation.resetAt,
    identity,
    reservation,
  };
}

/** Refund the visitor's slot for a request that produced nothing. */
function releaseHostedQuota(quota: HostedQuota): void {
  if (quota.mode === 'byok' || !quota.reservation) return;
  void releaseQuota(quota.reservation);
}

/** Reservations count when made; committing only reports the current usage. */
function commitHostedQuota(quota: HostedQuota): HostedQuota {
  return quota;
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

function usageHeaders(
  mode: UsageMode,
  usage: { limit: number; remaining: number; resetAt: number }
): Record<string, string> {
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

/**
 * Deployment-wide cap for all keyless visitors together. OpenRouter free keys
 * allow about 50 requests a day (failed ones included), and hosted research
 * planning spends from the same key, so the default leaves headroom.
 */
function getHostedFreeGlobalDailyLimit(): number {
  const value = Number(process.env.OPENCONVO_HOSTED_FREE_GLOBAL_DAILY_LIMIT || 30);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 30;
}

function validateChatBody(body: unknown): {
  rawMessages: unknown[];
  model: string;
  systemPrompt?: string;
  searchResults?: SearchResult[];
  attachments?: Attachment[];
  documentExcerpts?: DocumentExcerpt[];
  researchMode?: boolean;
  agentMode?: boolean;
  taskType?: TaskType;
  generateTitleFor?: boolean;
  availableModels: string[];
  webSearch: WebSearchPolicy;
} {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid request body');
  }

  const candidate = body as Record<string, unknown>;
  if (!Array.isArray(candidate.messages)) {
    throw new Error('Messages are required');
  }

  const model =
    typeof candidate.model === 'string' && candidate.model.trim()
      ? candidate.model.trim()
      : FALLBACK_CHAIN[0];
  const safeModel = isFreeModelId(model) ? model : FALLBACK_CHAIN[0];

  return {
    rawMessages: candidate.messages,
    model: safeModel,
    systemPrompt:
      typeof candidate.systemPrompt === 'string'
        ? candidate.systemPrompt.slice(0, 10000)
        : undefined,
    searchResults: normalizeSearchResults(candidate.searchResults),
    attachments: normalizeAttachments(candidate.attachments),
    documentExcerpts: normalizeDocumentExcerpts(candidate.documentExcerpts),
    researchMode: candidate.researchMode === true,
    agentMode: candidate.agentMode === true,
    taskType: normalizeTaskType(candidate.taskType),
    generateTitleFor: candidate.generateTitleFor === true,
    availableModels: normalizeAvailableModels(candidate.availableModels),
    webSearch: candidate.webSearch === 'off' || candidate.webSearch === 'required' ? candidate.webSearch : 'auto',
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

function normalizeSearchResults(value: unknown): SearchResult[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, MAX_CONTEXT_ITEMS).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const result = item as Record<string, unknown>;
    if (typeof result.title !== 'string' || typeof result.url !== 'string') return [];
    return [
      {
        title: result.title.slice(0, 200),
        url: result.url.slice(0, 1000),
        snippet: typeof result.snippet === 'string' ? result.snippet.slice(0, 1000) : '',
        content:
          typeof result.content === 'string'
            ? result.content.slice(0, MAX_SEARCH_CONTENT_CHARS)
            : undefined,
        extracted: typeof result.extracted === 'boolean' ? result.extracted : undefined,
        fetchedAt: typeof result.fetchedAt === 'number' ? result.fetchedAt : undefined,
        sourceScore:
          typeof result.sourceScore === 'number'
            ? Math.max(0, Math.min(100, Math.floor(result.sourceScore)))
            : undefined,
        sourceLabel: typeof result.sourceLabel === 'string' ? result.sourceLabel.slice(0, 40) : undefined,
        sourceReason:
          typeof result.sourceReason === 'string' ? result.sourceReason.slice(0, 200) : undefined,
      },
    ];
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
    return [
      {
        id: attachment.id,
        name: attachment.name.slice(0, 255),
        type: attachment.type.slice(0, 100),
        size: attachment.size,
        content: attachment.content.slice(0, 50000),
      },
    ];
  });
}

function normalizeDocumentExcerpts(value: unknown): DocumentExcerpt[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const excerpts = value.slice(0, 15).flatMap((item): DocumentExcerpt[] => {
    if (!item || typeof item !== 'object') return [];
    const exc = item as Record<string, unknown>;
    if (
      typeof exc.chunkId !== 'string' ||
      typeof exc.documentId !== 'string' ||
      typeof exc.docIndex !== 'number' ||
      typeof exc.filename !== 'string' ||
      typeof exc.citationId !== 'string' ||
      typeof exc.text !== 'string' ||
      typeof exc.score !== 'number'
    ) {
      return [];
    }
    return [
      {
        chunkId: exc.chunkId.slice(0, 100),
        documentId: exc.documentId.slice(0, 100),
        docIndex: Math.max(1, Math.floor(exc.docIndex)),
        filename: exc.filename.slice(0, 255),
        citationId: exc.citationId.slice(0, 50),
        text: exc.text.slice(0, 8000),
        score: exc.score,
        pageNumber: typeof exc.pageNumber === 'number' ? Math.max(1, Math.floor(exc.pageNumber)) : undefined,
        startLine: typeof exc.startLine === 'number' ? Math.max(1, Math.floor(exc.startLine)) : undefined,
        endLine: typeof exc.endLine === 'number' ? Math.max(1, Math.floor(exc.endLine)) : undefined,
        sectionHeading: typeof exc.sectionHeading === 'string' ? exc.sectionHeading.slice(0, 200) : undefined,
      },
    ];
  });
  return excerpts.length > 0 ? excerpts : undefined;
}
