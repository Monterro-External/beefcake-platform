import { expect, test } from '@playwright/test';
import { personaFor, signIn, withDb } from './helpers';

/**
 * The persona switcher is development-only, but it is used all day, and one
 * wrong turn here means every other end-to-end test signs in as the wrong
 * person. Two things have to hold: a persona chosen on one surface stays on
 * that surface, and a surface with no persona lands on someone who belongs there.
 */
test.describe('personas are per surface', () => {
  test('picking a member in the member app leaves the tenant app signed in as the owner', async ({
    page,
    context,
  }) => {
    const owner = personaFor('owner', 'Puls Träning');
    const ownerName = withDb(
      (db) => (db.prepare('select name from users where id = ?').get(owner.userId) as { name: string }).name,
    );
    // The switcher lists one member per tenant, the first by name, so pick that one.
    const memberName = withDb(
      (db) =>
        (
          db
            .prepare(
              `select u.name from users u join tenants t on t.id = u.tenant_id
                where u.role = 'member' and t.name = ? order by u.name limit 1`,
            )
            .get('Puls Träning') as { name: string }
        ).name,
    );
    await signIn(context, owner.userId);

    await page.goto('/me');
    await expect(page.getByText('Not signed in as a member')).toBeVisible();
    await page.getByLabel('Acting as').selectOption({ label: `${memberName} (member)` });
    await expect(page.getByRole('banner').getByText(`${memberName} · Member`)).toBeVisible({ timeout: 15_000 });

    // The other tab: still the owner.
    await page.goto('/app');
    await expect(page.getByRole('banner').getByText(`${ownerName} · Owner`)).toBeVisible();

    // And the member app remembers its own choice.
    await page.goto('/me');
    await expect(page.getByRole('banner').getByText(`${memberName} · Member`)).toBeVisible();
  });

  test('a surface with no persona defaults to someone who belongs there', async ({ page, context }) => {
    await context.clearCookies();

    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Tenants' })).toBeVisible();

    await page.goto('/me');
    await expect(page.getByRole('heading', { name: /^Hej / })).toBeVisible();

    await page.goto('/app');
    await expect(page.getByRole('banner').getByText(/ · Owner$/)).toBeVisible();
  });
});
