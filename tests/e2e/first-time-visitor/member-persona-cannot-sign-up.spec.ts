// spec: specs/first-time-visitor.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect } from '../evidence';
import { chooseInSwitcher } from '../helpers';

test.describe('First-time visitor', { tag: '@registration' }, () => {
  test('Cold visitor as a member sees a not-allowed screen on signup', { tag: '@negative' }, async ({ page }) => {
    await test.step('Cold open /app, choose the Puls Träning member, then go to /app/members/new.', async () => {
      await page.goto('/app');
      const memberName = await chooseInSwitcher(page, 'Puls Träning', 'member');
      await expect(page.getByRole('banner').getByText(`${memberName} · Member`)).toBeVisible();
      await page.goto('/app/members/new');
      await expect(page.getByRole('heading', { name: 'New member' })).toBeVisible();
      await expect(page.getByText('Not available to your role')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign up' })).toHaveCount(0);
    });
  });
});
