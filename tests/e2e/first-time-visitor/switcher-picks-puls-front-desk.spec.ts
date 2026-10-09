// spec: specs/first-time-visitor.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect } from '../evidence';
import { chooseInSwitcher } from '../helpers';

test.describe('First-time visitor', { tag: '@registration' }, () => {
  test('Visitor picks Puls Träning front desk with the switcher', { tag: '@happy' }, async ({ page }) => {
    let name = '';

    await test.step('Open /app with no cookies and choose the Puls Träning front desk in "Acting as".', async () => {
      await page.goto('/app');
      name = await chooseInSwitcher(page, 'Puls Träning', 'front desk');
      await expect(page.getByRole('banner').getByText(`${name} · Front desk`)).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Puls Träning' })).toBeVisible();
      const nav = page.getByRole('navigation');
      await expect(nav.getByRole('link', { name: 'Payments' })).toHaveCount(0);
      await expect(nav.getByRole('link', { name: 'Reports' })).toHaveCount(0);
      await expect(nav.getByRole('link', { name: 'Settings' })).toHaveCount(0);
    });

    await test.step('Reload /app.', async () => {
      await page.goto('/app');
      await expect(page.getByRole('banner').getByText(`${name} · Front desk`)).toBeVisible();
    });
  });
});
