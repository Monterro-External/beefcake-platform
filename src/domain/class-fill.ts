/**
 * Class fill: how full a site's classes were, and how often a member with a
 * place did not turn up. Pure: the classes, their booking counts and the
 * instant come in, one row per site goes out.
 *
 * Vocabulary from docs/domain-glossary.md. A place is taken by every booking
 * that holds one: upcoming (class not started), unmarked (class started,
 * attendance never recorded), attended or a no-show. Waitlisted and cancelled
 * bookings hold no place. The no-show rate is no-shows over attended plus
 * no-shows, and a site that marked nothing has none, rather than a rate of zero.
 */

export interface ClassFillInput {
  readonly siteId: string;
  readonly siteName: string;
  readonly startsAt: string;
  readonly capacity: number;
  /** Bookings by status on this class. Still `booked` is upcoming or unmarked, by `now`. */
  readonly stillBooked: number;
  readonly attended: number;
  readonly noShow: number;
  readonly waitlisted: number;
}

export interface ClassFill {
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
  /** Null when the site marked no attendance in the period. */
  readonly noShowRate: number | null;
}

interface Totals {
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

/** One row per site, ordered by site name. */
export function classFill(inputs: readonly ClassFillInput[], now: Date): ClassFill[] {
  const bySite = new Map<string, Totals>();
  for (const input of inputs) {
    const totals = bySite.get(input.siteId) ?? {
      siteId: input.siteId,
      siteName: input.siteName,
      classes: 0,
      capacity: 0,
      attended: 0,
      noShow: 0,
      unmarked: 0,
      upcoming: 0,
      waitlisted: 0,
    };
    const started = Date.parse(input.startsAt) <= now.getTime();
    totals.classes += 1;
    totals.capacity += input.capacity;
    totals.attended += input.attended;
    totals.noShow += input.noShow;
    totals.waitlisted += input.waitlisted;
    if (started) totals.unmarked += input.stillBooked;
    else totals.upcoming += input.stillBooked;
    bySite.set(input.siteId, totals);
  }

  return [...bySite.values()]
    .sort((a, b) => a.siteName.localeCompare(b.siteName))
    .map((totals) => {
      const booked = totals.upcoming + totals.unmarked + totals.attended + totals.noShow;
      const marked = totals.attended + totals.noShow;
      return {
        ...totals,
        booked,
        fillRate: totals.capacity === 0 ? 0 : booked / totals.capacity,
        noShowRate: marked === 0 ? null : totals.noShow / marked,
      };
    });
}
