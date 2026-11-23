// RC-4 regression tests: shared hosted-free quota store and keyless search.
//
// What these prove: the real quota module, route handlers and search library
// behave correctly against controlled, mocked HTTP (a fake Redis REST server
// that applies INCRBY atomically, OpenRouter, search providers). They do NOT
// prove a specific hosted Redis provider works; see audit/ for live evidence.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';

import { POST as chatPOST } from '@/app/api/chat/route';
import { POST as searchPOST } from '@/app/api/search/route';
import { GET as configGET } from '@/app/api/config/route';
import {
  reserveQuota,
  releaseQuota,
  sharedStoreConfig,
  __resetMemoryQuotaForTests,
} from '@/lib/hosted-quota';
import { isHostedFreeEnabled } from '@/lib/hosted-mode';
import { parseWikipediaResponse, searchWeb } from '@/lib/search';
import { FALLBACK_CHAIN, DEFAULT_MODEL_ID } from '@/lib/models';
import { SseChunkParser } from '@/lib/sse-parser';

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`[PASS] ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`[FAIL] ${name}\n       ${error?.stack || error}`);
  }
}

const realFetch = globalThis.fetch;
const hashed = (id) => createHmac('sha256', 'test-store-token').update(id).digest('hex').slice(0, 32);
const STORE_ENV = {
  UPSTASH_REDIS_REST_URL: 'https://quota-store.test.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'test-store-token',
};

/** A fake Upstash REST endpoint: each pipeline runs atomically, like Redis. */
function fakeRedis() {
  const data = new Map();
  const calls = [];
  const handle = async (url, init) => {
    calls.push({ url, auth: init.headers?.Authorization, body: JSON.parse(init.body) });
    // Yield so concurrent callers genuinely interleave between requests.
    await new Promise((r) => setTimeout(r, Math.random() * 3));
    const out = [];
    for (const [command, key, arg] of JSON.parse(init.body)) {
      if (command === 'INCRBY') {
        const next = (data.get(key) || 0) + Number(arg);
        data.set(key, next);
        out.push({ result: next });
      } else if (command === 'EXPIRE') {
        out.push({ result: 1 });
      } else {
        out.push({ error: `unsupported ${command}` });
      }
    }
    return Response.json(out);
  };
  return { data, calls, handle };
}

function withEnv(vars, fn) {
  const previous = {};
  for (const [k, v] of Object.entries(vars)) {
    previous[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const restore = () => {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  return Promise.resolve().then(fn).finally(restore);
}

function sseBody(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}
const delta = (content, finish = null) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finish }] })}\n\n`;

let upstreamCalls = [];
function installFetch(handler, store) {
  upstreamCalls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (store && url.startsWith(STORE_ENV.UPSTASH_REDIS_REST_URL)) return store.handle(url, init);
    if (url.endsWith('/api/v1/models')) {
      return Response.json({
        data: FALLBACK_CHAIN.map((id) => ({ id, name: id, context_length: 262144, pricing: { prompt: '0', completion: '0' } })),
      });
    }
    upstreamCalls.push({ url, init });
    return handler({ url, init });
  };
}

const okStream = () => new Response(sseBody([delta('ok', 'stop'), 'data: [DONE]\n\n']), { status: 200 });

function chatRequest(ip, headers = {}) {
  return new NextRequest('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Say ok.' }], model: DEFAULT_MODEL_ID }),
  });
}

function searchRequest(ip, body, headers = {}) {
  return new NextRequest('http://localhost/api/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers },
    body: JSON.stringify(body),
  });
}

async function drain(response) {
  const parser = new SseChunkParser();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const payload of parser.feed(decoder.decode(value, { stream: true }))) events.push(JSON.parse(payload));
  }
  return events;
}

// ---------------------------------------------------------------------------
// Quota module
// ---------------------------------------------------------------------------
const NOW = Date.UTC(2026, 10, 24, 12);

await test('Quota (memory): per-visitor limit refuses the request after the limit', async () => {
  __resetMemoryQuotaForTests();
  const limits = { perIdentity: 2, global: 100 };
  const env = {};
  const a = await reserveQuota('chat', '198.51.100.1', limits, { env, now: NOW });
  const b = await reserveQuota('chat', '198.51.100.1', limits, { env, now: NOW });
  const c = await reserveQuota('chat', '198.51.100.1', limits, { env, now: NOW });
  assert.deepEqual([a.allowed, b.allowed, c.allowed], [true, true, false]);
  assert.equal(c.reason, 'identity');
  assert.equal(b.remaining, 0);
  const other = await reserveQuota('chat', '198.51.100.2', limits, { env, now: NOW });
  assert.equal(other.allowed, true, 'another visitor is unaffected');
});

await test('Quota (memory): deployment-wide cap applies across visitors and refunds the refused visitor', async () => {
  __resetMemoryQuotaForTests();
  const limits = { perIdentity: 5, global: 2 };
  const env = {};
  assert.equal((await reserveQuota('chat', 'v1', limits, { env, now: NOW })).allowed, true);
  assert.equal((await reserveQuota('chat', 'v2', limits, { env, now: NOW })).allowed, true);
  const refused = await reserveQuota('chat', 'v3', limits, { env, now: NOW });
  assert.equal(refused.allowed, false);
  assert.equal(refused.reason, 'global');
  // v3's own counter was refunded: once the day rolls over v3 has a full allowance.
  const tomorrow = NOW + 24 * 60 * 60 * 1000;
  const next = await reserveQuota('chat', 'v3', limits, { env, now: tomorrow });
  assert.equal(next.allowed, true);
  assert.equal(next.remaining, 4);
});

await test('Quota (memory): releasing a failed request refunds the visitor but not the deployment-wide count', async () => {
  __resetMemoryQuotaForTests();
  const limits = { perIdentity: 1, global: 2 };
  const env = {};
  const first = await reserveQuota('chat', 'v1', limits, { env, now: NOW });
  await releaseQuota(first, { env });
  const retry = await reserveQuota('chat', 'v1', limits, { env, now: NOW });
  assert.equal(retry.allowed, true, 'visitor slot was refunded');
  const third = await reserveQuota('chat', 'v2', limits, { env, now: NOW });
  assert.equal(third.allowed, false, 'failed upstream attempts still count toward the provider cap');
  assert.equal(third.reason, 'global');
});

await test('Quota (shared store): INCRBY pipeline goes to the REST endpoint with bearer auth and day-bucketed keys', async () => {
  const store = fakeRedis();
  installFetch(() => new Response('unexpected', { status: 500 }), store);
  const r = await reserveQuota('search', '203.0.113.5', { perIdentity: 3, global: 10 }, { env: STORE_ENV, now: NOW });
  assert.equal(r.allowed, true);
  assert.equal(store.calls.length, 2);
  assert.ok(store.calls.every((c) => c.url === `${STORE_ENV.UPSTASH_REDIS_REST_URL}/pipeline`));
  assert.ok(store.calls.every((c) => c.auth === 'Bearer test-store-token'));
  assert.deepEqual(store.calls[0].body[0], ['INCRBY', `openconvo:quota:search:2026-11-24:id:${hashed('203.0.113.5')}`, '1']);
  assert.ok(!JSON.stringify(store.calls).includes('203.0.113.5'), 'the visitor IP never reaches the store in clear text');
  assert.deepEqual(store.calls[1].body[0], ['INCRBY', 'openconvo:quota:search:2026-11-24:global', '1']);
  assert.equal(store.calls[0].body[1][0], 'EXPIRE');
});

await test('Quota (shared store): 40 concurrent reservations against a limit of 10 admit exactly 10', async () => {
  const store = fakeRedis();
  installFetch(() => new Response('unexpected', { status: 500 }), store);
  const reservations = await Promise.all(
    Array.from({ length: 40 }, () => reserveQuota('chat', '192.0.2.10', { perIdentity: 10, global: 1000 }, { env: STORE_ENV, now: NOW }))
  );
  assert.equal(reservations.filter((r) => r.allowed).length, 10);
  assert.equal(store.data.get(`openconvo:quota:chat:2026-11-24:id:${hashed('192.0.2.10')}`), 10, 'refused requests are refunded');
});

await test('Quota (shared store): concurrent visitors cannot exceed the deployment-wide cap', async () => {
  const store = fakeRedis();
  installFetch(() => new Response('unexpected', { status: 500 }), store);
  const reservations = await Promise.all(
    Array.from({ length: 25 }, (_, i) => reserveQuota('chat', `192.0.2.${i}`, { perIdentity: 5, global: 7 }, { env: STORE_ENV, now: NOW }))
  );
  assert.equal(reservations.filter((r) => r.allowed).length, 7);
});

await test('Quota (shared store): an unreachable store fails closed', async () => {
  installFetch(() => new Response('unexpected', { status: 500 }), {
    handle: async () => new Response('down', { status: 503 }),
  });
  const r = await reserveQuota('chat', 'v1', { perIdentity: 5, global: 5 }, { env: STORE_ENV, now: NOW });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'store-unavailable');
});

await test('Shared store config: accepts Upstash or Vercel KV variables, rejects plain-http remote URLs', () => {
  assert.ok(sharedStoreConfig(STORE_ENV));
  assert.ok(sharedStoreConfig({ KV_REST_API_URL: 'https://kv.example.com/', KV_REST_API_TOKEN: 't' }));
  assert.equal(sharedStoreConfig({ KV_REST_API_URL: 'https://kv.example.com/', KV_REST_API_TOKEN: 't' }).url, 'https://kv.example.com');
  assert.equal(sharedStoreConfig({ UPSTASH_REDIS_REST_URL: 'http://evil.example.com', UPSTASH_REDIS_REST_TOKEN: 't' }), null);
  assert.ok(sharedStoreConfig({ UPSTASH_REDIS_REST_URL: 'http://localhost:8079', UPSTASH_REDIS_REST_TOKEN: 't' }));
  assert.equal(sharedStoreConfig({ UPSTASH_REDIS_REST_URL: 'https://x.upstash.io' }), null);
});

await test('Hosted mode policy: production opt-in requires the shared store (Upstash or Vercel KV)', () => {
  assert.equal(isHostedFreeEnabled({ VERCEL_ENV: 'production', OPENCONVO_HOSTED_FREE: 'on' }), false);
  assert.equal(isHostedFreeEnabled({ VERCEL_ENV: 'production', OPENCONVO_HOSTED_FREE: 'on', ...STORE_ENV }), true);
  assert.equal(isHostedFreeEnabled({ VERCEL_ENV: 'production', OPENCONVO_HOSTED_FREE: 'on', KV_REST_API_URL: 'https://kv.example.com', KV_REST_API_TOKEN: 't' }), true);
  assert.equal(isHostedFreeEnabled({ VERCEL_ENV: 'production', ...STORE_ENV }), false, 'a store alone does not opt in');
  assert.equal(isHostedFreeEnabled({ OPENCONVO_HOSTED_FREE: 'on' }), true, 'local runs may use memory counters');
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
await test('Chat route: production hosted mode counts in the shared store and enforces the deployment-wide cap', async () => {
  const store = fakeRedis();
  await withEnv({
    ...STORE_ENV,
    VERCEL_ENV: 'production',
    OPENCONVO_HOSTED_FREE: 'on',
    OPENROUTER_API_KEY: 'sk-or-hosted-test',
    OPENCONVO_HOSTED_FREE_DAILY_LIMIT: '5',
    OPENCONVO_HOSTED_FREE_GLOBAL_DAILY_LIMIT: '2',
  }, async () => {
    installFetch(okStream, store);
    const config = await (await configGET()).json();
    assert.equal(config.hostedFreeModeAvailable, true);
    const a = await chatPOST(chatRequest('198.51.100.31'));
    assert.equal(a.status, 200);
    await drain(a);
    const b = await chatPOST(chatRequest('198.51.100.32'));
    assert.equal(b.status, 200);
    await drain(b);
    const c = await chatPOST(chatRequest('198.51.100.33'));
    assert.equal(c.status, 429);
    assert.match((await c.json()).error, /shared free capacity is used up for today/);
    assert.equal(upstreamCalls.filter((u) => u.url.includes('openrouter.ai')).length, 2, 'refused request never reaches the provider');
  });
});

await test('Chat route: unreachable quota store returns 503 for keyless visitors and never touches BYOK visitors', async () => {
  await withEnv({
    ...STORE_ENV,
    VERCEL_ENV: 'production',
    OPENCONVO_HOSTED_FREE: 'on',
    OPENROUTER_API_KEY: 'sk-or-hosted-test',
  }, async () => {
    let storeCalls = 0;
    installFetch(okStream, { handle: async () => { storeCalls += 1; return new Response('down', { status: 503 }); } });
    const keyless = await chatPOST(chatRequest('198.51.100.40'));
    assert.equal(keyless.status, 503);
    assert.match((await keyless.json()).error, /temporarily unavailable/);
    assert.equal(upstreamCalls.length, 0, 'no provider call without a counted reservation');
    const callsBefore = storeCalls;
    const byok = await chatPOST(chatRequest('198.51.100.41', { 'x-openrouter-key': 'sk-or-visitor' }));
    assert.equal(byok.status, 200);
    assert.equal((await drain(byok)).at(-1).type, 'complete');
    assert.equal(storeCalls, callsBefore, 'BYOK requests do not consult the quota store');
  });
});

await test('Chat route: a failed hosted request refunds the visitor slot', async () => {
  __resetMemoryQuotaForTests();
  await withEnv({
    OPENCONVO_HOSTED_FREE: 'on',
    VERCEL_ENV: undefined,
    OPENROUTER_API_KEY: 'sk-or-hosted-test',
    OPENCONVO_HOSTED_FREE_DAILY_LIMIT: '1',
    OPENCONVO_HOSTED_FREE_GLOBAL_DAILY_LIMIT: '50',
  }, async () => {
    installFetch(() => new Response(JSON.stringify({ error: { message: 'upstream down' } }), { status: 500 }));
    const failed = await chatPOST(chatRequest('198.51.100.50'));
    await drain(failed);
    await new Promise((r) => setTimeout(r, 10));
    installFetch(okStream);
    const retry = await chatPOST(chatRequest('198.51.100.50'));
    assert.equal(retry.status, 200, 'the visitor may retry after a request that produced nothing');
    await drain(retry);
    const over = await chatPOST(chatRequest('198.51.100.50'));
    assert.equal(over.status, 429);
  });
});

await test('Search route: BYOK-only deployments rate-limit keyless scraping per visitor, without a deployment-wide cap', async () => {
  __resetMemoryQuotaForTests();
  await withEnv({
    VERCEL_ENV: 'production',
    OPENCONVO_HOSTED_FREE: undefined,
    OPENCONVO_HOSTED_SEARCH_GLOBAL_DAILY_LIMIT: '1',
  }, async () => {
    installFetch(() => new Response('', { status: 503 }));
    const a = await searchPOST(searchRequest('198.51.100.60', { query: 'tidal energy', mode: 'search' }, { 'x-openrouter-key': 'sk-or-visitor' }));
    const b = await searchPOST(searchRequest('198.51.100.61', { query: 'tidal energy', mode: 'search' }, { 'x-openrouter-key': 'sk-or-visitor' }));
    assert.equal(a.status, 200);
    assert.equal(b.status, 200, 'another BYOK visitor is not blocked by a shared-capacity cap');
  });
});

// ---------------------------------------------------------------------------
// Keyless search: Wikipedia
// ---------------------------------------------------------------------------
const WIKI_FIXTURE = {
  query: {
    pages: [
      { title: 'ReactOS', index: 1, fullurl: 'https://en.wikipedia.org/wiki/ReactOS', extract: 'ReactOS is a free operating system compatible with Windows Server 2003.' },
      { title: 'React (software)', index: 2, fullurl: 'https://en.wikipedia.org/wiki/React_(software)', extract: 'React is a JavaScript library for building user interfaces based on components. React Server Components render on the server.' },
      { title: 'Empty', index: 3, fullurl: 'https://en.wikipedia.org/wiki/Empty', extract: '' },
      { title: 'Bad URL', index: 4, fullurl: 'javascript:alert(1)', extract: 'React server components' },
    ],
  },
};

await test('Wikipedia parser: drops loose matches, empty extracts and unsafe URLs', () => {
  const parsed = parseWikipediaResponse(WIKI_FIXTURE, 'React server components');
  assert.deepEqual(parsed.map((r) => r.url), ['https://en.wikipedia.org/wiki/React_(software)']);
  assert.equal(parsed[0].title, 'React (software) - Wikipedia');
  assert.match(parsed[0].content, /Server Components render on the server/);
  assert.deepEqual(parseWikipediaResponse({ nope: true }, 'x'), []);
  assert.deepEqual(parseWikipediaResponse(null, 'x'), []);
});

await test('Keyless search: when DuckDuckGo and Bing are blocked, Wikipedia still returns citable content', async () => {
  await withEnv({ VERCEL_ENV: 'production', OPENCONVO_HOSTED_FREE: undefined, SEARXNG_URL: undefined }, async () => {
    installFetch(({ url }) => {
      if (url.startsWith('https://en.wikipedia.org/w/api.php')) return Response.json(WIKI_FIXTURE);
      return new Response('Forbidden', { status: 403 });
    });
    const response = await searchWeb('React server components rc4-unique', null, 'search');
    assert.equal(response.provider, 'wikipedia');
    assert.equal(response.results[0].url, 'https://en.wikipedia.org/wiki/React_(software)');
    const wikiCall = upstreamCalls.find((c) => c.url.includes('wikipedia.org'));
    const params = new URL(wikiCall.url).searchParams;
    assert.equal(params.get('gsrsearch'), 'React server components rc4-unique');
    assert.equal(params.get('explaintext'), '1');
  });
});

globalThis.fetch = realFetch;
const failed = results.filter((r) => !r.ok);
console.log(`\nRC-4 tests: ${results.length - failed.length} passed, ${failed.length} failed.`);
if (failed.length) process.exit(1);
