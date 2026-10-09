// spec: specs/first-time-visitor.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect } from '../evidence';
import { withDb } from '../helpers';

test.describe('First-time visitor', { tag: '@registration' }, () => {
  test('Switcher lists the personas and options on every surface', { tag: '@regression' }, async ({ page }) => {
    const admins = withDb((db) => db.prepare("select name from users where role = 'beefcake_admin'").all() as { name: string }[]);
    const puls = withDb(
      (db) =>
        db
          .prepare(
            `select u.name, u.role from users u join tenants t on t.id = u.tenant_id
              where t.name = 'Puls Träning' and u.role in ('owner','site_manager','front_desk')
                and u.name = (select min(v.name) from users v where v.tenant_id = u.tenant_id and v.role = u.role)`,
          )
          .all() as { name: string; role: string }[],
    );
    // The switcher lists one member per tenant, the first by name.
    const member = withDb(
      (db) =>
        db
          .prepare(
            `select u.name from users u join tenants t on t.id = u.tenant_id
              where u.role = 'member' and t.name = 'Puls Träning' order by u.name limit 1`,
          )
          .get() as { name: string },
    );
    const labels = [
      ...admins.map((user) => `${user.name} (beefcake admin)`),
      ...puls.map((user) => `${user.name} (${user.role.replace(/_/g, ' ')})`),
      `${member.name} (member)`,
    ];

    await test.step('Cold open /app, /me and /admin.', async () => {
      expect(admins).toHaveLength(4);
      for (const path of ['/app', '/me', '/admin']) {
        await page.goto(path);
        const switcher = page.getByLabel('Acting as');
        await expect(switcher).toBeVisible();
        for (const label of labels) {
          await expect(switcher.getByRole('option', { name: label, exact: true })).toBeAttached();
        }
      }
    });
  });
});
