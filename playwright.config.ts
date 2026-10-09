import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// The tests start their own server on a port of their own, never a dev server
// that is already running: that one may be another checkout with another
// database, and the tests read the database directly through `withDb`.
const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${port}`;

/**
 * End-to-end flows run against a real dev server and a seeded database. There
 * are deliberately few of them: they cover the paths where several parts have to
 * agree (booking with a waitlist, a payment run, a freeze), and everything else
 * is covered by the unit tests.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // One SQLite file and one dev server: tests share the database, so they run
  // serially. Playwright also recommends one worker on CI for reproducibility.
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI === undefined ? 0 : 2,
  reporter: process.env.CI === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  use: {
    baseURL,
    // Acceptance scenarios record every run through `recordEvidence` instead.
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    // The same file `tests/e2e/helpers.ts` opens. Its own log, so a dev server
    // or Aspire running alongside keeps data/dev.log.
    env: { BEEFCAKE_DB: resolve(process.env.BEEFCAKE_DB ?? 'data/beefcake.db'), DEV_LOG: 'data/e2e-dev.log' },
    timeout: 120_000,
  },
});
