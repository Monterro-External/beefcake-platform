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

export interface OpenDunningCharge {
  readonly memberId: string;
  readonly email: string;
  readonly status: 'retrying' | 'abandoned';
  readonly failureCode: string | null;
  readonly siteId: string;
}

/** Every charge in open dunning at the tenant, with reason and home site, newest attempt first. */
export function openDunningCharges(tenantName: string): OpenDunningCharge[] {
  return withDb(
    (db) =>
      db
        .prepare(
          `select c.member_id as memberId, m.email, c.status, c.failure_code as failureCode, m.home_site_id as siteId
             from charges c
             join members m on m.id = c.member_id
             join tenants t on t.id = c.tenant_id
            where t.name = ? and c.status in ('retrying', 'abandoned')
            order by c.attempted_at desc, c.id desc`,
        )
        .all(tenantName) as OpenDunningCharge[],
  );
}

/** The reasons a charge can fail for, as the chips label them. */
export const REASON_CHIPS = {
  insufficient_funds: 'Insufficient funds',
  mandate_cancelled: 'Mandate cancelled',
  account_closed: 'Account closed',
  technical: 'Technical error',
  rejected_by_bank: 'Rejected by bank',
} as const;

/**
 * A chip in the Status or Reason row of "In dunning now": a link, or a greyed
 * out label when it would leave nothing.
 */
export function dunningChip(page: Page, row: 'Status' | 'Reason', label: string) {
  return dunningCard(page)
    .getByRole('group', { name: row, exact: true })
    .locator('a, [aria-disabled="true"]')
    .filter({ hasText: new RegExp(`^${label}(\\s|$)`) });
}

/** The count a chip shows, digits only since the tenant locale groups thousands with a space. */
export async function chipCount(page: Page, row: 'Status' | 'Reason', label: string): Promise<number> {
  const text = (await dunningChip(page, row, label).textContent()) ?? '';
  return Number(text.slice(label.length).replace(/\D/g, ''));
}

/** Choose a chip and wait for the address to carry it. */
export async function chooseChip(page: Page, row: 'Status' | 'Reason', label: string, param: string): Promise<void> {
  await dunningChip(page, row, label).click();
  await expect(page).toHaveURL(new RegExp(`[?&]${row.toLowerCase()}=${param}(&|$)`));
  await expect(dunningChip(page, row, label)).toHaveAttribute('aria-current', 'true');
}

/** The status badges of the rows in "In dunning now", top to bottom. */
export async function dunningCardStatuses(page: Page): Promise<string[]> {
  const cells = await dunningCardRows(page).locator('td:last-child').allTextContents();
  return cells.map((cell) => cell.trim());
}

/** The tenant's site with the most charges in open dunning, by its members' home site. */
export function busiestDunningSite(tenantName: string): { id: string; name: string } {
  return withDb((db) => {
    const row = db
      .prepare(
        `select s.id, s.name from charges c
           join members m on m.id = c.member_id
           join sites s on s.id = m.home_site_id
           join tenants t on t.id = c.tenant_id
          where t.name = ? and c.status in ('retrying', 'abandoned')
          group by s.id order by count(*) desc limit 1`,
      )
      .get(tenantName) as { id: string; name: string } | undefined;
    if (row === undefined) throw new Error(`Nobody at ${tenantName} is in open dunning`);
    return row;
  });
}

/** The home site of each member, for checking the listed rows. */
export function homeSites(memberIds: readonly string[]): Map<string, string> {
  return withDb((db) => {
    const lookup = db.prepare('select home_site_id as siteId from members where id = ?');
    return new Map(memberIds.map((id) => [id, (lookup.get(id) as { siteId: string }).siteId]));
  });
}

/** A second user of this role at the tenant: the colleague a link is pasted to. */
export function colleagueOf(role: string, tenantName: string): { userId: string } {
  return withDb((db) => {
    const row = db
      .prepare(
        `select u.id as userId from users u join tenants t on t.id = u.tenant_id
          where u.role = ? and t.name = ? order by u.id limit 1 offset 1`,
      )
      .get(role, tenantName) as { userId: string } | undefined;
    if (row === undefined) throw new Error(`Only one ${role} at ${tenantName}`);
    return row;
  });
}
