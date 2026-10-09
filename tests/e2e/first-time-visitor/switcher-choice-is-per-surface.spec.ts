// spec: specs/first-time-visitor.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect } from '../evidence';
import { chooseInSwitcher } from './switcher';

test.describe('First-time visitor', { tag: '@registration' }, () => {
  test('Switcher choice stays on its own surface', { tag: '@negative' }, async ({ page }) => {

    await test.step('Cold open /app, choose the Puls Träning front desk, then open /admin and /me.', async () => {
      await page.goto('/app');
      const name = await chooseInSwitcher(page, 'Puls Träning', 'front desk');
      await expect(page.getByRole('banner').getByText(`${name} · Front desk`)).toBeVisible();

      for (const path of ['/admin', '/me']) {
        await page.goto(path);
        await expect(page.getByLabel('Acting as')).toBeVisible();
        await expect(page.getByRole('banner').getByText(`${name} · Front desk`)).toHaveCount(0);
      }
    });
  });
});
