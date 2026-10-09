import { and, asc, count, eq, gt, gte, inArray, lt, lte, ne } from 'drizzle-orm';
import type { CalendarBooking } from '@/domain/calendar-file';
import type { ClassFillBooking, ClassFillClass } from '@/domain/class-fill';
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
 * calendar file needs of each class, its site and its instructor. The query
 * leaves out classes starting at or before `now` so the file never loads the
 * member's history; the calendar file checks that again, and its check is the
 * rule of record. Every status comes back, cancelled bookings and bookings on
 * cancelled classes included: which bookings become events, and which become
 * cancelled events, is the calendar file's rule, not the query's.
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

export interface ClassFillRows {
  readonly classes: ClassFillClass[];
  readonly bookings: ClassFillBooking[];
}

/**
 * What the class fill report counts: the classes that are not cancelled and
 * start in [from, to), with their site and its timezone, and the place-holding and waitlisted
 * bookings on them. Two queries rather than one joined row per booking:
 * summing capacity over bookings joined to classes multiplies capacity by the
 * number of bookings, which is how the old fill-rate report managed to report
 * 340%. At Nordic Fitness Group's volume 30 days is a few thousand classes and
 * tens of thousands of bookings, which fits in memory.
 */
export function classFillRows(scope: TenantScope, window: { from: string; to: string }): ClassFillRows {
  const inWindow = and(
    eq(classes.tenantId, scope.tenantId),
    eq(classes.cancelled, false),
    gte(classes.startsAt, window.from),
    lt(classes.startsAt, window.to),
  );

  const classRows = guard(
    scope,
    'classes',
    scope.db
      .select({
        tenantId: classes.tenantId,
        id: classes.id,
        siteId: classes.siteId,
        siteName: sites.name,
        timezone: sites.timezone,
        startsAt: classes.startsAt,
        capacity: classes.capacity,
      })
      .from(classes)
      .innerJoin(sites, and(eq(sites.id, classes.siteId), eq(sites.tenantId, scope.tenantId)))
      .where(inWindow)
      .all(),
  );

  const bookingRows = guard(
    scope,
    'bookings',
    scope.db
      .select({ tenantId: bookings.tenantId, classId: bookings.classId, status: bookings.status })
      .from(bookings)
      .innerJoin(classes, eq(classes.id, bookings.classId))
      .where(
        and(
          eq(bookings.tenantId, scope.tenantId),
          inArray(bookings.status, ['booked', 'attended', 'no_show', 'waitlisted']),
          inWindow,
        ),
      )
      .all(),
  );

  return {
    classes: classRows.map(({ id, siteId, siteName, timezone, startsAt, capacity }) => ({
      id,
      siteId,
      siteName,
      timezone,
      startsAt,
      capacity,
    })),
    bookings: bookingRows.map(({ classId, status }) => ({ classId, status })),
  };
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
