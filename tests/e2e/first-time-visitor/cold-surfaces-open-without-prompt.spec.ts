// spec: specs/first-time-visitor.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect } from '../evidence';

test.describe('First-time visitor', { tag: '@registration' }, () => {
  test('Cold visit to each surface lands without a prompt', { tag: '@regression' }, async ({ page, context }) => {
    await test.step('With no cookies, navigate to /app, /me and /admin in turn.', async () => {
      for (const path of ['/app', '/me', '/admin']) {
        const response = await page.goto(path);
        expect(response?.status()).toBe(200);
        await expect(page).toHaveURL(new RegExp(`${path}$`));
        await expect(page.getByLabel('Acting as')).toBeVisible();
        await expect(page.getByRole('banner').getByText(/ · /).first()).toBeVisible();
      }
      const cookies = await context.cookies();
      expect(cookies.find((cookie) => cookie.name === 'beefcake_dev_persona')).toBeUndefined();
    });
  });
});
