import type { BrowserContext, Page } from '@playwright/test';
import { expect } from '../evidence';
import { personaFor, signIn, withDb } from '../helpers';

// Shared steps for specs/dunning-search-filters.md.

/** Act as the first user of this role at this tenant and open the overview. */
export async function openOverview(
  page: Page,
  context: BrowserContext,
  role: 'owner' | 'site_manager' | 'front_desk',
  tenantName: string,
): Promise<void> {
  const persona = personaFor(role, tenantName);
  await context.clearCookies();
  await signIn(context, persona.userId);
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: tenantName, level: 1 })).toBeVisible();
}

/** The overview card "In dunning now". */
export function dunningCard(page: Page) {
  return page.locator('section').filter({ has: page.getByRole('heading', { name: 'In dunning now', exact: true }) });
}

/** The member names listed in "In dunning now", top to bottom. */
export async function dunningCardMembers(page: Page): Promise<string[]> {
  const rows = dunningCard(page).getByRole('table').locator('tbody').getByRole('row');
  const names = await rows.locator('td:first-child').allTextContents();
  return names.map((name) => name.trim());
}

/**
 * The member names of the `limit` newest charges in open dunning (every
 * `retrying` and `abandoned` charge of the tenant), newest attempt first.
 */
export function newestInOpenDunning(tenantName: string, limit: number): string[] {
  return withDb((db) =>
    (
      db
        .prepare(
          `select m.name from charges c
             join members m on m.id = c.member_id
             join tenants t on t.id = c.tenant_id
            where t.name = ? and c.status in ('retrying', 'abandoned')
            order by c.attempted_at desc, c.id desc
            limit ?`,
        )
        .all(tenantName, limit) as { name: string }[]
    ).map((row) => row.name),
  );
}
