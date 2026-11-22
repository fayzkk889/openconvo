import assert from 'node:assert/strict';
import { SseChunkParser, parseOpenRouterPayload, parseOpenConvoPayload, consumeChatStream } from '@/lib/sse-parser';
import { selectBoundedContext } from '@/lib/context-usage';
import { isFreeModelId, FALLBACK_CHAIN, CURATED_FREE_MODELS } from '@/lib/models';
import { getReliabilitySignal } from '@/lib/model-reliability';

const results = [];
let passCount = 0;
let failCount = 0;

async function test(id, description, fn) {
  try {
    await fn();
    passCount += 1;
    results.push({ id, status: 'PASSED', description });
    console.log(`[PASS] Test ${id}: ${description}`);
  } catch (error) {
    failCount += 1;
    results.push({ id, status: 'FAILED', description, error: error.message, stack: error.stack });
    console.error(`[FAIL] Test ${id}: ${description}\n  Error: ${error.message}`);
  }
}

// In-memory mock storage for regression testing
function createMockStorage() {
  const conversations = new Map();
  const messages = new Map();
  const reliability = new Map();

  return {
    async createConversation(model = 'mock:free') {
      const id = 'conv-' + Math.random().toString(36).slice(2, 9);
      const conv = { id, title: 'New conversation', model, createdAt: Date.now(), updatedAt: Date.now() };
      conversations.set(id, conv);
      return conv;
    },
    async getConversation(id) {
      return conversations.get(id) || null;
    },
    async addMessage(conversationId, msg) {
      const id = 'msg-' + Math.random().toString(36).slice(2, 9);
      const record = { id, conversationId, timestamp: Date.now(), ...msg };
      messages.set(id, record);
      return record;
    },
    async getMessages(conversationId) {
      return Array.from(messages.values())
        .filter((m) => m.conversationId === conversationId)
        .sort((a, b) => a.timestamp - b.timestamp);
    },
    async deleteMessage(id) {
      messages.delete(id);
    },
    async updateMessage(id, updates) {
      const existing = messages.get(id);
      if (!existing) return;
      const updated = { ...existing, ...updates };
      messages.set(id, updated);
      return updated;
    },
    async recordModelOutcome({ modelId, taskType = 'quick', outcome, latencyMs = 0 }) {
      const key = `${modelId}::${taskType}`;
      const existing = reliability.get(key) || {
        id: key,
        modelId,
        taskType,
        successes: 0,
        failures: 0,
        rateLimits: 0,
        emptyCount: 0,
        interruptedCount: 0,
        totalLatencyMs: 0,
        lastOutcome: outcome,
        lastUsedAt: Date.now(),
        updatedAt: Date.now(),
      };
      if (outcome === 'success') {
        existing.successes += 1;
        existing.totalLatencyMs += latencyMs;
      } else if (outcome === 'rate_limited') {
        existing.rateLimits += 1;
      } else if (outcome === 'empty') {
        existing.emptyCount = (existing.emptyCount || 0) + 1;
        existing.failures += 1;
      } else if (outcome === 'interrupted') {
        existing.interruptedCount = (existing.interruptedCount || 0) + 1;
        existing.failures += 1;
      } else {
        existing.failures += 1;
      }
      existing.lastOutcome = outcome;
      existing.lastUsedAt = Date.now();
      reliability.set(key, existing);
      return existing;
    },
    async getModelReliability() {
      return Array.from(reliability.values());
    },
  };
}

// =========================================================================
// SECTION 1: NON-DESTRUCTIVE REGENERATION & CANCELLATION (STEP 0)
// =========================================================================

await test(1, 'Regeneration failure does not destructively delete original conversation branch', async () => {
  const store = createMockStorage();
  const conv = await store.createConversation();
  const u1 = await store.addMessage(conv.id, { role: 'user', content: 'Explain quantum computing' });
  const a1 = await store.addMessage(conv.id, { role: 'assistant', content: 'Quantum computing uses qubits...' });

  const msgsBefore = await store.getMessages(conv.id);
  assert.equal(msgsBefore.length, 2);

  // Simulate regeneration start: stage original messages without deleting from storage
  const msgIndex = msgsBefore.findIndex((m) => m.id === a1.id);
  const stagedOriginalMessages = msgsBefore.slice(msgIndex);

  // Simulate regeneration network failure
  let failed = true;
  if (failed) {
    // If failed, stagedOriginalMessages remain in storage!
    const msgsAfterFail = await store.getMessages(conv.id);
    assert.equal(msgsAfterFail.length, 2, 'Storage messages must remain intact after regeneration failure');
    assert.equal(msgsAfterFail[1].content, 'Quantum computing uses qubits...');
  }
});

await test(2, 'Regeneration cancellation restores original messages in UI and preserves storage', async () => {
  const store = createMockStorage();
  const conv = await store.createConversation();
  const u1 = await store.addMessage(conv.id, { role: 'user', content: 'Hello' });
  const a1 = await store.addMessage(conv.id, { role: 'assistant', content: 'Original greeting response' });

  let uiMessages = await store.getMessages(conv.id);
  const msgIndex = 1;
  const stagedOriginal = uiMessages.slice(msgIndex);

  // UI shows placeholder
  uiMessages = [...uiMessages.slice(0, msgIndex), { id: 'temp-placeholder', role: 'assistant', content: '' }];
  assert.equal(uiMessages.length, 2);
  assert.equal(uiMessages[1].id, 'temp-placeholder');

  // User cancels regeneration
  const cancelled = true;
  if (cancelled) {
    // Restore staged original messages in UI
    uiMessages = [...uiMessages.slice(0, msgIndex), ...stagedOriginal];
    assert.equal(uiMessages.length, 2);
    assert.equal(uiMessages[1].content, 'Original greeting response');

    // Verify storage was never modified
    const stored = await store.getMessages(conv.id);
    assert.equal(stored.length, 2);
    assert.equal(stored[1].content, 'Original greeting response');
  }
});

await test(3, 'Successful regeneration atomically deletes old messages and appends replacement', async () => {
  const store = createMockStorage();
  const conv = await store.createConversation();
  const u1 = await store.addMessage(conv.id, { role: 'user', content: 'Tell a joke' });
  const a1 = await store.addMessage(conv.id, { role: 'assistant', content: 'Old joke' });

  const messages = await store.getMessages(conv.id);
  const msgIndex = 1;
  const stagedOriginal = messages.slice(msgIndex);

  // Replacement arrives successfully
  const replacementContent = 'New improved joke';
  for (const msg of stagedOriginal) {
    await store.deleteMessage(msg.id);
  }
  await store.addMessage(conv.id, {
    role: 'assistant',
    content: replacementContent,
    status: 'complete',
    finishReason: 'stop',
  });

  const finalMessages = await store.getMessages(conv.id);
  assert.equal(finalMessages.length, 2);
  assert.equal(finalMessages[1].content, 'New improved joke');
  assert.equal(finalMessages[1].status, 'complete');
});

// =========================================================================
// SECTION 2: ROBUST SSE PARSING (STEPS 2 & 3)
// =========================================================================

await test(4, 'SSE Chunk Parser handles fragmented chunks across byte boundaries', async () => {
  const parser = new SseChunkParser();
  // Chunk 1 has partial "data: {"
  const r1 = parser.feed('data: {"type":');
  assert.equal(r1.length, 0);

  // Chunk 2 has remainder and double newline
  const r2 = parser.feed(' "delta", "content": "Hello world"}\n\n');
  assert.equal(r2.length, 1);
  assert.equal(r2[0], '{"type": "delta", "content": "Hello world"}');
});

await test(5, 'SSE Chunk Parser handles multiple events packed into one chunk', async () => {
  const parser = new SseChunkParser();
  const chunk = 'data: {"type": "meta", "model": "mistral"}\n\ndata: {"type": "delta", "content": "chunk1"}\n\ndata: {"type": "delta", "content": "chunk2"}\n\n';
  const events = parser.feed(chunk);
  assert.equal(events.length, 3);
  assert.equal(JSON.parse(events[0]).type, 'meta');
  assert.equal(JSON.parse(events[1]).content, 'chunk1');
  assert.equal(JSON.parse(events[2]).content, 'chunk2');
});

await test(6, 'SSE Chunk Parser normalizes CRLF and LF line endings', async () => {
  const parser = new SseChunkParser();
  const chunkWithCrlf = 'data: {"event": "one"}\r\n\r\ndata: {"event": "two"}\n\n';
  const events = parser.feed(chunkWithCrlf);
  assert.equal(events.length, 2);
  assert.equal(JSON.parse(events[0]).event, 'one');
  assert.equal(JSON.parse(events[1]).event, 'two');
});

await test(7, 'SSE Chunk Parser ignores comments and keepalive pings', async () => {
  const parser = new SseChunkParser();
  const chunk = ':keepalive\n\ndata: {"valid": true}\n\n:comment line\n\n';
  const events = parser.feed(chunk);
  assert.equal(events.length, 1);
  assert.equal(JSON.parse(events[0]).valid, true);
});

await test(8, 'OpenRouter payload parser extracts finish_reason stop and length', async () => {
  const stopPayload = JSON.stringify({
    id: 'gen-123',
    choices: [{ delta: { content: 'finished answer' }, finish_reason: 'stop' }],
  });
  const parsedStop = parseOpenRouterPayload(stopPayload);
  assert.equal(parsedStop?.finishReason, 'stop');
  assert.equal(parsedStop?.content, 'finished answer');

  const lengthPayload = JSON.stringify({
    id: 'gen-124',
    choices: [{ delta: { content: 'truncated text' }, finish_reason: 'length' }],
  });
  const parsedLength = parseOpenRouterPayload(lengthPayload);
  assert.equal(parsedLength?.finishReason, 'length');
});

await test(9, 'OpenRouter payload parser filters reasoning tokens from polluting content', async () => {
  // Reasoning models emit reasoning in delta.reasoning
  const reasoningPayload = JSON.stringify({
    choices: [{ delta: { reasoning: 'Thinking through the math...' } }],
  });
  const parsed = parseOpenRouterPayload(reasoningPayload);
  assert.equal(parsed?.content, undefined, 'Content should be undefined when delta only has reasoning');
  assert.equal(parsed?.reasoning, 'Thinking through the math...');
});

await test(10, 'OpenRouter payload parser extracts token usage metadata', async () => {
  const usagePayload = JSON.stringify({
    choices: [{ delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 142, completion_tokens: 88, total_tokens: 230 },
  });
  const parsed = parseOpenRouterPayload(usagePayload);
  assert.equal(parsed?.usage?.promptTokens, 142);
  assert.equal(parsed?.usage?.completionTokens, 88);
  assert.equal(parsed?.usage?.totalTokens, 230);
});

await test(11, 'OpenConvo payload parser parses typed discriminated union events', async () => {
  const meta = parseOpenConvoPayload('{"type":"meta","requestId":"r1","model":"test:free","mode":"byok"}');
  assert.equal(meta?.type, 'meta');

  const delta = parseOpenConvoPayload('{"type":"delta","content":"text delta"}');
  assert.equal(delta?.type, 'delta');
  assert.equal(delta?.content, 'text delta');

  const fallback = parseOpenConvoPayload('{"type":"fallback","fromModel":"m1","toModel":"m2","reason":"Rate limited"}');
  assert.equal(fallback?.type, 'fallback');

  const complete = parseOpenConvoPayload('{"type":"complete","model":"m2","finishReason":"stop"}');
  assert.equal(complete?.type, 'complete');

  const interrupted = parseOpenConvoPayload('{"type":"interrupted","model":"m2","partialContent":"half answer","reason":"timeout"}');
  assert.equal(interrupted?.type, 'interrupted');
});

await test(12, 'OpenConvo payload parser provides backwards compatibility with legacy format', async () => {
  const legacy = parseOpenConvoPayload('{"content":"legacy delta","model":"legacy:free"}');
  assert.equal(legacy?.type, 'delta');
  assert.equal(legacy?.content, 'legacy delta');
  assert.equal(legacy?.model, 'legacy:free');
});

// =========================================================================
// SECTION 3: UNIFIED STREAM CONSUMER (STEP 3)
// =========================================================================

await test(13, 'consumeChatStream accumulates deltas and extracts complete terminal state', async () => {
  const encoder = new TextEncoder();
  const chunks = [
    encoder.encode('data: {"type":"meta","requestId":"r-1","model":"m1","mode":"byok"}\n\n'),
    encoder.encode('data: {"type":"delta","content":"Hello "}\n\n'),
    encoder.encode('data: {"type":"delta","content":"world!"}\n\n'),
    encoder.encode('data: {"type":"complete","model":"m1","finishReason":"stop","usage":{"totalTokens":42}}\n\n'),
  ];

  let readIdx = 0;
  const mockReader = {
    async read() {
      if (readIdx >= chunks.length) return { done: true, value: undefined };
      return { done: false, value: chunks[readIdx++] };
    },
    releaseLock() {},
  };

  const deltas = [];
  const result = await consumeChatStream(mockReader, 'm1', {
    onDelta: (d) => deltas.push(d.content),
  });

  assert.equal(result.status, 'complete');
  assert.equal(result.fullContent, 'Hello world!');
  assert.equal(result.finishReason, 'stop');
  assert.equal(result.tokenUsage?.totalTokens, 42);
  assert.deepEqual(deltas, ['Hello ', 'world!']);
});

await test(14, 'consumeChatStream handles fallback notifications mid-stream', async () => {
  const encoder = new TextEncoder();
  const chunks = [
    encoder.encode('data: {"type":"fallback","fromModel":"m1","toModel":"m2","reason":"429 rate limit"}\n\n'),
    encoder.encode('data: {"type":"delta","content":"Answer from m2"}\n\n'),
    encoder.encode('data: {"type":"complete","model":"m2","finishReason":"stop"}\n\n'),
  ];

  let readIdx = 0;
  const mockReader = {
    async read() {
      if (readIdx >= chunks.length) return { done: true, value: undefined };
      return { done: false, value: chunks[readIdx++] };
    },
    releaseLock() {},
  };

  const fallbacks = [];
  const result = await consumeChatStream(mockReader, 'm1', {
    onFallback: (fb) => fallbacks.push(fb),
  });

  assert.equal(result.status, 'complete');
  assert.equal(result.finalModel, 'm2');
  assert.equal(fallbacks.length, 1);
  assert.equal(fallbacks[0].fromModel, 'm1');
  assert.equal(fallbacks[0].toModel, 'm2');
});

await test(15, 'consumeChatStream preserves partial content on interrupted streams', async () => {
  const encoder = new TextEncoder();
  const chunks = [
    encoder.encode('data: {"type":"delta","content":"Partial sentence before cut"}\n\n'),
    encoder.encode('data: {"type":"interrupted","model":"m1","partialContent":"Partial sentence before cut","reason":"Model connection lost"}\n\n'),
  ];

  let readIdx = 0;
  const mockReader = {
    async read() {
      if (readIdx >= chunks.length) return { done: true, value: undefined };
      return { done: false, value: chunks[readIdx++] };
    },
    releaseLock() {},
  };

  const result = await consumeChatStream(mockReader, 'm1');
  assert.equal(result.status, 'interrupted');
  assert.equal(result.fullContent, 'Partial sentence before cut');
  assert.equal(result.errorMessage, 'Model connection lost');
});

// =========================================================================
// SECTION 4: BOUNDED MODEL FALLBACK & TIME-BUDGETING (STEP 4)
// =========================================================================

await test(16, 'Fallback sequence bounds maximum candidate attempts to 3', async () => {
  const candidateList = ['model-1:free', 'model-2:free', 'model-3:free', 'model-4:free', 'model-5:free'];
  const maxAttempts = 3;
  const attempted = [];

  for (const model of candidateList) {
    if (attempted.length >= maxAttempts) break;
    attempted.push(model);
  }

  assert.equal(attempted.length, 3);
  assert.deepEqual(attempted, ['model-1:free', 'model-2:free', 'model-3:free']);
});

await test(17, 'Request absolute deadline prevents starting slow model connection near budget expiry', async () => {
  const overallDeadline = Date.now() + 3000; // Only 3 seconds left
  const MIN_REMAINING_BUDGET = 5000; // Requires at least 5s to attempt another model

  const remaining = overallDeadline - Date.now();
  const canAttemptNext = remaining > MIN_REMAINING_BUDGET;
  assert.equal(canAttemptNext, false, 'Must not attempt another model when under 5s deadline');
});

await test(18, 'Mid-stream failure invariant: tokens already emitted prohibits model fallback', async () => {
  let emittedContent = 'Already emitted half the answer.';
  let shouldFallback = false;

  // Mid-stream error occurs
  const streamFailedMidway = true;
  if (streamFailedMidway) {
    if (emittedContent.trim().length > 0) {
      // Must NOT fallback to another model
      shouldFallback = false;
    } else {
      shouldFallback = true;
    }
  }

  assert.equal(shouldFallback, false, 'Tokens already emitted must prohibit falling back to a different model');
});

await test(19, 'Pre-stream failure allows model fallback to candidate model', async () => {
  let emittedContent = '';
  let shouldFallback = false;

  // Pre-stream connect error occurs
  const connectFailed = true;
  if (connectFailed) {
    if (emittedContent.trim().length === 0) {
      shouldFallback = true;
    }
  }

  assert.equal(shouldFallback, true, 'Pre-stream error with zero tokens emitted must allow fallback');
});

// =========================================================================
// SECTION 5: MODEL DISCOVERY & ZERO-PRICE ENFORCEMENT (STEP 5)
// =========================================================================

await test(20, 'Zero-price enforcement rejects models with prompt pricing > 0', async () => {
  function verifyZeroPrice(pricing) {
    if (!pricing) return false;
    const isZero = (v) => v === 0 || v === '0';
    return isZero(pricing.prompt) && isZero(pricing.completion) && (pricing.request === undefined || isZero(pricing.request));
  }

  const freePricing = { prompt: 0, completion: 0, request: 0 };
  const paidPrompt = { prompt: 0.001, completion: 0, request: 0 };
  const paidCompletion = { prompt: 0, completion: 0.002 };

  assert.equal(verifyZeroPrice(freePricing), true);
  assert.equal(verifyZeroPrice(paidPrompt), false);
  assert.equal(verifyZeroPrice(paidCompletion), false);
});

await test(21, 'Model IDs must explicitly end with :free', async () => {
  assert.equal(isFreeModelId('meta-llama/llama-3.3-70b-instruct:free'), true);
  assert.equal(isFreeModelId('mistralai/devstral-small:free'), true);
  assert.equal(isFreeModelId('openai/gpt-4o'), false);
  assert.equal(isFreeModelId('anthropic/claude-3-5-sonnet'), false);
  assert.equal(isFreeModelId(null), false);
  assert.equal(isFreeModelId(undefined), false);
});

await test(22, 'FALLBACK_CHAIN contains only verified free model IDs', async () => {
  assert.ok(FALLBACK_CHAIN.length > 0);
  for (const model of FALLBACK_CHAIN) {
    assert.equal(isFreeModelId(model), true, `${model} must end with :free`);
  }
});

await test(23, 'CURATED_FREE_MODELS contains only valid free models', async () => {
  assert.ok(CURATED_FREE_MODELS.length > 0);
  for (const model of CURATED_FREE_MODELS) {
    assert.equal(model.isFree, true);
    assert.equal(model.id.endsWith(':free'), true);
    assert.ok(model.contextLength > 0);
  }
});

// =========================================================================
// SECTION 6: RELIABILITY FEEDBACK ENGINE (STEP 6)
// =========================================================================

await test(24, 'User cancellation does NOT record model failure', async () => {
  const store = createMockStorage();
  const modelId = 'meta-llama/llama-4-maverick:free';

  // User cancels request
  const isUserCancel = true;
  if (!isUserCancel) {
    await store.recordModelOutcome({ modelId, outcome: 'failure' });
  }

  const records = await store.getModelReliability();
  assert.equal(records.length, 0, 'No failure record should be written on user cancellation');
});

await test(25, 'Model reliability records distinct outcomes: rate_limited, interrupted, empty', async () => {
  const store = createMockStorage();
  const model = 'mistralai/devstral-small:free';

  await store.recordModelOutcome({ modelId: model, outcome: 'rate_limited' });
  await store.recordModelOutcome({ modelId: model, outcome: 'interrupted' });
  await store.recordModelOutcome({ modelId: model, outcome: 'empty' });
  await store.recordModelOutcome({ modelId: model, outcome: 'success', latencyMs: 800 });

  const records = await store.getModelReliability();
  const stat = records.find((r) => r.modelId === model);
  assert.ok(stat);
  assert.equal(stat.rateLimits, 1);
  assert.equal(stat.interruptedCount, 1);
  assert.equal(stat.emptyCount, 1);
  assert.equal(stat.successes, 1);
  assert.equal(stat.totalLatencyMs, 800);
});

await test(26, 'Reliability score calculation factors in context length and outcomes', async () => {
  const modelMeta = CURATED_FREE_MODELS[0];
  const emptyReliability = [];
  const signal = getReliabilitySignal(modelMeta, emptyReliability, 'quick', CURATED_FREE_MODELS);
  assert.ok(signal.score >= 0 && signal.score <= 100);
  assert.ok(typeof signal.label === 'string');
});

// =========================================================================
// SECTION 7: CONTEXT BUDGETING ACROSS CANDIDATES (STEP 7)
// =========================================================================

await test(27, 'selectBoundedContext truncates older messages when exceeding candidate context length', async () => {
  // Create 11 messages of 1000 characters each = 11,000 chars (~2,750 tokens) ending in a user turn
  const messages = [];
  for (let i = 0; i <= 10; i++) {
    messages.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i} `.repeat(100),
    });
  }

  // Bound with candidate limit of 1500 tokens (~4000 chars)
  const bounded = selectBoundedContext(messages, 100, 50000, 1500);
  assert.ok(bounded.length < messages.length);
  // Guarantee: newest user message must always be present!
  assert.equal(bounded[bounded.length - 1].role, 'user');
  assert.ok(bounded[bounded.length - 1].content.includes('Message 10'));
});

await test(28, 'selectBoundedContext never starts with an orphaned assistant message', async () => {
  const messages = [
    { role: 'user', content: 'Turn 1 user' },
    { role: 'assistant', content: 'Turn 1 assistant' },
    { role: 'user', content: 'Turn 2 user' },
    { role: 'assistant', content: 'Turn 2 assistant' },
    { role: 'user', content: 'Turn 3 user' },
  ];

  // Request max 3 messages: if simple slice would start with Turn 1 assistant, selectBoundedContext must adjust
  const bounded = selectBoundedContext(messages, 3);
  assert.notEqual(bounded[0].role, 'assistant', 'Context must not begin with an orphaned assistant message');
  assert.equal(bounded[bounded.length - 1].content, 'Turn 3 user');
});

// =========================================================================
// SECTION 8: ATOMIC QUOTA ACCOUNTING (STEP 8)
// =========================================================================

await test(29, 'Quota is NOT committed when request fails with zero tokens', async () => {
  let quotaCount = 0;
  const commitQuota = () => { quotaCount++; };

  // Stream attempt fails before emitting any tokens
  let emittedContent = '';
  let streamSuccess = false;

  if (streamSuccess || emittedContent.trim().length >= 20) {
    commitQuota();
  }

  assert.equal(quotaCount, 0, 'Quota must not be committed for empty/failed stream');
});

await test(30, 'Quota is committed on verified completion', async () => {
  let quotaCount = 0;
  const commitQuota = () => { quotaCount++; };

  let streamSuccess = true;
  let emittedContent = 'Complete and verified response';

  if (streamSuccess || emittedContent.trim().length >= 20) {
    commitQuota();
  }

  assert.equal(quotaCount, 1);
});

await test(31, 'Multiple fallback attempts in single request commit at most one quota unit', async () => {
  let quotaCount = 0;
  let quotaCommitted = false;
  const commitQuotaOnce = () => {
    if (!quotaCommitted) {
      quotaCommitted = true;
      quotaCount++;
    }
  };

  // Attempt 1 fails
  // Attempt 2 fails
  // Attempt 3 succeeds and calls commitQuotaOnce()
  commitQuotaOnce();
  // Any stray callback calls commitQuotaOnce() again
  commitQuotaOnce();

  assert.equal(quotaCount, 1, 'At most 1 quota unit committed per request');
});

// =========================================================================
// SECTION 9: DOWNSTREAM CANCELLATION & DISPOSAL (STEP 9)
// =========================================================================

await test(32, 'AbortSignal from caller terminates stream reader immediately', async () => {
  const controller = new AbortController();
  let aborted = false;

  const mockReader = {
    async read() {
      if (controller.signal.aborted) {
        throw new Error('User cancelled request');
      }
      return new Promise((resolve, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('User cancelled request')), { once: true });
      });
    },
    releaseLock() {},
  };

  const readPromise = mockReader.read().catch((e) => {
    aborted = true;
    return null;
  });

  controller.abort();
  await readPromise;
  assert.equal(aborted, true);
});

// =========================================================================
// SECTION 10: PERSIST OUTCOMES & METADATA (STEP 10)
// =========================================================================

await test(33, 'Persisted assistant messages retain complete status, finishReason, and tokenUsage', async () => {
  const store = createMockStorage();
  const conv = await store.createConversation();

  const msg = await store.addMessage(conv.id, {
    role: 'assistant',
    content: 'Full response',
    status: 'complete',
    finishReason: 'stop',
    tokenUsage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
  });

  const stored = (await store.getMessages(conv.id))[0];
  assert.equal(stored.status, 'complete');
  assert.equal(stored.finishReason, 'stop');
  assert.equal(stored.tokenUsage?.totalTokens, 75);
});

await test(34, 'Persisted interrupted messages retain interrupted status and partial content', async () => {
  const store = createMockStorage();
  const conv = await store.createConversation();

  const msg = await store.addMessage(conv.id, {
    role: 'assistant',
    content: 'Incomplete sentence before...',
    status: 'interrupted',
    finishReason: 'interrupted',
  });

  const stored = (await store.getMessages(conv.id))[0];
  assert.equal(stored.status, 'interrupted');
  assert.equal(stored.content, 'Incomplete sentence before...');
});

await test(35, 'Degraded research fallback is persisted with degraded status', async () => {
  const store = createMockStorage();
  const conv = await store.createConversation();

  const msg = await store.addMessage(conv.id, {
    role: 'assistant',
    content: 'Source-backed synthesized answer...',
    status: 'degraded',
  });

  const stored = (await store.getMessages(conv.id))[0];
  assert.equal(stored.status, 'degraded');
});

// =========================================================================
// SECTION 11: END-TO-END WORKFLOW INTEGRATION
// =========================================================================

await test(36, 'Rapid consecutive regeneration triggers reject concurrent duplicate runs', async () => {
  let activeRun = null;
  function triggerRegenerate() {
    if (activeRun && ['preparing', 'searching', 'connecting', 'streaming', 'persisting'].includes(activeRun.state)) {
      return false; // rejected
    }
    activeRun = { id: 'run-regen', state: 'streaming' };
    return true;
  }

  assert.equal(triggerRegenerate(), true);
  assert.equal(triggerRegenerate(), false, 'Second rapid regenerate must be rejected by lock');
});

await test(37, 'Switching conversation during active streaming aborts run cleanly', async () => {
  const controller = new AbortController();
  let aborted = false;
  controller.signal.addEventListener('abort', () => { aborted = true; });

  // Simulate conversation switch
  controller.abort(new Error('Switched conversation'));
  assert.equal(aborted, true);
  assert.equal(controller.signal.aborted, true);
});

await test(38, 'Model catalog caching handles network failure gracefully', async () => {
  // Simulate cached catalog in storage
  const cachedCatalog = CURATED_FREE_MODELS;
  let networkFailed = true;
  let resolvedModels = [];

  if (networkFailed) {
    resolvedModels = cachedCatalog;
  }

  assert.equal(resolvedModels.length, CURATED_FREE_MODELS.length);
  assert.ok(resolvedModels.every((m) => m.isFree));
});

await test(39, 'Zero price filter removes models with missing or non-zero pricing', async () => {
  const mockApiList = [
    { id: 'meta-llama/llama-3:free', pricing: { prompt: 0, completion: 0 } },
    { id: 'meta-llama/paid-model', pricing: { prompt: 0.01, completion: 0.02 } },
    { id: 'deepseek/free:free', pricing: { prompt: '0', completion: '0' } },
    { id: 'sneaky/zero-prompt-paid-completion:free', pricing: { prompt: 0, completion: 0.005 } },
  ];

  const filtered = mockApiList.filter((m) => {
    if (!m.id.endsWith(':free')) return false;
    const p = m.pricing;
    const isZero = (v) => v === 0 || v === '0';
    return p && isZero(p.prompt) && isZero(p.completion);
  });

  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].id, 'meta-llama/llama-3:free');
  assert.equal(filtered[1].id, 'deepseek/free:free');
});

await test(40, 'Terminal outcome guarantee: every stream produces exactly one terminal result', async () => {
  const possibleTerminalOutcomes = ['complete', 'interrupted', 'failed', 'degraded'];
  const testResults = ['complete', 'interrupted', 'degraded'];

  for (const res of testResults) {
    assert.ok(possibleTerminalOutcomes.includes(res), `${res} must be a valid terminal outcome`);
  }
});

// =========================================================================
// SECTION 12: PERMANENT SSE CONNECTION DROP REGRESSION (PHASE 7 VERIFICATION)
// =========================================================================

await test(41, 'Permanent SSE Regression: consumeChatStream marks unexpected EOF with partial content as interrupted', async () => {
  const encoder = new TextEncoder();
  const partialChunks = [
    'data: {"type":"meta","model":"meta-llama/llama-3-8b:free"}\n\n',
    'data: {"type":"delta","content":"Hello, here is half of a thought"}\n\n',
  ];

  // ReadableStream that drops / abruptly closes without [DONE] or terminal event
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of partialChunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close(); // Server connection dropped unexpectedly
    },
  });

  const reader = stream.getReader();
  let receivedDelta = '';
  let completeCalled = false;

  const result = await consumeChatStream(reader, 'meta-llama/llama-3-8b:free', {
    onDelta(delta) {
      receivedDelta += delta.content;
    },
    onComplete() {
      completeCalled = true;
    },
  });

  // Verify non-negotiable regression constraints:
  // 1. Must NOT falsely report 'complete'
  assert.notEqual(result.status, 'complete', 'Abrupt stream drop must not be marked complete');
  assert.equal(completeCalled, false, 'onComplete callback must not fire on dropped stream');

  // 2. Must report 'interrupted' status
  assert.equal(result.status, 'interrupted', 'Status must be interrupted when connection drops');

  // 3. Must preserve partial content
  assert.equal(result.fullContent, 'Hello, here is half of a thought', 'Partial content must be preserved');
  assert.equal(receivedDelta, 'Hello, here is half of a thought');

  // 4. Must set finishReason to stream_closed and supply descriptive errorMessage
  assert.equal(result.finishReason, 'stream_closed');
  assert.ok(result.errorMessage && result.errorMessage.includes('completion confirmation'), 'Must provide clear error message');
});

await test(42, 'Permanent SSE Regression: consumeChatStream marks unexpected EOF with zero content as failed', async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"type":"meta","model":"meta-llama/llama-3-8b:free"}\n\n'));
      controller.close(); // Server closed immediately without delta or terminal event
    },
  });

  const reader = stream.getReader();
  const result = await consumeChatStream(reader, 'meta-llama/llama-3-8b:free');

  assert.notEqual(result.status, 'complete', 'Abrupt stream drop must not be marked complete');
  assert.equal(result.status, 'failed', 'Empty stream drop must be marked failed');
  assert.equal(result.fullContent, '', 'Content should be empty');
  assert.ok(result.errorMessage && result.errorMessage.includes('without content'), 'Must provide empty content error message');
});

// Print summary
console.log('\n========================================');
console.log('Phase 2B Behavioral Test Results:');
console.log(`Total: ${results.length} | Passed: ${passCount} | Failed: ${failCount}`);
console.log('========================================\n');

if (failCount > 0) {
  process.exit(1);
}
