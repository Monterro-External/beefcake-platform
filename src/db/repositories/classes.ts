import { and, asc, count, eq, gt, gte, inArray, lt, lte, ne, sql } from 'drizzle-orm';
import type { CalendarBooking } from '@/domain/calendar-file';
import type { BookingSnapshot, ClassSnapshot } from '@/domain/waitlist';
import { type Booking, type Class, bookings, classes, sites, tenants, users } from '../schema';
import { type AdminScope, type TenantScope, guard, guardOne } from './scope';

export function listClasses(
  scope: TenantScope,
  filter: { siteId?: string; from?: string; to?: string; limit?: number } = {},
): Class[] {
  const conditions = [eq(classes.tenantId, scope.tenantId)];
  if (filter.siteId !== undefined) conditions.push(eq(classes.siteId, filter.siteId));
  if (filter.from !== undefined) conditions.push(gte(classes.startsAt, filter.from));
  if (filter.to !== undefined) conditions.push(lt(classes.startsAt, filter.to));
  return guard(
    scope,
    'classes',
    scope.db
      .select()
      .from(classes)
      .where(and(...conditions))
      .orderBy(asc(classes.startsAt))
      .limit(filter.limit ?? 500)
      .all(),
  );
}

export function getClass(scope: TenantScope, classId: string): Class | null {
  return guardOne(
    scope,
    'classes',
    scope.db
      .select()
      .from(classes)
      .where(and(eq(classes.tenantId, scope.tenantId), eq(classes.id, classId)))
      .get(),
  );
}

export function listBookings(scope: TenantScope, classId: string): Booking[] {
  return guard(
    scope,
    'bookings',
    scope.db
      .select()
      .from(bookings)
      .where(and(eq(bookings.tenantId, scope.tenantId), eq(bookings.classId, classId)))
      .orderBy(asc(bookings.createdAt))
      .all(),
  );
}

export function bookingCounts(scope: TenantScope, classIds: readonly string[]) {
  if (classIds.length === 0) return new Map<string, { booked: number; waitlisted: number }>();
  const rows = scope.db
    .select({ classId: bookings.classId, status: bookings.status, n: count() })
    .from(bookings)
    .where(and(eq(bookings.tenantId, scope.tenantId), inArray(bookings.classId, [...classIds])))
    .groupBy(bookings.classId, bookings.status)
    .all();
  const out = new Map<string, { booked: number; waitlisted: number }>();
  for (const id of classIds) out.set(id, { booked: 0, waitlisted: 0 });
  for (const row of rows) {
    const entry = out.get(row.classId);
    if (entry === undefined) continue;
    if (row.status === 'booked' || row.status === 'attended') entry.booked += row.n;
    if (row.status === 'waitlisted') entry.waitlisted += row.n;
  }
  return out;
}

/** Classes with a waitlist and a free spot. The input to the promotion job. */
export function classesNeedingPromotion(scope: TenantScope, from: string, limit = 500): Class[] {
  const rows = scope.db
    .select({ classId: bookings.classId })
    .from(bookings)
    .innerJoin(classes, eq(bookings.classId, classes.id))
    .where(
      and(
        eq(bookings.tenantId, scope.tenantId),
        eq(bookings.status, 'waitlisted'),
        gte(classes.startsAt, from),
        eq(classes.cancelled, false),
      ),
    )
    .groupBy(bookings.classId)
    .limit(limit)
    .all();
  if (rows.length === 0) return [];
  return guard(
    scope,
    'classes',
    scope.db
      .select()
      .from(classes)
      .where(
        and(
          eq(classes.tenantId, scope.tenantId),
          inArray(
            classes.id,
            rows.map((r) => r.classId),
          ),
        ),
      )
      .orderBy(asc(classes.startsAt))
      .all(),
  );
}

/** Other live bookings held by these members, so a promotion can release clashes. */
export function otherBookingsFor(
  scope: TenantScope,
  memberIds: readonly string[],
  excludeClassId: string,
  window: { from: string; to: string },
): { bookings: Booking[]; classes: Class[] } {
  if (memberIds.length === 0) return { bookings: [], classes: [] };
  const rows = guard(
    scope,
    'bookings',
    scope.db
      .select({
        id: bookings.id,
        tenantId: bookings.tenantId,
        classId: bookings.classId,
        memberId: bookings.memberId,
        status: bookings.status,
        position: bookings.position,
        createdAt: bookings.createdAt,
        updatedAt: bookings.updatedAt,
      })
      .from(bookings)
      .innerJoin(classes, eq(bookings.classId, classes.id))
      .where(
        and(
          eq(bookings.tenantId, scope.tenantId),
          inArray(bookings.memberId, [...memberIds]),
          ne(bookings.classId, excludeClassId),
          inArray(bookings.status, ['booked', 'waitlisted']),
          gte(classes.startsAt, window.from),
          lte(classes.startsAt, window.to),
        ),
      )
      .all(),
  );
  const classIds = [...new Set(rows.map((r) => r.classId))];
  const classRows =
    classIds.length === 0
      ? []
      : guard(
          scope,
          'classes',
          scope.db
            .select()
            .from(classes)
            .where(and(eq(classes.tenantId, scope.tenantId), inArray(classes.id, classIds)))
            .all(),
        );
  return { bookings: rows, classes: classRows };
}

/**
 * A member's bookings on classes that have not started at `now`, with what the
 * calendar file needs of each class, its site and its instructor. Every status
 * comes back, cancelled bookings and bookings on cancelled classes included:
 * which bookings become events, and which become cancelled events, is the
 * calendar file's rule, not the query's.
 */
export function calendarBookings(scope: TenantScope, memberId: string, now: string): CalendarBooking[] {
  const rows = guard(
    scope,
    'bookings',
    scope.db
      .select({
        tenantId: bookings.tenantId,
        bookingId: bookings.id,
        status: bookings.status,
        updatedAt: bookings.updatedAt,
        className: classes.name,
        startsAt: classes.startsAt,
        endsAt: classes.endsAt,
        classCancelled: classes.cancelled,
        instructorName: users.name,
        siteName: sites.name,
        addressLine: sites.addressLine,
        city: sites.city,
      })
      .from(bookings)
      .innerJoin(classes, and(eq(classes.id, bookings.classId), eq(classes.tenantId, scope.tenantId)))
      .innerJoin(sites, and(eq(sites.id, classes.siteId), eq(sites.tenantId, scope.tenantId)))
      .leftJoin(users, and(eq(users.id, classes.instructorId), eq(users.tenantId, scope.tenantId)))
      .where(
        and(eq(bookings.tenantId, scope.tenantId), eq(bookings.memberId, memberId), gt(classes.startsAt, now)),
      )
      .orderBy(asc(classes.startsAt))
      .all(),
  );
  return rows.map((row) => ({
    bookingId: row.bookingId,
    status: row.status,
    updatedAt: row.updatedAt,
    className: row.className,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    classCancelled: row.classCancelled,
    instructorName: row.instructorName,
    site: { name: row.siteName, addressLine: row.addressLine, city: row.city },
  }));
}

export function toClassSnapshot(row: Class): ClassSnapshot {
  return {
    id: row.id,
    siteId: row.siteId,
    name: row.name,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    capacity: row.capacity,
  };
}

export function toBookingSnapshot(row: Booking): BookingSnapshot {
  return {
    id: row.id,
    classId: row.classId,
    memberId: row.memberId,
    status: row.status,
    position: row.position,
    createdAt: row.createdAt,
  };
}

export function setBookingStatus(
  scope: TenantScope,
  bookingId: string,
  status: Booking['status'],
  position: number | null,
  at: string,
): void {
  scope.db
    .update(bookings)
    .set({ status, position, updatedAt: at })
    .where(and(eq(bookings.tenantId, scope.tenantId), eq(bookings.id, bookingId)))
    .run();
}

export function insertBooking(scope: TenantScope, values: Omit<Booking, 'tenantId'>): void {
  scope.db
    .insert(bookings)
    .values({ ...values, tenantId: scope.tenantId })
    .run();
}

export interface FillRateRow {
  readonly siteId: string;
  readonly classes: number;
  readonly capacity: number;
  readonly booked: number;
  readonly attended: number;
}

/**
 * Capacity and bookings per site over a window. Two queries rather than one:
 * joining bookings to classes and summing capacity in the same statement
 * multiplies capacity by the number of bookings, which is how the old fill-rate
 * report managed to report 340%.
 */
export function fillRateBySite(scope: TenantScope, window: { from: string; to: string }): FillRateRow[] {
  const capacityRows = scope.db
    .select({
      siteId: classes.siteId,
      classes: count(),
      capacity: sql<number>`coalesce(sum(${classes.capacity}), 0)`,
    })
    .from(classes)
    .where(
      and(
        eq(classes.tenantId, scope.tenantId),
        eq(classes.cancelled, false),
        gte(classes.startsAt, window.from),
        lt(classes.startsAt, window.to),
      ),
    )
    .groupBy(classes.siteId)
    .all();

  const bookingRows = scope.db
    .select({
      siteId: classes.siteId,
      booked: sql<number>`sum(case when ${bookings.status} in ('booked','attended','no_show') then 1 else 0 end)`,
      attended: sql<number>`sum(case when ${bookings.status} = 'attended' then 1 else 0 end)`,
    })
    .from(bookings)
    .innerJoin(classes, eq(bookings.classId, classes.id))
    .where(
      and(
        eq(bookings.tenantId, scope.tenantId),
        eq(classes.cancelled, false),
        gte(classes.startsAt, window.from),
        lt(classes.startsAt, window.to),
      ),
    )
    .groupBy(classes.siteId)
    .all();

  const byBookings = new Map(bookingRows.map((r) => [r.siteId, r]));
  return capacityRows.map((row) => ({
    siteId: row.siteId,
    classes: row.classes,
    capacity: row.capacity,
    booked: byBookings.get(row.siteId)?.booked ?? 0,
    attended: byBookings.get(row.siteId)?.attended ?? 0,
  }));
}

export interface BookingOutcomeRow {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly siteName: string;
  readonly timezone: string;
  readonly memberId: string;
  readonly startsAt: string;
  readonly status: string;
}

/**
 * Every booked, attended or no-show booking on a class that was not cancelled and
 * starts in [from, to), across all tenants. Callers bucket by site-local day.
 */
export function allBookingOutcomes(
  scope: AdminScope,
  window: { from: string; to: string },
): BookingOutcomeRow[] {
  return scope.db
    .select({
      tenantId: bookings.tenantId,
      tenantName: tenants.name,
      siteName: sites.name,
      timezone: sites.timezone,
      memberId: bookings.memberId,
      startsAt: classes.startsAt,
      status: bookings.status,
    })
    .from(bookings)
    .innerJoin(classes, and(eq(classes.id, bookings.classId), eq(classes.tenantId, bookings.tenantId)))
    .innerJoin(sites, and(eq(sites.id, classes.siteId), eq(sites.tenantId, classes.tenantId)))
    .innerJoin(tenants, eq(tenants.id, bookings.tenantId))
    .where(
      and(
        eq(classes.cancelled, false),
        inArray(bookings.status, ['booked', 'attended', 'no_show']),
        gte(classes.startsAt, window.from),
        lt(classes.startsAt, window.to),
      ),
    )
    .all();
}
