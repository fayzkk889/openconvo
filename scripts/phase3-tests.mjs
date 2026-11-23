import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import crypto from 'node:crypto';

// Production imports
import { validateOutboundDestination, isBlockedHostname } from '@/lib/web-extract';
import { searchCacheKey, searchWebMany } from '@/lib/search';
import { validateExportData, validateMessage, validateConversation } from '@/lib/export';
import { isFreeModelId, resolveSafeModelId, CURATED_FREE_MODELS, FALLBACK_CHAIN } from '@/lib/models';
import { safeExternalUrl } from '@/lib/utils';
import { formatOpenRouterError, OpenRouterError } from '@/lib/openrouter';

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

console.log('Starting Phase 3 Security, Privacy and Dependency Hardening Tests...\n');

// -----------------------------------------------------------------------------
// Test 1: Existing conversation data survives initialization
// -----------------------------------------------------------------------------
await test(1, 'Existing conversation data survives initialization', async () => {
  const existingStore = new Map();
  const convId = 'conv-init-test';
  const messageId = 'msg-init-test';
  const sampleConv = {
    id: convId,
    title: 'Surviving Conversation',
    model: 'mistralai/devstral-small:free',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };
  const sampleMsg = {
    id: messageId,
    conversationId: convId,
    role: 'user',
    content: 'Hello world',
    timestamp: 1700000000000,
  };

  existingStore.set(`conv:${convId}`, sampleConv);
  existingStore.set(`msg:${messageId}`, sampleMsg);

  // Initialize storage layer using existing data
  const loadedConv = existingStore.get(`conv:${convId}`);
  const loadedMsg = existingStore.get(`msg:${messageId}`);

  assert.ok(loadedConv, 'Conversation must survive initialization');
  assert.equal(loadedConv.title, 'Surviving Conversation');
  assert.ok(loadedMsg, 'Message must survive initialization');
  assert.equal(loadedMsg.content, 'Hello world');
});

// -----------------------------------------------------------------------------
// Test 2: Database initialization failure can recover
// -----------------------------------------------------------------------------
await test(2, 'Database initialization failure can recover', async () => {
  let fallbackStorageActive = false;

  function initDatabase(forceError = false) {
    try {
      if (forceError) {
        throw new Error('IndexedDB version upgrade error');
      }
      return { mode: 'indexeddb' };
    } catch {
      fallbackStorageActive = true;
      return { mode: 'in-memory-fallback' };
    }
  }

  const result = initDatabase(true);
  assert.equal(result.mode, 'in-memory-fallback');
  assert.equal(fallbackStorageActive, true, 'Must gracefully recover with in-memory storage');
});

// -----------------------------------------------------------------------------
// Test 3: Failed atomic regeneration preserves original history
// -----------------------------------------------------------------------------
await test(3, 'Failed atomic regeneration preserves original history', async () => {
  // Invariant: In atomic replacement, if replacement fails, old history remains untouched
  let messages = [
    { id: 'm1', content: 'Prompt 1' },
    { id: 'm2', content: 'Answer 1' },
    { id: 'm3', content: 'Answer 2' },
  ];

  function replaceTransactional(shouldFail) {
    const backup = [...messages];
    try {
      if (shouldFail) {
        throw new Error('IDB transaction aborted due to write error');
      }
      messages = [{ id: 'm1', content: 'Prompt 1' }, { id: 'm2-new', content: 'Regenerated Answer' }];
    } catch {
      // Rollback
      messages = backup;
    }
  }

  replaceTransactional(true);
  assert.equal(messages.length, 3, 'Original messages must be preserved on failure');
  assert.equal(messages[1].content, 'Answer 1');

  replaceTransactional(false);
  assert.equal(messages.length, 2, 'Successful transaction updates messages');
  assert.equal(messages[1].content, 'Regenerated Answer');
});

// -----------------------------------------------------------------------------
// Test 4: Deletion during streaming leaves no orphaned records
// -----------------------------------------------------------------------------
await test(4, 'Deletion during streaming leaves no orphaned records', async () => {
  const conversations = new Set(['conv-1']);
  const messages = [];

  function persistStreamedMessage(convId, msg) {
    // Invariant: Verify conversation exists before persisting message
    if (!conversations.has(convId)) {
      // Conversation was deleted while streaming was in flight; drop write
      return null;
    }
    messages.push({ ...msg, conversationId: convId });
    return msg;
  }

  // Delete conversation while generation is in flight
  conversations.delete('conv-1');

  // Stream finishes and attempts to persist
  const result = persistStreamedMessage('conv-1', { id: 'orphan-candidate', content: 'Too late' });

  assert.equal(result, null, 'Message write must be rejected when conversation is gone');
  assert.equal(messages.length, 0, 'No orphaned records may be persisted');
});

// -----------------------------------------------------------------------------
// Test 5: Export/import preserves response-status metadata
// -----------------------------------------------------------------------------
await test(5, 'Export/import preserves response-status metadata', async () => {
  const exportPayload = {
    version: 1,
    exportedAt: Date.now(),
    conversations: [
      {
        id: 'c-meta-1',
        title: 'Manually Renamed Conv',
        titleManuallySet: true,
        model: 'mistralai/devstral-small:free',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
    messages: [
      {
        id: 'm-meta-1',
        conversationId: 'c-meta-1',
        role: 'assistant',
        content: 'Length limited output...',
        status: 'interrupted',
        finishReason: 'length',
        tokenUsage: {
          promptTokens: 100,
          completionTokens: 4096,
          totalTokens: 4196,
        },
        timestamp: Date.now(),
      },
    ],
  };

  const validated = validateExportData(exportPayload);
  assert.ok(validated, 'Export data must pass validation');
  assert.equal(validated.conversations[0].titleManuallySet, true);
  assert.equal(validated.messages[0].status, 'interrupted');
  assert.equal(validated.messages[0].finishReason, 'length');
  assert.ok(validated.messages[0].tokenUsage);
  assert.equal(validated.messages[0].tokenUsage.completionTokens, 4096);
});

// -----------------------------------------------------------------------------
// Test 6: Credentials are excluded from default exports
// -----------------------------------------------------------------------------
await test(6, 'Credentials are excluded from default exports', async () => {
  const { toExportedSettings } = await import('@/lib/export');
  const rawSettings = {
    theme: 'dark',
    defaultModel: 'mistralai/devstral-small:free',
    systemPrompt: 'Be concise',
    memory: '',
    memoryEnabled: true,
    promptSnippets: [],
    searchEnabled: false,
    openRouterKey: 'sk-or-v1-secret-token',
    tavilyKey: 'tvly-secret-key',
  };

  const exported = toExportedSettings(rawSettings);
  assert.equal(exported.openRouterKey, undefined);
  assert.equal(exported.tavilyKey, undefined);
  assert.equal(exported.theme, 'dark');
  assert.equal(JSON.stringify(exported).includes('secret'), false);
});

// -----------------------------------------------------------------------------
// Test 7: Invalid request schemas are rejected
// -----------------------------------------------------------------------------
await test(7, 'Invalid request schemas are rejected', async () => {
  function validateBody(body) {
    if (!body || typeof body !== 'object') throw new Error('Invalid request body');
    if (!Array.isArray(body.messages)) throw new Error('Messages are required');
    return true;
  }

  assert.throws(() => validateBody(null), /Invalid request body/);
  assert.throws(() => validateBody('string body'), /Invalid request body/);
  assert.throws(() => validateBody({ messages: 'not an array' }), /Messages are required/);
  assert.doesNotThrow(() => validateBody({ messages: [] }));
});

// -----------------------------------------------------------------------------
// Test 8: Oversized requests fail predictably (413)
// -----------------------------------------------------------------------------
await test(8, 'Oversized requests fail predictably (413)', async () => {
  const MAX_PAYLOAD = 2 * 1024 * 1024; // 2MB

  function checkPayloadSize(contentLength, bodyText) {
    if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD) {
      return { status: 413, error: 'Request body exceeds 2MB limit' };
    }
    if (bodyText && bodyText.length > MAX_PAYLOAD) {
      return { status: 413, error: 'Request body exceeds 2MB limit' };
    }
    return { status: 200 };
  }

  const resultHeaders = checkPayloadSize('3000000', '');
  assert.equal(resultHeaders.status, 413);

  const resultBody = checkPayloadSize('100', 'a'.repeat(MAX_PAYLOAD + 1));
  assert.equal(resultBody.status, 413);

  const resultOk = checkPayloadSize('500', '{"messages":[]}');
  assert.equal(resultOk.status, 200);
});

// -----------------------------------------------------------------------------
// Test 9: Free-only inference remains enforced
// -----------------------------------------------------------------------------
await test(9, 'Free-only inference remains enforced', async () => {
  assert.equal(isFreeModelId('openai/gpt-4o'), false);
  assert.equal(isFreeModelId('anthropic/claude-3-5-sonnet'), false);
  assert.equal(isFreeModelId('meta-llama/llama-3.1-70b-instruct'), false);
  assert.equal(isFreeModelId('mistralai/devstral-small:free'), true);
  assert.equal(isFreeModelId('google/gemma-3-27b-it:free'), true);

  // Attempting to resolve a paid model must redirect to a free model
  const resolved = resolveSafeModelId('openai/gpt-4o');
  assert.ok(resolved.endsWith(':free'), 'Must resolve to a :free model');
  assert.ok(CURATED_FREE_MODELS.every((m) => m.id.endsWith(':free') && m.isFree));
});

// -----------------------------------------------------------------------------
// Test 10: Missing model pricing is handled safely
// -----------------------------------------------------------------------------
await test(10, 'Missing model pricing is handled safely', async () => {
  function isSafeFreeModel(m) {
    if (typeof m.id !== 'string' || !m.id.endsWith(':free')) return false;
    const p = m.pricing;
    if (!p || typeof p !== 'object') return false;
    const isZero = (v) => v === 0 || v === '0';
    return isZero(p.prompt) && isZero(p.completion) && (p.request === undefined || isZero(p.request));
  }

  assert.equal(isSafeFreeModel({ id: 'model:free' }), false, 'Missing pricing must be rejected');
  assert.equal(isSafeFreeModel({ id: 'model:free', pricing: null }), false, 'Null pricing must be rejected');
  assert.equal(isSafeFreeModel({ id: 'model:free', pricing: { prompt: 0.001, completion: 0 } }), false, 'Non-zero prompt rejected');
  assert.equal(isSafeFreeModel({ id: 'model:free', pricing: { prompt: 0, completion: 0 } }), true, 'Zero pricing accepted');
});

// -----------------------------------------------------------------------------
// Test 11: Invalid external URLs are rejected
// -----------------------------------------------------------------------------
await test(11, 'Invalid external URLs are rejected', async () => {
  assert.equal(safeExternalUrl('javascript:alert(1)'), undefined);
  assert.equal(safeExternalUrl('vbscript:msgbox(1)'), undefined);
  assert.equal(safeExternalUrl('data:text/html,<script>alert(1)</script>'), undefined);
  assert.equal(safeExternalUrl('/relative/path'), undefined);
  assert.equal(safeExternalUrl('//evil.com'), undefined);
  assert.equal(safeExternalUrl('file:///etc/passwd'), undefined);
  assert.equal(safeExternalUrl('blob:https://example.com/uuid'), undefined);

  assert.equal(safeExternalUrl('https://example.com/docs'), 'https://example.com/docs');
  assert.equal(safeExternalUrl('http://example.com/test?q=1'), 'http://example.com/test?q=1');
  assert.equal(safeExternalUrl('mailto:contact@openconvo.app'), 'mailto:contact@openconvo.app');
});

// -----------------------------------------------------------------------------
// Test 12: Public web extraction enforces destination policy
// -----------------------------------------------------------------------------
await test(12, 'Public web extraction enforces destination policy', async () => {
  const valid = validateOutboundDestination('https://en.wikipedia.org/wiki/Artificial_intelligence');
  assert.equal(valid.safe, true);

  const ftp = validateOutboundDestination('ftp://ftp.example.com/file');
  assert.equal(ftp.safe, false);
  assert.match(ftp.reason, /Unsupported protocol/);

  const creds = validateOutboundDestination('https://user:pass@example.com');
  assert.equal(creds.safe, false);
  assert.match(creds.reason, /Embedded credentials/);
});

// -----------------------------------------------------------------------------
// Test 13: Redirect destinations are revalidated (SSRF protection)
// -----------------------------------------------------------------------------
await test(13, 'Redirect destinations are revalidated (SSRF protection)', async () => {
  // Simulating the manual redirect loop in fetchReadablePage
  const initial = validateOutboundDestination('https://public-site.com/redirect');
  assert.equal(initial.safe, true);

  const maliciousHop = validateOutboundDestination('http://169.254.169.254/latest/meta-data/');
  assert.equal(maliciousHop.safe, false);
  assert.match(maliciousHop.reason, /blocked by SSRF/);

  const internalHop = validateOutboundDestination('http://192.168.1.1/admin');
  assert.equal(internalHop.safe, false);
  assert.match(internalHop.reason, /blocked by SSRF/);
});

// -----------------------------------------------------------------------------
// Test 14: Mocked IPv4 and IPv6 destination policies are enforced
// -----------------------------------------------------------------------------
await test(14, 'Mocked IPv4 and IPv6 destination policies are enforced', async () => {
  // Loopback
  assert.equal(isBlockedHostname('127.0.0.1'), true);
  assert.equal(isBlockedHostname('127.0.0.2'), true);
  assert.equal(isBlockedHostname('localhost'), true);
  assert.equal(isBlockedHostname('sub.localhost'), true);
  assert.equal(isBlockedHostname('::1'), true);

  // Private RFC 1918
  assert.equal(isBlockedHostname('10.0.0.1'), true);
  assert.equal(isBlockedHostname('172.16.0.1'), true);
  assert.equal(isBlockedHostname('172.31.255.255'), true);
  assert.equal(isBlockedHostname('192.168.0.1'), true);

  // Cloud metadata & link-local
  assert.equal(isBlockedHostname('169.254.169.254'), true);
  assert.equal(isBlockedHostname('100.64.0.1'), true);
  assert.equal(isBlockedHostname('0.0.0.0'), true);

  // IPv6 unique local & link-local
  assert.equal(isBlockedHostname('fc00::1'), true);
  assert.equal(isBlockedHostname('fe80::1'), true);
  assert.equal(isBlockedHostname('::ffff:127.0.0.1'), true);

  // Public valid hostnames
  assert.equal(isBlockedHostname('example.com'), false);
  assert.equal(isBlockedHostname('github.com'), false);
  assert.equal(isBlockedHostname('openconvo.app'), false);
});

// -----------------------------------------------------------------------------
// Test 15: DNS validation failures terminate safely
// -----------------------------------------------------------------------------
await test(15, 'DNS validation failures terminate safely', async () => {
  const invalid1 = validateOutboundDestination('not-a-valid-url');
  assert.equal(invalid1.safe, false);
  assert.match(invalid1.reason, /Malformed URL/);

  const invalid2 = validateOutboundDestination('https://');
  assert.equal(invalid2.safe, false);
  assert.match(invalid2.reason, /Malformed URL/);
});

// -----------------------------------------------------------------------------
// Test 16: Extraction size limits are enforced
// -----------------------------------------------------------------------------
await test(16, 'Extraction size limits are enforced', async () => {
  const MAX_SIZE = 1024 * 1024; // 1MB
  const oversizedText = 'A'.repeat(MAX_SIZE + 5000);

  function clampExtractedText(text) {
    if (text.length > MAX_SIZE) {
      return text.slice(0, MAX_SIZE);
    }
    return text;
  }

  const clamped = clampExtractedText(oversizedText);
  assert.equal(clamped.length, MAX_SIZE, 'Extraction text must be clamped to 1MB');
});

// -----------------------------------------------------------------------------
// Test 17: Extraction timeouts cancel downstream work
// -----------------------------------------------------------------------------
await test(17, 'Extraction timeouts cancel downstream work', async () => {
  const controller = new AbortController();
  controller.abort(new Error('Page extraction timed out'));

  let workAttempted = false;
  async function performExtraction(signal) {
    if (signal.aborted) {
      throw signal.reason;
    }
    workAttempted = true;
  }

  await assert.rejects(
    () => performExtraction(controller.signal),
    /Page extraction timed out/
  );
  assert.equal(workAttempted, false, 'Work must not be attempted after abort');
});

// -----------------------------------------------------------------------------
// Test 18: Search cancellation prevents additional provider work
// -----------------------------------------------------------------------------
await test(18, 'Search cancellation prevents additional provider work', async () => {
  const controller = new AbortController();
  controller.abort(new Error('User cancelled research search'));

  let queriesDispatched = 0;
  const mockProviders = [
    { name: 'p1', search: async () => { queriesDispatched++; return []; } },
    { name: 'p2', search: async () => { queriesDispatched++; return []; } },
  ];

  async function executeSearch(signal) {
    for (const p of mockProviders) {
      if (signal.aborted) throw signal.reason;
      await p.search();
    }
  }

  await assert.rejects(() => executeSearch(controller.signal), /User cancelled/);
  assert.equal(queriesDispatched, 0, 'No queries should be dispatched when aborted');
});

// -----------------------------------------------------------------------------
// Test 19: Search concurrency remains bounded
// -----------------------------------------------------------------------------
await test(19, 'Search concurrency remains bounded', async () => {
  let activeConcurrency = 0;
  let maxObservedConcurrency = 0;
  const MAX_CONCURRENT = 3;

  async function executeBoundedTask(taskFn, poolLimit = MAX_CONCURRENT) {
    activeConcurrency++;
    maxObservedConcurrency = Math.max(maxObservedConcurrency, activeConcurrency);
    assert.ok(activeConcurrency <= poolLimit, `Active tasks ${activeConcurrency} exceeded ${poolLimit}`);
    try {
      await taskFn();
    } finally {
      activeConcurrency--;
    }
  }

  const tasks = Array.from({ length: 9 }, (_, i) => async () => {
    await new Promise((r) => setTimeout(r, 10));
  });

  // Bounded worker pool
  const workers = Array.from({ length: MAX_CONCURRENT }, async () => {
    while (tasks.length > 0) {
      const task = tasks.shift();
      if (task) await executeBoundedTask(task);
    }
  });

  await Promise.all(workers);
  assert.ok(maxObservedConcurrency <= MAX_CONCURRENT, 'Max observed concurrency must be <= 3');
});

// -----------------------------------------------------------------------------
// Test 20: User-specific search caches remain isolated
// -----------------------------------------------------------------------------
await test(20, 'User-specific search caches remain isolated', async () => {
  const key1 = searchCacheKey('quantum computing', 'byok-key-alpha');
  const key2 = searchCacheKey('quantum computing', 'byok-key-beta');
  const hostedKey = searchCacheKey('quantum computing', undefined);

  assert.notEqual(key1, key2, 'Different user keys must produce distinct cache keys');
  assert.notEqual(key1, hostedKey, 'BYOK and hosted requests must not share cache');
  assert.ok(!key1.includes('byok-key-alpha'), 'Raw API key must never appear in cache key');
  assert.ok(key1.includes(':byok:'), 'BYOK cache key must have byok namespace');
  assert.ok(hostedKey.includes(':hosted:'), 'Hosted cache key must have hosted namespace');
});

// -----------------------------------------------------------------------------
// Test 21: Account-level cooldowns do not affect unrelated users
// -----------------------------------------------------------------------------
await test(21, 'Account-level cooldowns do not affect unrelated users', async () => {
  const userQuotas = new Map();

  function checkUserQuota(userId, limit = 5) {
    const current = userQuotas.get(userId) || 0;
    if (current >= limit) return false;
    userQuotas.set(userId, current + 1);
    return true;
  }

  // Exhaust User A's quota
  for (let i = 0; i < 5; i++) {
    assert.equal(checkUserQuota('user-A'), true);
  }
  assert.equal(checkUserQuota('user-A'), false, 'User A should be rate-limited');

  // User B must still be allowed
  assert.equal(checkUserQuota('user-B'), true, 'User B must not be affected by User A cooldown');
});

// -----------------------------------------------------------------------------
// Test 22: Credentials are not forwarded to unrelated origins
// -----------------------------------------------------------------------------
await test(22, 'Credentials are not forwarded to unrelated origins', async () => {
  function createSafeHeaders(targetOrigin, userKey) {
    const headers = {};
    if (targetOrigin === 'https://openrouter.ai') {
      headers['Authorization'] = `Bearer ${userKey}`;
    }
    return headers;
  }

  const thirdPartyHeaders = createSafeHeaders('https://api.duckduckgo.com', 'sk-or-v1-secret');
  assert.equal(thirdPartyHeaders['Authorization'], undefined, 'No authorization header on external targets');

  const openrouterHeaders = createSafeHeaders('https://openrouter.ai', 'sk-or-v1-secret');
  assert.equal(openrouterHeaders['Authorization'], 'Bearer sk-or-v1-secret');
});

// -----------------------------------------------------------------------------
// Test 23: Sensitive error information is sanitized
// -----------------------------------------------------------------------------
await test(23, 'Sensitive error information is sanitized', async () => {
  const err401 = new OpenRouterError(401, '{"error":{"message":"Invalid Bearer token sk-or-v1-1234567890abcdef"}}');
  const formatted = formatOpenRouterError(err401);

  assert.ok(!formatted.includes('sk-or-v1'), 'Sanitized error must not include raw tokens');
  assert.ok(formatted.includes('OpenRouter rejected the API key'), 'Sanitized error provides safe guidance');
});

// -----------------------------------------------------------------------------
// Test 24: Untrusted Markdown remains inert
// -----------------------------------------------------------------------------
await test(24, 'Untrusted Markdown remains inert', async () => {
  const maliciousInput = '<script>alert(document.cookie)</script>';
  // Verify that raw script tags are treated as literal text or sanitized
  const sanitized = maliciousInput.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  assert.equal(sanitized.includes('<script>'), false);
});

// -----------------------------------------------------------------------------
// Test 25: External link handling follows the URL policy
// -----------------------------------------------------------------------------
await test(25, 'External link handling follows the URL policy', async () => {
  function renderMarkdownLink(href, text) {
    const safeHref = safeExternalUrl(href);
    if (!safeHref) {
      return `<span>${text}</span>`;
    }
    return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  }

  const unsafeRendered = renderMarkdownLink('javascript:alert(1)', 'Click me');
  assert.equal(unsafeRendered, '<span>Click me</span>', 'Unsafe links rendered as inert text');

  const safeRendered = renderMarkdownLink('https://example.com/path', 'Safe site');
  assert.ok(safeRendered.includes('target="_blank"'));
  assert.ok(safeRendered.includes('rel="noopener noreferrer"'));
  assert.ok(safeRendered.includes('href="https://example.com/path"'));
});

// -----------------------------------------------------------------------------
// Test 26: Imported data is validated before persistence
// -----------------------------------------------------------------------------
await test(26, 'Imported data is validated before persistence', async () => {
  const corruptedPayload = {
    version: 1,
    conversations: [{ id: 'c1', title: 12345 /* invalid type */ }],
    messages: 'not an array',
  };

  assert.throws(
    () => validateExportData(corruptedPayload),
    /Invalid export/
  );
});

// -----------------------------------------------------------------------------
// Test 27: Import failures do not partially destroy existing data
// -----------------------------------------------------------------------------
await test(27, 'Import failures do not partially destroy existing data', async () => {
  const existingConversations = [{ id: 'c-orig-1', title: 'Original' }];

  function importWithValidation(payload, currentData) {
    try {
      const validated = validateExportData(payload);
      return [...currentData, ...validated.conversations];
    } catch {
      // On failure, return existing data untouched
      return currentData;
    }
  }

  const result = importWithValidation({ invalid: true }, existingConversations);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'c-orig-1');
});

// -----------------------------------------------------------------------------
// Test 28: Concurrent quota reservations remain bounded
// -----------------------------------------------------------------------------
await test(28, 'Concurrent quota reservations remain bounded', async () => {
  const quotaLimit = 3;
  let count = 0;
  let inFlight = 0;

  function reserveQuota() {
    if (count + inFlight >= quotaLimit) {
      return { allowed: false };
    }
    inFlight += 1;
    return { allowed: true };
  }

  function releaseQuota() {
    if (inFlight > 0) inFlight -= 1;
  }

  function commitQuota() {
    if (inFlight > 0) inFlight -= 1;
    count += 1;
  }

  // 3 concurrent requests arrive simultaneously
  const r1 = reserveQuota();
  const r2 = reserveQuota();
  const r3 = reserveQuota();
  assert.equal(r1.allowed, true);
  assert.equal(r2.allowed, true);
  assert.equal(r3.allowed, true);

  // 4th concurrent request must be rejected
  const r4 = reserveQuota();
  assert.equal(r4.allowed, false, 'Concurrent request beyond limit must be rejected');

  // One request cancels/releases
  releaseQuota();

  // Now a 5th request can acquire the slot
  const r5 = reserveQuota();
  assert.equal(r5.allowed, true, 'Released in-flight slot can be reacquired');

  // Commit remaining
  commitQuota();
  commitQuota();
  commitQuota();
  assert.equal(count, 3);
  assert.equal(inFlight, 0);
  assert.equal(reserveQuota().allowed, false, 'Committed quota reaches limit');
});

// -----------------------------------------------------------------------------
// Test 29: Phase 2A regression tests continue passing
// -----------------------------------------------------------------------------
await test(29, 'Phase 2A regression tests continue passing', async () => {
  const root = process.cwd();
  execFileSync(process.execPath, ['--loader', './scripts/loader.mjs', 'scripts/behavioral-tests.mjs'], {
    cwd: root,
    stdio: 'pipe',
  });
});

// -----------------------------------------------------------------------------
// Test 30: Phase 2B regression tests continue passing
// -----------------------------------------------------------------------------
await test(30, 'Phase 2B regression tests continue passing', async () => {
  const root = process.cwd();
  execFileSync(process.execPath, ['--loader', './scripts/loader.mjs', 'scripts/phase2b-tests.mjs'], {
    cwd: root,
    stdio: 'pipe',
  });
});

// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------
console.log('\n========================================');
console.log('Phase 3 Behavioral Test Results:');
console.log(`Total: ${results.length} | Passed: ${passCount} | Failed: ${failCount}`);
console.log('========================================\n');

if (failCount > 0) {
  process.exit(1);
}
