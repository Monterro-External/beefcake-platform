import { describe, expect, it } from 'vitest';
import {
  type BookingSnapshot,
  type ClassSnapshot,
  bookedCount,
  fillRate,
  freeSpots,
  noShowRate,
  overlaps,
  placeBooking,
  planPromotions,
  renumberWaitlist,
  waitlist,
} from '@/domain/waitlist';

const spin: ClassSnapshot = {
  id: 'cls_spin',
  siteId: 'sit_1',
  name: 'Spinning 45',
  startsAt: '2026-08-27T16:00:00.000Z',
  endsAt: '2026-08-27T16:45:00.000Z',
  capacity: 2,
};

const circuit: ClassSnapshot = {
  id: 'cls_circuit',
  siteId: 'sit_1',
  name: 'Circuit',
  startsAt: '2026-08-27T16:15:00.000Z',
  endsAt: '2026-08-27T17:00:00.000Z',
  capacity: 20,
};

const yoga: ClassSnapshot = {
  id: 'cls_yoga',
  siteId: 'sit_1',
  name: 'Yoga',
  startsAt: '2026-08-27T18:00:00.000Z',
  endsAt: '2026-08-27T19:00:00.000Z',
  capacity: 20,
};

function booking(over: Partial<BookingSnapshot> & { id: string; memberId: string }): BookingSnapshot {
  return {
    classId: spin.id,
    status: 'booked',
    position: null,
    createdAt: '2026-08-20T10:00:00.000Z',
    ...over,
  };
}

describe('counting', () => {
  it('counts booked and attended against capacity, not cancelled', () => {
    const bookings = [
      booking({ id: 'b1', memberId: 'm1' }),
      booking({ id: 'b2', memberId: 'm2', status: 'attended' }),
      booking({ id: 'b3', memberId: 'm3', status: 'cancelled' }),
    ];
    expect(bookedCount(bookings)).toBe(2);
    expect(freeSpots(spin, bookings)).toBe(0);
  });

  it('orders the waitlist by position, then by creation time', () => {
    const bookings = [
      booking({ id: 'b2', memberId: 'm2', status: 'waitlisted', position: 2 }),
      booking({ id: 'b1', memberId: 'm1', status: 'waitlisted', position: 1 }),
    ];
    expect(waitlist(bookings).map((b) => b.id)).toEqual(['b1', 'b2']);
  });
});

describe('placing a booking', () => {
  it('books straight in while there is room', () => {
    expect(placeBooking(spin, [])).toEqual({ status: 'booked', position: null });
  });

  it('waitlists once the class is full, appending to the queue', () => {
    const bookings = [
      booking({ id: 'b1', memberId: 'm1' }),
      booking({ id: 'b2', memberId: 'm2' }),
      booking({ id: 'b3', memberId: 'm3', status: 'waitlisted', position: 1 }),
    ];
    expect(placeBooking(spin, bookings)).toEqual({ status: 'waitlisted', position: 2 });
  });

  it('books into a spot freed by a cancellation', () => {
    const bookings = [
      booking({ id: 'b1', memberId: 'm1' }),
      booking({ id: 'b2', memberId: 'm2', status: 'cancelled' }),
    ];
    expect(placeBooking(spin, bookings)).toEqual({ status: 'booked', position: null });
  });
});

describe('renumbering', () => {
  it('closes the gaps left by someone leaving the queue', () => {
    const bookings = [
      booking({ id: 'b1', memberId: 'm1', status: 'waitlisted', position: 1 }),
      booking({ id: 'b3', memberId: 'm3', status: 'waitlisted', position: 3 }),
      booking({ id: 'b4', memberId: 'm4', status: 'waitlisted', position: 4 }),
    ];
    expect(renumberWaitlist(bookings)).toEqual([
      { bookingId: 'b1', position: 1 },
      { bookingId: 'b3', position: 2 },
      { bookingId: 'b4', position: 3 },
    ]);
  });
});

describe('overlapping classes', () => {
  it('detects a partial overlap', () => {
    expect(overlaps(spin, circuit)).toBe(true);
  });

  it('does not treat back-to-back classes as overlapping', () => {
    const back = { ...circuit, startsAt: spin.endsAt, endsAt: '2026-08-27T17:30:00.000Z' };
    expect(overlaps(spin, back)).toBe(false);
  });

  it('does not treat unrelated slots as overlapping', () => {
    expect(overlaps(spin, yoga)).toBe(false);
  });
});

describe('planning promotions', () => {
  it('promotes nobody when the class is full', () => {
    const bookings = [
      booking({ id: 'b1', memberId: 'm1' }),
      booking({ id: 'b2', memberId: 'm2' }),
      booking({ id: 'b3', memberId: 'm3', status: 'waitlisted', position: 1 }),
    ];
    const plan = planPromotions({ klass: spin, bookings, otherBookings: [], otherClasses: {} });
    expect(plan.promotions).toHaveLength(0);
    expect(plan.renumbered).toEqual([{ bookingId: 'b3', position: 1 }]);
  });

  it('promotes in waitlist order, only as many as there are spots', () => {
    const bookings = [
      booking({ id: 'b1', memberId: 'm1', status: 'cancelled' }),
      booking({ id: 'b2', memberId: 'm2' }),
      booking({ id: 'b3', memberId: 'm3', status: 'waitlisted', position: 1 }),
      booking({ id: 'b4', memberId: 'm4', status: 'waitlisted', position: 2 }),
    ];
    const plan = planPromotions({ klass: spin, bookings, otherBookings: [], otherClasses: {} });
    expect(plan.promotions.map((p) => p.bookingId)).toEqual(['b3']);
    expect(plan.spotsFilled).toBe(1);
    expect(plan.renumbered).toEqual([{ bookingId: 'b4', position: 1 }]);
  });

  it('releases the fallback class the promoted member was holding', () => {
    const bookings = [
      booking({ id: 'b1', memberId: 'm1', status: 'cancelled' }),
      booking({ id: 'b2', memberId: 'm2' }),
      booking({ id: 'b3', memberId: 'm3', status: 'waitlisted', position: 1 }),
    ];
    const otherBookings = [
      booking({ id: 'b9', memberId: 'm3', classId: circuit.id }),
      booking({ id: 'b10', memberId: 'm3', classId: yoga.id }),
    ];
    const plan = planPromotions({
      klass: spin,
      bookings,
      otherBookings,
      otherClasses: { [circuit.id]: circuit, [yoga.id]: yoga },
    });
    // The clashing circuit booking is released. The later yoga class is not.
    expect(plan.promotions[0]?.releases).toEqual(['b9']);
  });

  it('does not release someone else’s clashing booking', () => {
    const bookings = [
      booking({ id: 'b1', memberId: 'm1', status: 'cancelled' }),
      booking({ id: 'b2', memberId: 'm2' }),
      booking({ id: 'b3', memberId: 'm3', status: 'waitlisted', position: 1 }),
    ];
    const otherBookings = [booking({ id: 'b9', memberId: 'm4', classId: circuit.id })];
    const plan = planPromotions({
      klass: spin,
      bookings,
      otherBookings,
      otherClasses: { [circuit.id]: circuit },
    });
    expect(plan.promotions[0]?.releases).toEqual([]);
  });

  it('ignores a clashing booking that is already cancelled', () => {
    const bookings = [
      booking({ id: 'b1', memberId: 'm1', status: 'cancelled' }),
      booking({ id: 'b2', memberId: 'm2' }),
      booking({ id: 'b3', memberId: 'm3', status: 'waitlisted', position: 1 }),
    ];
    const otherBookings = [
      booking({ id: 'b9', memberId: 'm3', classId: circuit.id, status: 'cancelled' }),
    ];
    const plan = planPromotions({
      klass: spin,
      bookings,
      otherBookings,
      otherClasses: { [circuit.id]: circuit },
    });
    expect(plan.promotions[0]?.releases).toEqual([]);
  });

  it('promotes into capacity raised by the site manager', () => {
    const bookings = [
      booking({ id: 'b1', memberId: 'm1' }),
      booking({ id: 'b2', memberId: 'm2' }),
      booking({ id: 'b3', memberId: 'm3', status: 'waitlisted', position: 1 }),
      booking({ id: 'b4', memberId: 'm4', status: 'waitlisted', position: 2 }),
    ];
    const plan = planPromotions({
      klass: { ...spin, capacity: 4 },
      bookings,
      otherBookings: [],
      otherClasses: {},
    });
    expect(plan.promotions.map((p) => p.bookingId)).toEqual(['b3', 'b4']);
    expect(plan.renumbered).toEqual([]);
  });
});

describe('fill and no-show rates', () => {
  it('reports fill against capacity', () => {
    expect(fillRate({ capacity: 20, booked: 17, attended: 15 })).toBeCloseTo(0.85);
    expect(fillRate({ capacity: 0, booked: 0, attended: 0 })).toBe(0);
  });

  it('reports no-shows against bookings', () => {
    expect(noShowRate({ capacity: 20, booked: 20, attended: 17 })).toBeCloseTo(0.15);
    expect(noShowRate({ capacity: 20, booked: 0, attended: 0 })).toBe(0);
    expect(noShowRate({ capacity: 20, booked: 10, attended: 12 })).toBe(0);
  });
});
