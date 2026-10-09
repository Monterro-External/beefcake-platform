// spec: specs/first-time-visitor.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect } from '../evidence';
import { seededToday } from '../helpers';

test.describe('First-time visitor', { tag: '@registration' }, () => {
  test('Cold visitor as default owner can open the signup form', { tag: '@happy' }, async ({ page }) => {
    await test.step('With no cookies, open /app/members/new.', async () => {
      await page.goto('/app/members/new');
      await expect(page.getByRole('heading', { name: 'New member' })).toBeVisible();
      for (const label of ['Name', 'Email', 'Phone', 'Birth year']) {
        await expect(page.getByLabel(label, { exact: true })).toBeVisible();
      }
      await expect(page.getByRole('combobox', { name: 'Home gym' })).toBeVisible();
      await expect(page.getByRole('combobox', { name: 'Plan' })).toBeVisible();
      await expect(page.getByLabel('Issue an access card now')).toBeChecked();
      await expect(page.getByText(`Joining Aktiv Hälsa today, ${seededToday()}`)).toBeVisible();
    });
  });
});
