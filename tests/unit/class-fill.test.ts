/**
 * The class fill report, at its one seam: the report function run against a
 * freshly migrated database. Each test inserts the sites, classes and bookings
 * it needs by hand, because the seed marks every past booking and so cannot
 * supply unmarked rosters.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bookings, classes, members, sites, tenants } from '@/db/schema';
import { tenantScope } from '@/db/repositories/scope';
import * as reports from '@/export/reports';
import { type Timezone, plainDate } from '@/domain/dates';
import { createTestDb, type TestDb } from '../helpers/test-db';

const CREATED = '2026-01-01T00:00:00.000Z';
const WINDOW = { from: plainDate(2026, 9, 1), to: plainDate(2026, 9, 30) };
const NOW = new Date('2026-09-30T12:00:00.000Z');

type BookingStatus = 'booked' | 'waitlisted' | 'cancelled' | 'attended' | 'no_show';

let testDb: TestDb;
let seq = 0;

beforeEach(() => {
  testDb = createTestDb();
  seq = 0;
});

afterEach(() => {
  testDb.cleanup();
});

function tenant(id: string): void {
  testDb.db
    .insert(tenants)
    .values({
      id,
      name: id,
      orgNumber: '556000-0000',
      country: 'SE',
      currency: 'SEK',
      locale: 'sv-SE',
      segment: 'mid',
      planTier: 'growth',
      status: 'active',
      createdAt: CREATED,
    })
    .run();
}

function site(tenantId: string, id: string, name: string, timezone: Timezone = 'Europe/Stockholm'): void {
  testDb.db
    .insert(sites)
    .values({
      id,
      tenantId,
      name,
      timezone,
      addressLine: 'Hornsgatan 1',
      city: 'Stockholm',
      accessProvider: 'access-provider-a',
      openedOn: '2020-01-01',
    })
    .run();
}

/** A class with one booking per status listed, each by its own member. */
function klass(
  tenantId: string,
  siteId: string,
  startsAt: string,
  capacity: number,
  statuses: readonly BookingStatus[],
  options: { cancelled?: boolean } = {},
): void {
  const classId = `cls_${++seq}`;
  testDb.db
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
    const memberId = `mem_${++seq}`;
    testDb.db
      .insert(members)
      .values({
        id: memberId,
        tenantId,
        homeSiteId: siteId,
        name: `Member ${seq}`,
        email: `m${seq}@example.se`,
        phone: '+46700000000',
        status: 'active',
        cardId: null,
        birthYear: 1990,
        joinedOn: '2025-01-01',
        createdAt: CREATED,
      })
      .run();
    testDb.db
      .insert(bookings)
      .values({
        id: `bkg_${++seq}`,
        tenantId,
        classId,
        memberId,
        status,
        position: status === 'waitlisted' ? 1 : null,
        createdAt: CREATED,
        updatedAt: CREATED,
      })
      .run();
  }
}

const times = (n: number, status: BookingStatus): BookingStatus[] => Array.from({ length: n }, () => status);

function report(tenantId: string, now: Date = NOW, window: reports.ReportWindow = WINDOW) {
  return reports.classFillBySite(tenantScope(tenantId, { db: testDb.db }), window, now);
}

describe('class fill report', () => {
  it('counts unmarked bookings apart from attended bookings and no-shows on a partly marked roster', () => {
    tenant('ten_a');
    site('ten_a', 'sit_a', 'Hornstull');
    klass('ten_a', 'sit_a', '2026-09-10T16:00:00.000Z', 10, [
      ...times(4, 'attended'),
      'no_show',
      ...times(3, 'booked'),
    ]);

    expect(report('ten_a')).toEqual([
      {
        siteId: 'sit_a',
        siteName: 'Hornstull',
        classes: 1,
        capacity: 10,
        booked: 8,
        attended: 4,
        noShow: 1,
        unmarked: 3,
        upcoming: 0,
        waitlisted: 0,
        fillRate: 0.8,
        noShowRate: 0.2,
      },
    ]);
  });

  it('gives a site where nothing was marked no no-show rate, while its unmarked bookings still fill places', () => {
    tenant('ten_a');
    site('ten_a', 'sit_a', 'Hornstull');
    klass('ten_a', 'sit_a', '2026-09-10T16:00:00.000Z', 10, times(3, 'booked'));

    const [row] = report('ten_a');
    expect(row).toMatchObject({ booked: 3, unmarked: 3, attended: 0, noShow: 0, fillRate: 0.3 });
    expect(row?.noShowRate).toBeNull();
  });

  it('keeps waitlisted and cancelled bookings out of both the fill rate and the no-show rate', () => {
    tenant('ten_a');
    site('ten_a', 'sit_a', 'Hornstull');
    klass('ten_a', 'sit_a', '2026-09-10T16:00:00.000Z', 4, [
      'attended',
      'no_show',
      ...times(2, 'waitlisted'),
      ...times(3, 'cancelled'),
    ]);

    expect(report('ten_a')[0]).toMatchObject({
      booked: 2,
      waitlisted: 2,
      fillRate: 0.5,
      noShowRate: 0.5,
    });
  });

  it('leaves a cancelled class out of the report', () => {
    tenant('ten_a');
    site('ten_a', 'sit_a', 'Hornstull');
    klass('ten_a', 'sit_a', '2026-09-10T16:00:00.000Z', 10, times(4, 'attended'));
    klass('ten_a', 'sit_a', '2026-09-11T16:00:00.000Z', 20, times(5, 'booked'), { cancelled: true });

    expect(report('ten_a')[0]).toMatchObject({ classes: 1, capacity: 10, booked: 4, unmarked: 0 });
  });

  it('counts bookings on a class later on the last day as upcoming, not unmarked', () => {
    tenant('ten_a');
    site('ten_a', 'sit_a', 'Hornstull');
    klass('ten_a', 'sit_a', '2026-09-30T17:00:00.000Z', 10, times(2, 'booked'));
    klass('ten_a', 'sit_a', '2026-09-30T12:00:00.000Z', 10, times(3, 'booked'));

    expect(report('ten_a')[0]).toMatchObject({
      classes: 2,
      booked: 5,
      upcoming: 2,
      unmarked: 3,
      fillRate: 0.25,
      noShowRate: null,
    });
  });

  it('shows each tenant only its own classes', () => {
    tenant('ten_a');
    tenant('ten_b');
    site('ten_a', 'sit_a', 'Hornstull');
    site('ten_b', 'sit_b', 'Grünerløkka');
    klass('ten_a', 'sit_a', '2026-09-10T16:00:00.000Z', 10, ['attended', 'booked']);
    klass('ten_b', 'sit_b', '2026-09-10T16:00:00.000Z', 30, times(6, 'no_show'));

    expect(report('ten_a').map((row) => [row.siteId, row.capacity, row.booked])).toEqual([['sit_a', 10, 2]]);
    expect(report('ten_b').map((row) => [row.siteId, row.capacity, row.booked])).toEqual([['sit_b', 30, 6]]);
  });

  it('counts a class at 00:30 local time on the first day of the window, and not one at 23:30 the night before', () => {
    tenant('ten_a');
    site('ten_a', 'sit_a', 'Hornstull', 'Europe/Stockholm');
    // 00:30 on 1 September in Stockholm (CEST, UTC+2) is 22:30 UTC on 31 August.
    klass('ten_a', 'sit_a', '2026-08-31T22:30:00.000Z', 10, times(2, 'attended'));
    // 23:30 on 31 August in Stockholm is 21:30 UTC on 31 August.
    klass('ten_a', 'sit_a', '2026-08-31T21:30:00.000Z', 20, times(5, 'attended'));

    expect(report('ten_a')[0]).toMatchObject({ classes: 1, capacity: 10, booked: 2, attended: 2 });
  });

  it('ends the window at local midnight after the last day at a Stockholm site and at a Helsinki site', () => {
    tenant('ten_a');
    site('ten_a', 'sit_s', 'Hornstull', 'Europe/Stockholm');
    site('ten_a', 'sit_h', 'Kallio', 'Europe/Helsinki');
    // Stockholm (UTC+2): 23:30 on 30 September counts; 00:30 on 1 October does not.
    klass('ten_a', 'sit_s', '2026-09-30T21:30:00.000Z', 10, ['attended']);
    klass('ten_a', 'sit_s', '2026-09-30T22:30:00.000Z', 20, ['attended']);
    // Helsinki (UTC+3): 23:30 on 30 September counts; 02:30 on 1 October does
    // not, though it is still 30 September in UTC.
    klass('ten_a', 'sit_h', '2026-09-30T20:30:00.000Z', 12, ['attended']);
    klass('ten_a', 'sit_h', '2026-09-30T23:30:00.000Z', 30, ['attended']);

    const rows = report('ten_a', new Date('2026-10-02T00:00:00.000Z'));
    expect(rows.map((row) => [row.siteName, row.classes, row.capacity])).toEqual([
      ['Hornstull', 1, 10],
      ['Kallio', 1, 12],
    ]);
  });

  it('puts a class at 00:30 local time on 1 March in March, after 29 February in a leap year', () => {
    tenant('ten_a');
    site('ten_a', 'sit_h', 'Kallio', 'Europe/Helsinki');
    // Helsinki in winter is UTC+2: 23:30 on 29 February is 21:30 UTC, and
    // 00:30 on 1 March is 22:30 UTC on 29 February.
    klass('ten_a', 'sit_h', '2028-02-29T21:30:00.000Z', 20, ['attended']);
    klass('ten_a', 'sit_h', '2028-02-29T22:30:00.000Z', 10, ['attended']);

    const now = new Date('2028-04-01T00:00:00.000Z');
    const february = { from: plainDate(2028, 2, 1), to: plainDate(2028, 2, 29) };
    const march = { from: plainDate(2028, 3, 1), to: plainDate(2028, 3, 31) };
    expect(report('ten_a', now, february)[0]).toMatchObject({ classes: 1, capacity: 20 });
    expect(report('ten_a', now, march)[0]).toMatchObject({ classes: 1, capacity: 10 });
  });

  it("counts bookings on a class at 23:30 local time on the window's last day as upcoming, not unmarked", () => {
    tenant('ten_a');
    site('ten_a', 'sit_a', 'Hornstull', 'Europe/Stockholm');
    // 23:30 on 30 September in Stockholm is 21:30 UTC; now is 14:00 local.
    klass('ten_a', 'sit_a', '2026-09-30T21:30:00.000Z', 10, times(4, 'booked'));

    expect(report('ten_a')[0]).toMatchObject({ classes: 1, booked: 4, upcoming: 4, unmarked: 0 });
  });
});
