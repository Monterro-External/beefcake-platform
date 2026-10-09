/**
 * The class fill report, on a migrated database holding only the classes and
 * bookings each test inserts. An owner keeps or drops a timetable slot on these
 * numbers, so every count is checked against a hand-worked example.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Connection } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { bookings, classes, members, sites, tenants } from '@/db/schema';
import { tenantScope } from '@/db/repositories/scope';
import { classFillBySite } from '@/export/reports';
import { plainDate } from '@/domain/dates';

type Status = (typeof bookings.$inferInsert)['status'];

let dir: string;
let connection: Connection;
let sequence = 0;

const WINDOW = { from: plainDate(2026, 9, 1), to: plainDate(2026, 9, 30) };
const NOW = new Date('2026-09-30T20:00:00.000Z');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'beefcake-class-fill-'));
  const path = join(dir, 'class-fill.db');
  runMigrations(path);
  connection = openDatabase(path);
});

afterEach(() => {
  connection.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

function tenant(name: string): string {
  const id = `ten_${name.toLowerCase().replace(/\W/g, '')}`;
  connection.db
    .insert(tenants)
    .values({
      id,
      name,
      orgNumber: '556000-0000',
      country: 'SE',
      currency: 'SEK',
      locale: 'sv-SE',
      segment: 'mid',
      planTier: 'growth',
      createdAt: '2025-01-01T09:00:00.000Z',
    })
    .run();
  return id;
}

function site(tenantId: string, name: string): string {
  const id = `sit_${name.toLowerCase()}`;
  connection.db
    .insert(sites)
    .values({
      id,
      tenantId,
      name,
      timezone: 'Europe/Stockholm',
      addressLine: 'Hornsgatan 1',
      city: 'Stockholm',
      accessProvider: 'access-provider-a',
      openedOn: '2025-01-01',
    })
    .run();
  return id;
}

/** A class at `startsAt` with one booking per status listed. */
function klass(
  tenantId: string,
  siteId: string,
  startsAt: string,
  capacity: number,
  statuses: readonly Status[],
  options: { cancelled?: boolean } = {},
): string {
  sequence += 1;
  const classId = `cls_${sequence}`;
  connection.db
    .insert(classes)
    .values({
      id: classId,
      tenantId,
      siteId,
      name: 'Spinning 45',
      startsAt,
      endsAt: new Date(Date.parse(startsAt) + 45 * 60_000).toISOString(),
      capacity,
      cancelled: options.cancelled ?? false,
    })
    .run();
  for (const status of statuses) {
    sequence += 1;
    const memberId = `mem_${sequence}`;
    connection.db
      .insert(members)
      .values({
        id: memberId,
        tenantId,
        homeSiteId: siteId,
        name: `Member ${sequence}`,
        email: `member${sequence}@example.se`,
        phone: '+46700000000',
        status: 'active',
        birthYear: 1990,
        joinedOn: '2025-01-01',
        createdAt: '2025-01-01T09:00:00.000Z',
      })
      .run();
    connection.db
      .insert(bookings)
      .values({
        id: `bkg_${sequence}`,
        tenantId,
        classId,
        memberId,
        status,
        position: status === 'waitlisted' ? 1 : null,
        createdAt: '2026-09-01T09:00:00.000Z',
        updatedAt: '2026-09-01T09:00:00.000Z',
      })
      .run();
  }
  return classId;
}

function fill(tenantId: string) {
  return classFillBySite(tenantScope(tenantId, { db: connection.db }), WINDOW, NOW);
}

describe('class fill by site', () => {
  it('counts unmarked bookings apart from attended bookings and no-shows', () => {
    const puls = tenant('Puls Träning');
    const hornstull = site(puls, 'Hornstull');
    klass(puls, hornstull, '2026-09-15T16:00:00.000Z', 10, [
      'attended', 'attended', 'attended', 'attended', 'no_show', 'booked', 'booked', 'booked',
    ]);

    expect(fill(puls)).toEqual([
      expect.objectContaining({
        siteName: 'Hornstull',
        classes: 1,
        capacity: 10,
        booked: 8,
        attended: 4,
        noShow: 1,
        unmarked: 3,
        upcoming: 0,
        fillRate: 0.8,
        noShowRate: 0.2,
      }),
    ]);
  });

  it('gives a site that marked no attendance no no-show rate rather than zero', () => {
    const puls = tenant('Puls Träning');
    const hornstull = site(puls, 'Hornstull');
    klass(puls, hornstull, '2026-09-15T16:00:00.000Z', 10, ['booked', 'booked', 'booked']);

    const [row] = fill(puls);
    expect(row).toMatchObject({ booked: 3, unmarked: 3, attended: 0, noShow: 0, fillRate: 0.3 });
    expect(row?.noShowRate).toBeNull();
  });

  it('counts a booking on a class that has not started as upcoming, not unmarked', () => {
    const puls = tenant('Puls Träning');
    const hornstull = site(puls, 'Hornstull');
    klass(puls, hornstull, '2026-09-30T19:59:00.000Z', 10, ['booked']);
    klass(puls, hornstull, '2026-09-30T20:00:00.000Z', 10, ['booked']);
    klass(puls, hornstull, '2026-09-30T20:01:00.000Z', 10, ['booked', 'booked']);

    expect(fill(puls)[0]).toMatchObject({ booked: 4, unmarked: 2, upcoming: 2, noShowRate: null });
  });

  it('keeps waitlisted and cancelled bookings out of both fill and no-show rate', () => {
    const puls = tenant('Puls Träning');
    const hornstull = site(puls, 'Hornstull');
    klass(puls, hornstull, '2026-09-15T16:00:00.000Z', 4, [
      'attended', 'attended', 'attended', 'no_show', 'waitlisted', 'waitlisted', 'cancelled',
    ]);

    expect(fill(puls)[0]).toMatchObject({ booked: 4, waitlisted: 2, fillRate: 1, noShowRate: 0.25 });
  });

  it('leaves cancelled classes out of the report', () => {
    const puls = tenant('Puls Träning');
    const hornstull = site(puls, 'Hornstull');
    klass(puls, hornstull, '2026-09-15T16:00:00.000Z', 10, ['attended', 'attended']);
    klass(puls, hornstull, '2026-09-16T16:00:00.000Z', 20, ['booked', 'no_show'], { cancelled: true });

    expect(fill(puls)[0]).toMatchObject({ classes: 1, capacity: 10, booked: 2, noShowRate: 0 });
  });

  it("never counts another tenant's classes", () => {
    const puls = tenant('Puls Träning');
    const nordic = tenant('Nordic Fitness Group');
    klass(puls, site(puls, 'Hornstull'), '2026-09-15T16:00:00.000Z', 10, ['attended']);
    klass(nordic, site(nordic, 'Kungsholmen'), '2026-09-15T16:00:00.000Z', 30, ['attended', 'no_show']);

    expect(fill(puls)).toEqual([expect.objectContaining({ siteName: 'Hornstull', capacity: 10, booked: 1 })]);
  });
});
