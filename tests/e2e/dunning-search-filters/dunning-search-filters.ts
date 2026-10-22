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

/** The rows of "In dunning now". */
export function dunningCardRows(page: Page) {
  return dunningCard(page).getByRole('table').locator('tbody').getByRole('row');
}

/** The member ids the rows of "In dunning now" link to, top to bottom. */
export async function dunningCardMemberIds(page: Page): Promise<string[]> {
  const hrefs = await dunningCardRows(page)
    .locator('td:first-child a')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  return hrefs.map((href) => href.replace('/app/members/', ''));
}

/** The line under the toolbar saying how many charges and members match. */
export function dunningCountLine(page: Page) {
  return dunningCard(page).getByText(/matching charges? · /);
}

/** Type a term into the card's search field and press Enter. */
export async function searchDunning(page: Page, term: string): Promise<void> {
  const field = dunningCard(page).getByRole('searchbox', { name: 'Search members in dunning' });
  await field.fill(term);
  await field.press('Enter');
  await expect(page).toHaveURL(new RegExp(`[?&]q=${encodeURIComponent(term.trim()).replace(/%20/g, '(\\+|%20)')}`));
}

export interface DunningMember {
  readonly memberId: string;
  readonly name: string;
  readonly email: string;
  readonly cardId: string | null;
  /** The member's charges in open dunning. */
  readonly charges: number;
}

/** A member of the tenant with at least one charge in open dunning, the one with the newest attempt. */
export function memberInOpenDunning(tenantName: string): DunningMember {
  return withDb((db) => {
    const row = db
      .prepare(
        `select m.id as memberId, m.name, m.email, m.card_id as cardId,
                (select count(*) from charges c2
                  where c2.member_id = m.id and c2.status in ('retrying', 'abandoned')) as charges
           from charges c
           join members m on m.id = c.member_id
           join tenants t on t.id = c.tenant_id
          where t.name = ? and c.status in ('retrying', 'abandoned')
          order by c.attempted_at desc, c.id desc
          limit 1`,
      )
      .get(tenantName) as DunningMember | undefined;
    if (row === undefined) throw new Error(`Nobody at ${tenantName} is in open dunning`);
    return row;
  });
}

/**
 * The member with a card number whose abandoned charge is the oldest in open
 * dunning and who has no charge among the 8 newest, so the unfiltered card
 * does not show them.
 */
export function memberWithOldAbandonedCharge(tenantName: string): DunningMember & { readonly cardId: string } {
  return withDb((db) => {
    const row = db
      .prepare(
        `select m.id as memberId, m.name, m.email, m.card_id as cardId,
                (select count(*) from charges c2
                  where c2.member_id = m.id and c2.status in ('retrying', 'abandoned')) as charges,
                (select count(*) from charges c3
                  where c3.tenant_id = c.tenant_id and c3.status in ('retrying', 'abandoned')
                    and (c3.attempted_at > c.attempted_at or (c3.attempted_at = c.attempted_at and c3.id > c.id))) as newer
           from charges c
           join members m on m.id = c.member_id
           join tenants t on t.id = c.tenant_id
          where t.name = ? and c.status = 'abandoned' and m.card_id is not null
            and m.id not in (
              select c4.member_id from charges c4
               where c4.tenant_id = c.tenant_id and c4.status in ('retrying', 'abandoned')
               order by c4.attempted_at desc, c4.id desc limit 8)
          order by c.attempted_at asc, c.id asc
          limit 1`,
      )
      .get(tenantName) as (DunningMember & { cardId: string; newer: number }) | undefined;
    if (row === undefined || row.newer < 8) throw new Error(`No abandoned charge older than the 8 newest at ${tenantName}`);
    return row;
  });
}
