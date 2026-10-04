import { defineConfig, devices } from '@playwright/test';

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
    baseURL: 'http://127.0.0.1:3000',
    // Acceptance scenarios record every run through `recordEvidence` instead.
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: process.env.CI === undefined,
    timeout: 120_000,
  },
});
