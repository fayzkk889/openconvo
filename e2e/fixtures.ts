import { test as base, expect, type Page } from '@playwright/test';

/**
 * Synthetic backend for browser tests.
 *
 * /api/chat is replaced in the page by a fetch shim (so responses can stream
 * slowly and honour AbortSignal like a real network stream); /api/config,
 * /api/models and /api/search are fulfilled by Playwright routes. Nothing
 * reaches OpenRouter, Tavily or any other provider, and no key is used.
 */
export type ChatScenario =
  | { kind: 'complete'; text: string }
  | { kind: 'slow'; chunks: string[]; delayMs: number }
  | { kind: 'interrupted'; text: string }
  | { kind: 'error'; message: string };

declare global {
  interface Window {
    __e2eScenario: ChatScenario;
    __e2eChatBodies: Array<Record<string, unknown>>;
  }
}

function chatShim() {
  const encoder = new TextEncoder();
  const realFetch = window.fetch.bind(window);
  window.__e2eScenario = { kind: 'complete', text: 'Synthetic answer.' };
  window.__e2eChatBodies = [];
  const model = 'google/gemma-4-31b-it:free';

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!new URL(url, location.href).pathname.startsWith('/api/chat')) return realFetch(input, init);

    const body = JSON.parse(String(init?.body || '{}'));
    window.__e2eChatBodies.push(body);
    if (body.generateTitleFor) {
      return new Response(JSON.stringify({ title: 'Synthetic chat' }), { headers: { 'Content-Type': 'application/json' } });
    }

    const scenario = window.__e2eScenario;
    if (scenario.kind === 'error') {
      return new Response(JSON.stringify({ error: scenario.message }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }

    const signal = init?.signal;
    const frame = (event: unknown) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        signal?.addEventListener('abort', () => {
          if (closed) return;
          closed = true;
          controller.error(new DOMException('The user aborted a request.', 'AbortError'));
        }, { once: true });
        const send = (event: unknown) => { if (!closed) controller.enqueue(frame(event)); };

        send({ type: 'meta', requestId: 'req_e2e', model, mode: 'hosted-free' });
        if (scenario.kind === 'complete') {
          send({ type: 'delta', content: scenario.text, model });
          send({ type: 'complete', model, finishReason: 'stop' });
        } else if (scenario.kind === 'interrupted') {
          send({ type: 'delta', content: scenario.text, model });
          send({ type: 'interrupted', model, partialContent: scenario.text, reason: 'stream ended without completion marker' });
        } else if (scenario.kind === 'slow') {
          for (const chunk of scenario.chunks) {
            await new Promise((r) => setTimeout(r, scenario.delayMs));
            if (closed) return;
            send({ type: 'delta', content: chunk, model });
          }
          send({ type: 'complete', model, finishReason: 'stop' });
        }
        if (!closed) {
          closed = true;
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  };
}

async function installBackend(page: Page) {
  await page.route('**/api/config', (route) => route.fulfill({
    json: { hostedFreeModeAvailable: true, hostedFreeDailyLimit: 20, hostedSearchAvailable: true, hostedSearchDailyLimit: 15 },
  }));
  await page.route('**/api/models', (route) => route.fulfill({ status: 503, json: { error: 'offline in e2e' } }));
  await page.route('**/api/search', (route) => route.fulfill({
    json: { query: 'e2e', provider: 'e2e', mode: 'search', results: [] },
  }));
  await page.addInitScript(chatShim);
}

export const test = base.extend<{ app: Page }>({
  app: async ({ page }, use) => {
    await installBackend(page);
    await page.goto('/app');
    await page.getByRole('button', { name: 'Start a conversation' }).click();
    await expect(composer(page)).toBeVisible();
    await use(page);
  },
});

export { expect };

export const composer = (page: Page) => page.getByPlaceholder(/Message OpenConvo|Ask a question about the attached document/);
export const assistantMessages = (page: Page) => page.locator('[data-message-role="assistant"]');
export const userMessages = (page: Page) => page.locator('[data-message-role="user"]');

export async function setScenario(page: Page, scenario: ChatScenario) {
  await page.evaluate((s) => { window.__e2eScenario = s; }, scenario);
}

export async function chatBodies(page: Page) {
  return page.evaluate(() => window.__e2eChatBodies.filter((b) => !b.generateTitleFor));
}

export async function send(page: Page, text: string) {
  await composer(page).fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
}
