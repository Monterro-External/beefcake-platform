/**
 * Class bookings and the waitlist.
 *
 * A class has a capacity. Bookings beyond capacity go on the waitlist with a
 * position, first come first served. When a booked member cancels, or capacity
 * is raised, the waitlist promotes from position 1 upwards.
 *
 * A promotion is not just a status change. A member on the waitlist for the
 * 18:00 spin class has usually booked the 18:15 circuit class as a fallback, so
 * promoting them has to release that fallback booking, otherwise the site
 * manager sees a class that looks full but half the room does not turn up. The
 * two effects are computed together in `planPromotions` precisely so they
 * cannot drift apart.
 */

export type BookingStatus = 'booked' | 'waitlisted' | 'cancelled' | 'attended' | 'no_show';

export interface BookingSnapshot {
  readonly id: string;
  readonly classId: string;
  readonly memberId: string;
  readonly status: BookingStatus;
  /** Waitlist position, 1-based. Null for booked members. */
  readonly position: number | null;
  readonly createdAt: string;
}

export interface ClassSnapshot {
  readonly id: string;
  readonly siteId: string;
  readonly name: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly capacity: number;
}

export function bookedCount(bookings: readonly BookingSnapshot[]): number {
  return bookings.filter((b) => b.status === 'booked' || b.status === 'attended').length;
}

export function waitlist(bookings: readonly BookingSnapshot[]): BookingSnapshot[] {
  return bookings
    .filter((b) => b.status === 'waitlisted')
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.createdAt.localeCompare(b.createdAt));
}

export function freeSpots(klass: ClassSnapshot, bookings: readonly BookingSnapshot[]): number {
  return Math.max(0, klass.capacity - bookedCount(bookings));
}

/** Where a new booking lands: straight in, or at the end of the waitlist. */
export function placeBooking(
  klass: ClassSnapshot,
  bookings: readonly BookingSnapshot[],
): { status: 'booked'; position: null } | { status: 'waitlisted'; position: number } {
  if (freeSpots(klass, bookings) > 0) return { status: 'booked', position: null };
  return { status: 'waitlisted', position: waitlist(bookings).length + 1 };
}

/** Close the gaps after someone leaves the waitlist, so positions stay 1..n. */
export function renumberWaitlist(bookings: readonly BookingSnapshot[]): Array<{ bookingId: string; position: number }> {
  return waitlist(bookings).map((b, i) => ({ bookingId: b.id, position: i + 1 }));
}

export function overlaps(a: ClassSnapshot, b: ClassSnapshot): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

export interface Promotion {
  readonly bookingId: string;
  readonly memberId: string;
  readonly classId: string;
  /** Fallback bookings this member holds that clash with the promoted class. */
  readonly releases: readonly string[];
}

export interface PromotionPlan {
  readonly promotions: readonly Promotion[];
  /** New waitlist positions for whoever is left, after the promotions. */
  readonly renumbered: readonly { bookingId: string; position: number }[];
  readonly spotsFilled: number;
}

export interface PromotionInput {
  readonly klass: ClassSnapshot;
  /** Every booking on the class being promoted into. */
  readonly bookings: readonly BookingSnapshot[];
  /** Other bookings held by the waitlisted members, any class. */
  readonly otherBookings: readonly BookingSnapshot[];
  /** Classes referenced by `otherBookings`, keyed by id. */
  readonly otherClasses: Readonly<Record<string, ClassSnapshot>>;
}

/**
 * Decide who gets promoted and what has to be released for it. Pure: the caller
 * applies the result in one transaction (see src/jobs/waitlist-promote.ts).
 */
export function planPromotions(input: PromotionInput): PromotionPlan {
  const { klass, bookings, otherBookings, otherClasses } = input;
  const spots = freeSpots(klass, bookings);
  const queue = waitlist(bookings);
  const promoted = queue.slice(0, spots);

  const promotions: Promotion[] = promoted.map((booking) => {
    const releases = otherBookings
      .filter(
        (other) =>
          other.memberId === booking.memberId &&
          other.classId !== klass.id &&
          (other.status === 'booked' || other.status === 'waitlisted'),
      )
      .filter((other) => {
        const otherClass = otherClasses[other.classId];
        return otherClass !== undefined && overlaps(klass, otherClass);
      })
      .map((other) => other.id);

    return { bookingId: booking.id, memberId: booking.memberId, classId: klass.id, releases };
  });

  const promotedIds = new Set(promotions.map((p) => p.bookingId));
  const remaining = queue.filter((b) => !promotedIds.has(b.id));

  return {
    promotions,
    renumbered: remaining.map((b, i) => ({ bookingId: b.id, position: i + 1 })),
    spotsFilled: promotions.length,
  };
}

export interface FillRateInput {
  readonly capacity: number;
  readonly attended: number;
  readonly booked: number;
}

export function fillRate(input: FillRateInput): number {
  if (input.capacity === 0) return 0;
  return input.booked / input.capacity;
}

export function noShowRate(input: FillRateInput): number {
  if (input.booked === 0) return 0;
  return Math.max(0, input.booked - input.attended) / input.booked;
}
