// spec: specs/first-time-visitor.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect } from '../evidence';
import { chooseInSwitcher } from './switcher';
import { withDb } from '../helpers';

test.describe('First-time visitor', { tag: '@registration' }, () => {
  test('Signup rejects an existing Puls Träning email', { tag: '@error' }, async ({ page }) => {
    const existing = withDb(
      (db) =>
        db
          .prepare(
            `select m.email from members m join tenants t on t.id = m.tenant_id
              where t.name = 'Puls Träning' and m.status = 'active' limit 1`,
          )
          .get() as { email: string },
    );

    await test.step('Cold open /app and pick the Puls Träning front desk via the switcher.', async () => {
      await page.goto('/app');
      const name = await chooseInSwitcher(page, 'Puls Träning', 'front desk');
      await expect(page.getByRole('banner').getByText(`${name} · Front desk`)).toBeVisible();
    });

    await test.step('Fill the form with an existing member email and submit.', async () => {
      await page.goto('/app/members/new');
      await page.getByLabel('Name').fill('Duplicate Person');
      await page.getByLabel('Email').fill(existing.email);
      await page.getByRole('button', { name: 'Sign up' }).click();
      await expect(page.getByText('Somebody at this gym already uses that email address.')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'New member' })).toBeVisible();
    });
  });
});
