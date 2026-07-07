/**
 * Helpers for the end-to-end tests.
 *
 * These run against a real dev server and a real seeded database, so they need
 * two things the unit tests do not: a way to become a particular persona, and a
 * way to look ids up rather than hardcoding them (the seed is deterministic, but
 * hardcoding ids in tests makes every seed change a test change).
 */

import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';

const DB_PATH = resolve(process.env.BEEFCAKE_DB ?? 'data/beefcake.db');

export function withDb<T>(work: (db: Database.Database) => T): T {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    return work(db);
  } finally {
    db.close();
  }
}

export function seededToday(): string {
  return withDb((db) => (db.prepare('select today from seed_meta').get() as { today: string }).today);
}

export interface Persona {
  readonly userId: string;
  readonly tenantId: string;
  readonly tenantName: string;
}

/** A user of a given role at a given tenant, looked up rather than hardcoded. */
export function personaFor(role: string, tenantName: string): Persona {
  return withDb((db) => {
    const row = db
      .prepare(
        `select u.id as userId, t.id as tenantId, t.name as tenantName
           from users u join tenants t on t.id = u.tenant_id
          where u.role = ? and t.name = ?
          order by u.id limit 1`,
      )
      .get(role, tenantName) as Persona | undefined;
    if (row === undefined) throw new Error(`No ${role} at ${tenantName} in the seeded database`);
    return row;
  });
}

export function beefcakeStaff(): { userId: string } {
  return withDb((db) => {
    const row = db
      .prepare("select id as userId from users where role = 'beefcake_admin' order by id limit 1")
      .get() as { userId: string } | undefined;
    if (row === undefined) throw new Error('No Beefcake staff in the seeded database');
    return row;
  });
}

/** Act as this user for the rest of the test. */
export async function signIn(context: BrowserContext, userId: string): Promise<void> {
  await context.addCookies([
    {
      name: 'beefcake_dev_user',
      value: userId,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

/**
 * A member who is active, has a card and is not mid-freeze or mid-notice, so a
 * test can freeze or cancel them without fighting the existing state.
 */
export function cleanMember(tenantId: string): { memberId: string; subscriptionId: string; name: string } {
  return withDb((db) => {
    const row = db
      .prepare(
        `select m.id as memberId, s.id as subscriptionId, m.name
           from members m join subscriptions s on s.member_id = m.id
          where m.tenant_id = ?
            and m.status = 'active'
            and s.status = 'active'
            and s.cancelled_on is null
            and s.binding_until is null
            and m.card_id is not null
            and s.id not in (select subscription_id from freezes where ends_on >= date('now', '-400 day'))
          order by m.id limit 1`,
      )
      .get(tenantId) as { memberId: string; subscriptionId: string; name: string } | undefined;
    if (row === undefined) throw new Error(`No unencumbered member at ${tenantId}`);
    return row;
  });
}

export interface ClassRef {
  readonly classId: string;
  readonly name: string;
  readonly siteId: string;
}

/**
 * An upcoming class the given member can actually book: at a site their plan
 * covers, not already booked by them, and either with room or full depending on
 * `wants`. Scoped to the member because a class at another site never appears on
 * their schedule, and a test that clicks a row that is not there fails for the
 * wrong reason.
 */
export function classFor(memberId: string, wants: 'room' | 'full'): ClassRef {
  return withDb((db) => {
    const comparison = wants === 'room' ? '<' : '>=';
    const row = db
      .prepare(
        `select c.id as classId, c.name, c.site_id as siteId
           from classes c
           join members m on m.id = ?
           join subscriptions s on s.member_id = m.id
           join plans p on p.id = s.plan_id
          where c.tenant_id = m.tenant_id
            and c.cancelled = 0
            and (p.sites_scope = 'all_sites' or c.site_id = m.home_site_id)
            and c.starts_at > (select today from seed_meta) || 'T23:59:59.999Z'
            and not exists (
              select 1 from bookings b
               where b.class_id = c.id and b.member_id = m.id and b.status != 'cancelled'
            )
            and (
              select count(*) from bookings b
               where b.class_id = c.id and b.status in ('booked','attended','no_show')
            ) ${comparison} c.capacity
          order by c.starts_at limit 1`,
      )
      .get(memberId) as ClassRef | undefined;
    if (row === undefined) {
      throw new Error(`No upcoming ${wants === 'room' ? 'available' : 'full'} class for ${memberId}`);
    }
    return row;
  });
}

export function memberLogin(tenantName: string): { userId: string; memberId: string; tenantId: string } {
  return withDb((db) => {
    const row = db
      .prepare(
        `select u.id as userId, u.member_id as memberId, t.id as tenantId
           from users u join tenants t on t.id = u.tenant_id
           join members m on m.id = u.member_id
          where u.role = 'member' and t.name = ? and m.status = 'active'
          order by u.id limit 1`,
      )
      .get(tenantName) as { userId: string; memberId: string; tenantId: string } | undefined;
    if (row === undefined) throw new Error(`No member login at ${tenantName}`);
    return row;
  });
}

/** Wait for a server action to have re-rendered, by watching for its message. */
export async function expectMessage(page: Page, pattern: RegExp): Promise<void> {
  await page.getByText(pattern).first().waitFor({ state: 'visible', timeout: 15_000 });
}
