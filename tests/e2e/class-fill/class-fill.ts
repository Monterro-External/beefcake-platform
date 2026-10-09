import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { personaFor, seededToday, signIn } from '../helpers';
import type { BrowserContext } from '@playwright/test';

// Shared steps for the BCPLA-19 class fill scenarios.

const DB_PATH = resolve(process.env.BEEFCAKE_DB ?? 'data/beefcake.db');
const SITE_NAME = 'Hornstull';

export type Status = 'booked' | 'attended' | 'no_show' | 'waitlisted' | 'cancelled';

export interface FixtureClass {
  /** Days before the seeded today, at 16:00 UTC, so the class has started. */
  readonly daysAgo: number;
  readonly capacity: number;
  readonly statuses: readonly Status[];
}

export interface Hornstull {
  readonly siteId: string;
  remove(): void;
}

function withWritableDb<T>(work: (db: Database.Database) => T): T {
  const db = new Database(DB_PATH);
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  try {
    return work(db);
  } finally {
    db.close();
  }
}

function removeSite(db: Database.Database, siteId: string): void {
  db.prepare('delete from bookings where class_id in (select id from classes where site_id = ?)').run(siteId);
  db.prepare('delete from classes where site_id = ?').run(siteId);
  db.prepare('delete from members where home_site_id = ?').run(siteId);
  db.prepare('delete from sites where id = ?').run(siteId);
}

/**
 * A site Hornstull at the tenant holding only these classes and their bookings,
 * each booking from a member of its own. The seed marks every past booking, so
 * unmarked bookings and a site with nothing marked only exist this way. A
 * Hornstull left behind by an earlier, interrupted run is removed first.
 */
export function addHornstull(tenantName: string, classes: readonly FixtureClass[]): Hornstull {
  const tenantId = personaFor('owner', tenantName).tenantId;
  const today = seededToday();
  const run = `${Date.now()}`;
  const siteId = `sit_e2e_hornstull_${run}`;

  withWritableDb((db) =>
    db.transaction(() => {
      const leftovers = db.prepare('select id from sites where tenant_id = ? and name = ?').all(tenantId, SITE_NAME) as {
        id: string;
      }[];
      for (const leftover of leftovers) removeSite(db, leftover.id);

      db.prepare(
        `insert into sites (id, tenant_id, name, timezone, address_line, city, access_provider, opened_on)
         values (?, ?, ?, 'Europe/Stockholm', 'Hornsgatan 100', 'Stockholm', 'access-provider-a', ?)`,
      ).run(siteId, tenantId, SITE_NAME, today);

      let n = 0;
      classes.forEach((klass, index) => {
        const startsAt = new Date(Date.parse(`${today}T16:00:00.000Z`) - klass.daysAgo * 86_400_000);
        const classId = `cls_e2e_${run}_${index}`;
        db.prepare(
          `insert into classes (id, tenant_id, site_id, name, starts_at, ends_at, capacity, cancelled)
           values (?, ?, ?, 'Spinning 45', ?, ?, ?, 0)`,
        ).run(
          classId,
          tenantId,
          siteId,
          startsAt.toISOString(),
          new Date(startsAt.getTime() + 45 * 60_000).toISOString(),
          klass.capacity,
        );
        for (const status of klass.statuses) {
          n += 1;
          const memberId = `mem_e2e_${run}_${n}`;
          db.prepare(
            `insert into members (id, tenant_id, home_site_id, name, email, phone, status, birth_year, joined_on, created_at)
             values (?, ?, ?, ?, ?, '+46700000000', 'active', 1990, ?, ?)`,
          ).run(memberId, tenantId, siteId, `Hornstull Member ${n}`, `hornstull-${run}-${n}@example.se`, today, startsAt.toISOString());
          db.prepare(
            `insert into bookings (id, tenant_id, class_id, member_id, status, position, created_at, updated_at)
             values (?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            `bkg_e2e_${run}_${n}`,
            tenantId,
            classId,
            memberId,
            status,
            status === 'waitlisted' ? n : null,
            startsAt.toISOString(),
            startsAt.toISOString(),
          );
        }
      });
    })(),
  );

  return { siteId, remove: () => withWritableDb((db) => db.transaction(() => removeSite(db, siteId))()) };
}

export async function openClassFillReport(page: Page, context: BrowserContext, tenantName: string): Promise<void> {
  await signIn(context, personaFor('owner', tenantName).userId);
  await page.goto('/app/reports?days=30');
}

/** The cell under `header` in the site's row of the class fill report. */
export async function classFillCell(page: Page, siteName: string, header: string): Promise<Locator> {
  const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Class fill by site' }) });
  const headers = await card.getByRole('columnheader').allTextContents();
  const index = headers.findIndex((text) => text.trim() === header);
  if (index < 0) throw new Error(`No "${header}" column in the class fill report: ${headers.join(', ')}`);
  return card.getByRole('row').filter({ hasText: siteName }).getByRole('cell').nth(index);
}
