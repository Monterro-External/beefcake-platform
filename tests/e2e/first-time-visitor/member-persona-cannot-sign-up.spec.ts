// spec: specs/first-time-visitor.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect } from '../evidence';
import { withDb } from '../helpers';

test.describe('First-time visitor', { tag: '@registration' }, () => {
  test('Cold visitor as a member sees a not-allowed screen on signup', { tag: '@negative' }, async ({ page }) => {
    // The switcher lists one member per tenant, the first by name.
    const memberName = withDb(
      (db) =>
        (
          db
            .prepare(
              `select u.name from users u join tenants t on t.id = u.tenant_id
                where u.role = 'member' and t.name = 'Puls Träning' order by u.name limit 1`,
            )
            .get() as { name: string }
        ).name,
    );

    await test.step('Cold open /app, choose the Puls Träning member, then go to /app/members/new.', async () => {
      await page.goto('/app');
      await page.getByLabel('Acting as').selectOption({ label: `${memberName} (member)` });
      await expect(page.getByRole('banner').getByText(`${memberName} · Member`)).toBeVisible();
      await page.goto('/app/members/new');
      await expect(page.getByRole('heading', { name: 'New member' })).toBeVisible();
      await expect(page.getByText('Not available to your role')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign up' })).toHaveCount(0);
    });
  });
});
