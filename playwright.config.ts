import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end flows run against a real dev server and a seeded database. There
 * are deliberately few of them: they cover the paths where several parts have to
 * agree (booking with a waitlist, a payment run, a freeze), and everything else
 * is covered by the unit tests.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: process.env.CI === undefined ? 'list' : [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: process.env.CI === undefined,
    timeout: 120_000,
  },
});
