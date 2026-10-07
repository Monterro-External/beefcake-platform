// One-off for BCPLA-9: no-show rate baseline for BCPRO-114, July to September 2026.
// Read-only, cross-tenant (admin read). Run against a seeded database:
//   BEEFCAKE_DB=<path> npx tsx scripts/one-off/no-show-baseline.ts > no-show-baseline.csv
//
// Definitions settled on BCPLA-9:
// - No-show rate = no_show / (attended + no_show). A booking on a started class still
//   `booked` is unmarked (attendance never recorded for it) and is counted on its own.
//   Cancelled and waitlisted bookings are in neither.
// - Month = the class's site-local day, via localDay() with the site timezone.
// - Frequent = the member's marked + unmarked bookings across all the tenant's sites
//   in the quarter, divided by the weeks of the quarter that have classes, is 3 or
//   more. One group per member per tenant. (The seed's timetable starts mid-August,
//   so dividing by a full 13 weeks would understate frequency.)
// - Fleet-wide = every tenant in the database, pooled by booking.
import { openDatabase } from '../../src/db/client';
import { adminScope, classesRepo } from '../../src/db/repositories';
import type { BookingOutcomeRow } from '../../src/db/repositories/classes';
import { type PlainDate, type Timezone, differenceInDays, localDay } from '../../src/domain/dates';

const FROM_DAY: PlainDate = '2026-07-01';
const TO_DAY: PlainDate = '2026-09-30';
const FOCUS = ['Puls Träning', 'Aktiv Hälsa'];

const { db } = openDatabase(process.env.BEEFCAKE_DB ?? 'data/beefcake.db', { readonly: true });

// A day either side of the quarter in UTC, then trimmed by site-local day below.
const rows = classesRepo.allBookingOutcomes(adminScope({ db }), {
  from: '2026-06-30',
  to: '2026-10-02',
});

interface Booking extends BookingOutcomeRow {
  day: PlainDate;
  month: string;
}
const inQuarter: Booking[] = [];
for (const row of rows) {
  const day = localDay(new Date(row.startsAt), row.timezone as Timezone);
  if (day < FROM_DAY || day > TO_DAY) continue;
  inQuarter.push({ ...row, day, month: day.slice(0, 7) });
}

const firstDay = inQuarter.reduce<PlainDate>((min, b) => (b.day < min ? b.day : min), TO_DAY);
const WEEKS = (differenceInDays(TO_DAY, firstDay) + 1) / 7;

const perMember = new Map<string, number>();
for (const b of inQuarter) {
  const key = `${b.tenantId}|${b.memberId}`;
  perMember.set(key, (perMember.get(key) ?? 0) + 1);
}
const groupOf = (b: Booking) =>
  (perMember.get(`${b.tenantId}|${b.memberId}`) ?? 0) / WEEKS >= 3 ? '3+/week' : 'other';

interface Cell {
  attended: number;
  noShow: number;
  unmarked: number;
}
const cells = new Map<string, Cell>();
const add = (key: string, status: string) => {
  const cell = cells.get(key) ?? { attended: 0, noShow: 0, unmarked: 0 };
  if (status === 'attended') cell.attended += 1;
  else if (status === 'no_show') cell.noShow += 1;
  else cell.unmarked += 1;
  cells.set(key, cell);
};

for (const b of inQuarter) {
  const scopes = ['Fleet-wide|(all sites)'];
  if (FOCUS.includes(b.tenantName)) scopes.push(`${b.tenantName}|${b.siteName}`, `${b.tenantName}|(all sites)`);
  for (const scope of scopes) {
    for (const group of [groupOf(b), 'all']) {
      add(`${scope}|${b.month}|${group}`, b.status);
      add(`${scope}|Q3|${group}`, b.status);
    }
  }
}

console.log('tenant,site,month,group,attended,no_show,unmarked,no_show_rate');
for (const key of [...cells.keys()].sort()) {
  const c = cells.get(key)!;
  const marked = c.attended + c.noShow;
  const rate = marked === 0 ? '' : ((100 * c.noShow) / marked).toFixed(1) + '%';
  console.log(`${key.split('|').join(',')},${c.attended},${c.noShow},${c.unmarked},${rate}`);
}
const tenants = new Set(inQuarter.map((b) => b.tenantId)).size;
console.error(
  `tenants: ${tenants}; bookings: ${inQuarter.length}; first class day: ${firstDay}; weeks: ${WEEKS.toFixed(2)}`,
);
