import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { test as base } from '@playwright/test';
import { seededToday, withDb } from '../helpers';

/**
 * The Hornstull fixture for specs/class-fill.md.
 *
 * Each class fill scenario needs a site whose only classes are the ones it
 * describes, with rosters the seed never produces (the seed marks every past
 * booking). This adds a site Hornstull (Europe/Stockholm) to Puls Träning with
 * exactly those classes and bookings, placed relative to the seeded today, and
 * removes it, its classes, bookings and members afterwards.
 *
 * Use the `hornstull` fixture from `test` below, which removes the site when
 * the test ends, pass or fail. `addHornstull` and `removeHornstull` are the
 * same steps for callers outside a test.
 */

export const HORNSTULL = {
  tenantName: 'Puls Träning',
  siteId: 'sit_e2ehornstull',
  name: 'Hornstull',
  timezone: 'Europe/Stockholm',
} as const;

const PREFIX = 'e2ehst';

export interface HornstullClass {
  /** Days before the seeded today, on Hornstull's local calendar. 0 is today. */
  readonly daysAgo: number;
  /** Local wall-clock start at Hornstull, 'HH:MM'. Defaults to '18:00'. */
  readonly at?: string;
  readonly capacity: number;
  readonly attended?: number;
  readonly noShow?: number;
  /**
   * Bookings still `booked`: unmarked on a class that has started, upcoming on
   * one that has not.
   */
  readonly unmarked?: number;
  readonly waitlisted?: number;
  readonly cancelled?: number;
  /** A class the gym called off. */
  readonly cancelledClass?: boolean;
}

export interface Hornstull {
  readonly tenantId: string;
  readonly siteId: string;
  readonly name: string;
  readonly timezone: string;
  /** One per class asked for, in order, with the instant it starts. */
  readonly classes: readonly { readonly id: string; readonly startsAt: string }[];
}

const DB_PATH = resolve(process.env.BEEFCAKE_DB ?? 'data/beefcake.db');

function withWritableDb<T>(work: (db: Database.Database) => T): T {
  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  try {
    return db.transaction(() => work(db))();
  } finally {
    db.close();
  }
}

/** Add Hornstull to Puls Träning with only these classes. Replaces any earlier Hornstull. */
export function addHornstull(classes: readonly HornstullClass[]): Hornstull {
  removeHornstull();
  const tenantId = withDb(
    (db) =>
      (db.prepare('select id from tenants where name = ?').get(HORNSTULL.tenantName) as { id: string } | undefined)
        ?.id,
  );
  if (tenantId === undefined) throw new Error(`No tenant ${HORNSTULL.tenantName}; run npm run db:reset -- --scale small`);
  const today = seededToday();
  const createdAt = `${addDays(today, -60)}T08:00:00.000Z`;

  return withWritableDb((db) => {
    db.prepare(
      `insert into sites (id, tenant_id, name, timezone, address_line, city, access_provider, opened_on)
       values (?, ?, ?, ?, 'Hornsgatan 140', 'Stockholm', 'access-provider-a', ?)`,
    ).run(HORNSTULL.siteId, tenantId, HORNSTULL.name, HORNSTULL.timezone, addDays(today, -365));

    const insertClass = db.prepare(
      `insert into classes (id, tenant_id, site_id, name, instructor_id, starts_at, ends_at, capacity, cancelled)
       values (?, ?, ?, 'Spinning 45', null, ?, ?, ?, ?)`,
    );
    const insertMember = db.prepare(
      `insert into members (id, tenant_id, home_site_id, name, email, phone, status, card_id, birth_year, joined_on, created_at)
       values (?, ?, ?, ?, ?, '+46700000000', 'active', null, 1990, ?, ?)`,
    );
    const insertBooking = db.prepare(
      `insert into bookings (id, tenant_id, class_id, member_id, status, position, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    // Each class's bookings are by distinct members; reuse them across classes.
    const memberIds: string[] = [];
    const member = (index: number): string => {
      while (memberIds.length <= index) {
        const n = memberIds.length + 1;
        const id = `mem_${PREFIX}_${n}`;
        insertMember.run(id, tenantId, HORNSTULL.siteId, `Hornstull Medlem ${n}`, `hornstull${n}@example.se`, addDays(today, -60), createdAt);
        memberIds.push(id);
      }
      return memberIds[index] as string;
    };

    let bookingSeq = 0;
    const out: { id: string; startsAt: string }[] = [];
    classes.forEach((klass, classIndex) => {
      const id = `cls_${PREFIX}_${classIndex + 1}`;
      const startsAt = localInstant(addDays(today, -klass.daysAgo), klass.at ?? '18:00', HORNSTULL.timezone);
      const endsAt = new Date(Date.parse(startsAt) + 45 * 60_000).toISOString();
      insertClass.run(id, tenantId, HORNSTULL.siteId, startsAt, endsAt, klass.capacity, klass.cancelledClass === true ? 1 : 0);

      const statuses: [string, number][] = [
        ['attended', klass.attended ?? 0],
        ['no_show', klass.noShow ?? 0],
        ['booked', klass.unmarked ?? 0],
        ['waitlisted', klass.waitlisted ?? 0],
        ['cancelled', klass.cancelled ?? 0],
      ];
      let seat = 0;
      let position = 0;
      for (const [status, n] of statuses) {
        for (let i = 0; i < n; i += 1) {
          bookingSeq += 1;
          insertBooking.run(
            `bkg_${PREFIX}_${bookingSeq}`,
            tenantId,
            id,
            member(seat),
            status,
            status === 'waitlisted' ? ++position : null,
            createdAt,
            createdAt,
          );
          seat += 1;
        }
      }
      out.push({ id, startsAt });
    });

    return { tenantId, siteId: HORNSTULL.siteId, name: HORNSTULL.name, timezone: HORNSTULL.timezone, classes: out };
  });
}

/** Remove Hornstull and everything the fixture added for it. Safe to call when it is absent. */
export function removeHornstull(): void {
  withWritableDb((db) => {
    db.prepare(
      `delete from bookings where class_id in (select id from classes where site_id = ?)
          or member_id in (select id from members where home_site_id = ?)`,
    ).run(HORNSTULL.siteId, HORNSTULL.siteId);
    db.prepare('delete from classes where site_id = ?').run(HORNSTULL.siteId);
    db.prepare('delete from members where home_site_id = ?').run(HORNSTULL.siteId);
    db.prepare('delete from sites where id = ?').run(HORNSTULL.siteId);
  });
}

/**
 * `test` with a `hornstull` fixture: call it with the classes a scenario
 * describes; the site is removed when the test ends.
 */
export const test = base.extend<{ hornstull: (classes: readonly HornstullClass[]) => Hornstull }>({
  hornstull: async ({}, provide) => {
    let added = false;
    await provide((classes) => {
      added = true;
      return addHornstull(classes);
    });
    if (added) removeHornstull();
  },
});

/** 'YYYY-MM-DD' plus a number of days. */
function addDays(day: string, days: number): string {
  const at = new Date(`${day}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** The instant at which the wall clock in `timeZone` reads `day` `time`. */
export function localInstant(day: string, time: string, timeZone: string): string {
  const wall = Date.parse(`${day}T${time}:00.000Z`);
  let at = wall - offsetMinutes(wall, timeZone) * 60_000;
  // Around a daylight-saving change the first guess can sit on the other side.
  at = wall - offsetMinutes(at, timeZone) * 60_000;
  return new Date(at).toISOString();
}

function offsetMinutes(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(at));
  const part = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  return (asUtc - at) / 60_000;
}
