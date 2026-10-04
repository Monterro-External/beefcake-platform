// spec: specs/site-smoke-test-plan.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect } from '../evidence';
import { personaFor, signIn } from '../helpers';

test.describe('Development entry and tenant member workflow', { tag: '@smoke' }, () => {
  test('Entry page links to each application surface', { tag: '@happy' }, async ({ page, context }) => {
    await signIn(context, personaFor('front_desk', 'Puls Träning').userId);

    await test.step('Navigate to `/`.', async () => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Beefcake', level: 1 })).toBeVisible();
      await expect(page.getByRole('link', { name: /Tenant app/ })).toBeVisible();
      await expect(page.getByRole('link', { name: /Member app/ })).toBeVisible();
      await expect(page.getByRole('link', { name: /Beefcake admin/ })).toBeVisible();
    });

    await test.step('Inspect the Local database section.', async () => {
      const state = page.locator('section').filter({ hasText: 'Local database' });
      await expect(state.getByText('Local database')).toBeVisible();
      await expect(state.getByText('Tenants', { exact: true })).toBeVisible();
      await expect(page.getByText('No seeded database found')).toBeHidden();
    });

    await test.step('Open the Tenant app link.', async () => {
      await page.getByRole('link', { name: /Tenant app/ }).click();
      await expect(page).toHaveURL(/\/app/);
    });
  });
});
