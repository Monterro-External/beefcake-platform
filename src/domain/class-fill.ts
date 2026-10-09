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
 * Pure: rows and `now` in, per-site results out. No clock, no database.
 */

export type ClassFillBookingStatus = 'booked' | 'waitlisted' | 'cancelled' | 'attended' | 'no_show';

export interface ClassFillClass {
  readonly id: string;
  readonly siteId: string;
  readonly siteName: string;
  /** ISO instant. */
  readonly startsAt: string;
  readonly capacity: number;
}

export interface ClassFillBooking {
  readonly classId: string;
  readonly status: ClassFillBookingStatus;
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

/**
 * Every class passed in is counted; the caller has already chosen the window
 * and left out cancelled classes. Capacity is summed per class and bookings
 * per booking, never through one joined row, so capacity is never multiplied by
 * the booking count. Sites come back ordered by name.
 */
export function classFillBySite(
  classList: readonly ClassFillClass[],
  bookingList: readonly ClassFillBooking[],
  now: Date,
): SiteClassFill[] {
  const tallies = new Map<string, Tally>();
  const started = new Map<string, { tally: Tally; started: boolean }>();

  for (const klass of classList) {
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
    started.set(klass.id, { tally, started: Date.parse(klass.startsAt) <= now.getTime() });
  }

  for (const booking of bookingList) {
    const klass = started.get(booking.classId);
    if (klass === undefined) continue;
    const { tally } = klass;
    switch (booking.status) {
      case 'attended':
        tally.attended += 1;
        break;
      case 'no_show':
        tally.noShow += 1;
        break;
      case 'booked':
        if (klass.started) tally.unmarked += 1;
        else tally.upcoming += 1;
        break;
      case 'waitlisted':
        tally.waitlisted += 1;
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
