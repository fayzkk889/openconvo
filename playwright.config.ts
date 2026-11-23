import { defineConfig, devices } from '@playwright/test';

/**
 * Browser end-to-end tests. They run the production build (`next start`) and
 * replace /api/config, /api/models, /api/chat and /api/search inside the
 * browser with synthetic responses, so no provider key is needed and no
 * provider is ever called. Run with `npm run test:e2e` (builds first).
 *
 * Uses the locally installed Google Chrome by default; set
 * PLAYWRIGHT_CHANNEL=msedge, or PLAYWRIGHT_CHANNEL=chromium after
 * `npx playwright install chromium`.
 */
const PORT = Number(process.env.E2E_PORT || 3200);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
  },
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/config`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      // Never lend server keys during e2e runs, even if a local .env has them.
      OPENCONVO_HOSTED_FREE: 'off',
    },
  },
});
