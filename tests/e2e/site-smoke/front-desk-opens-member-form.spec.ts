// spec: specs/site-smoke-test-plan.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect } from '../evidence';
import { personaFor, signIn } from '../helpers';

test.describe('Development entry and tenant member workflow', { tag: '@smoke' }, () => {
  test('Front desk opens the new-member form', { tag: '@happy' }, async ({ page, context }) => {
    await signIn(context, personaFor('front_desk', 'Puls Träning').userId);

    await test.step('Navigate to `/app/members`.', async () => {
      await page.goto('/app/members');
      await expect(page).toHaveURL(/\/app\/members/);
      await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible();
      await expect(page.getByRole('link', { name: 'New member' })).toBeVisible();
    });

    await test.step('Choose the New member action.', async () => {
      await page.getByRole('link', { name: 'New member' }).click();
      await expect(page).toHaveURL(/\/app\/members\/new/);
      await expect(page.getByRole('heading', { name: 'New member' })).toBeVisible();
      await expect(page.locator('input[name="name"]')).toBeVisible();
      await expect(page.locator('input[name="email"]')).toBeVisible();
      await expect(page.locator('input[name="phone"]')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign up' })).toBeVisible();
    });
  });
});
