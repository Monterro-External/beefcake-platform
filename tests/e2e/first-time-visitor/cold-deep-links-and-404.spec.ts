// spec: specs/first-time-visitor.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect } from '../evidence';

test.describe('First-time visitor', { tag: '@registration' }, () => {
  test('Cold visit to deep links works and unknown paths 404', { tag: '@edge' }, async ({ page }) => {
    await test.step('With no cookies, open /app/members, /me/card and /admin/health.', async () => {
      await page.goto('/app/members');
      await expect(page.getByRole('heading', { name: 'Members', exact: true })).toBeVisible();
      await page.goto('/me/card');
      await expect(page.getByRole('heading', { name: 'Access' })).toBeVisible();
      await page.goto('/admin/health');
      await expect(page.getByRole('heading', { name: 'Fleet health' })).toBeVisible();
    });

    await test.step('Open /nope and /app/members/mem_zzz.', async () => {
      for (const path of ['/nope', '/app/members/mem_zzz']) {
        const response = await page.goto(path);
        expect(response?.status()).toBe(404);
        await expect(page.getByText('This page could not be found.')).toBeVisible();
        await expect(page.getByLabel('Acting as')).toHaveCount(0);
      }
    });
  });
});
