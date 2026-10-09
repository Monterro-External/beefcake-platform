/**
 * Class fill per site: what an owner reads to decide whether to keep a
 * timetable slot. See "Fill rate", "No-show rate" and "Unmarked booking" in
 * docs/domain-glossary.md.
 *
 * Bookings that hold a place split four ways. On a class that has not started
 * they are upcoming. On a class that has started (it starts at or before `now`)
 * they are attended, no-shows, or unmarked when staff never took the roster.
 * Fill rate counts all four against capacity; no-show rate counts only the
 * marked ones, so a roster nobody took never reads as a no-show problem.
 *
 * A class belongs to the window when its site-local day, in its own site's
 * timezone, falls within the window's inclusive local days. A 00:30 class in
 * Stockholm on the 1st belongs to the 1st, though it starts on the 31st in UTC.
 *
 * Pure: rows, the window and `now` in, per-site results out. No clock, no
 * database.
 */

import type { Booking } from '@/db/schema';
import { type PlainDate, type Timezone, localDay } from '@/domain/dates';

/** A booking's status as the schema stores it; the tally handles every one. */
export type ClassFillBookingStatus = Booking['status'];

export interface ClassFillClass {
  readonly id: string;
  readonly siteId: string;
  readonly siteName: string;
  readonly timezone: Timezone;
  /** ISO instant. */
  readonly startsAt: string;
  readonly capacity: number;
}

/** How many bookings on one class have one status. */
export interface ClassFillBookingCount {
  readonly classId: string;
  readonly status: ClassFillBookingStatus;
  readonly count: number;
}

export interface SiteClassFill {
  readonly siteId: string;
  readonly siteName: string;
  readonly classes: number;
  readonly capacity: number;
  /** Places taken: upcoming + unmarked + attended + no-show. */
  readonly booked: number;
  readonly attended: number;
  readonly noShow: number;
  readonly unmarked: number;
  readonly upcoming: number;
  readonly waitlisted: number;
  readonly fillRate: number;
  /** No-shows ÷ (attended + no-shows); null when nothing was marked. */
  readonly noShowRate: number | null;
}

interface Tally {
  siteId: string;
  siteName: string;
  classes: number;
  capacity: number;
  attended: number;
  noShow: number;
  unmarked: number;
  upcoming: number;
  waitlisted: number;
}

/** Inclusive site-local days. */
export interface LocalDayWindow {
  readonly from: PlainDate;
  readonly to: PlainDate;
}

/**
 * Counts the classes whose site-local day falls in `window`; the caller may
 * pass classes either side of it, and has left out cancelled classes. Capacity is summed per class and bookings
 * from their counts per class and status, never through one joined row, so
 * capacity is never multiplied by the booking count. Sites come back ordered by
 * name.
 */
export function tallyClassFill(
  classList: readonly ClassFillClass[],
  bookingCounts: readonly ClassFillBookingCount[],
  window: LocalDayWindow,
  now: Date,
): SiteClassFill[] {
  const tallies = new Map<string, Tally>();
  const byClass = new Map<string, { tally: Tally; started: boolean }>();

  for (const klass of classList) {
    const startsAt = new Date(klass.startsAt);
    const day = localDay(startsAt, klass.timezone);
    if (day < window.from || day > window.to) continue;
    let tally = tallies.get(klass.siteId);
    if (tally === undefined) {
      tally = {
        siteId: klass.siteId,
        siteName: klass.siteName,
        classes: 0,
        capacity: 0,
        attended: 0,
        noShow: 0,
        unmarked: 0,
        upcoming: 0,
        waitlisted: 0,
      };
      tallies.set(klass.siteId, tally);
    }
    tally.classes += 1;
    tally.capacity += klass.capacity;
    byClass.set(klass.id, { tally, started: startsAt.getTime() <= now.getTime() });
  }

  for (const { classId, status, count } of bookingCounts) {
    const klass = byClass.get(classId);
    if (klass === undefined) continue;
    const { tally } = klass;
    switch (status) {
      case 'attended':
        tally.attended += count;
        break;
      case 'no_show':
        tally.noShow += count;
        break;
      case 'booked':
        if (klass.started) tally.unmarked += count;
        else tally.upcoming += count;
        break;
      case 'waitlisted':
        tally.waitlisted += count;
        break;
      case 'cancelled':
        break;
    }
  }

  return [...tallies.values()]
    .sort((a, b) => a.siteName.localeCompare(b.siteName) || a.siteId.localeCompare(b.siteId))
    .map((tally) => {
      const booked = tally.upcoming + tally.unmarked + tally.attended + tally.noShow;
      const marked = tally.attended + tally.noShow;
      return {
        siteId: tally.siteId,
        siteName: tally.siteName,
        classes: tally.classes,
        capacity: tally.capacity,
        booked,
        attended: tally.attended,
        noShow: tally.noShow,
        unmarked: tally.unmarked,
        upcoming: tally.upcoming,
        waitlisted: tally.waitlisted,
        fillRate: tally.capacity === 0 ? 0 : booked / tally.capacity,
        noShowRate: marked === 0 ? null : tally.noShow / marked,
      };
    });
}
