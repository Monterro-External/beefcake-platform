// spec: specs/first-time-visitor.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect } from '../evidence';
import { chooseInSwitcher, withDb } from '../helpers';

/**
 * The user a surface lands on with no persona cookie: the first of the role
 * by tenant name, then user name. Mirrors `defaultUser()` in `src/lib/session.ts`
 * (Beefcake staff have no tenant, and SQLite sorts nulls first).
 */
function defaultName(role: string): string {
  return withDb(
    (db) =>
      (
        db
          .prepare(
            `select u.name from users u left join tenants t on t.id = u.tenant_id
              where u.role = ? order by t.name, u.name limit 1`,
          )
          .get(role) as { name: string }
      ).name,
  );
}

test.describe('First-time visitor', { tag: '@registration' }, () => {
  test('Switcher choice stays on its own surface', { tag: '@negative' }, async ({ page }) => {
    const defaults = [
      { path: '/admin', header: `${defaultName('beefcake_admin')} · Beefcake staff` },
      { path: '/me', header: `${defaultName('member')} · Member` },
    ];

    await test.step('Cold open /app, choose the Puls Träning front desk, then open /admin and /me.', async () => {
      await page.goto('/app');
      const name = await chooseInSwitcher(page, 'Puls Träning', 'front desk');
      await expect(page.getByRole('banner').getByText(`${name} · Front desk`)).toBeVisible();

      for (const { path, header } of defaults) {
        await page.goto(path);
        await expect(page.getByLabel('Acting as')).toBeVisible();
        await expect(page.getByRole('banner').getByText(header, { exact: true })).toBeVisible();
        await expect(page.getByRole('banner').getByText(`${name} · Front desk`)).toHaveCount(0);
      }
    });
  });
});
