'use server';

/**
 * Bookings: made by members in the member app, made and cancelled on their
 * behalf at the front desk, and marked attended after the class.
 *
 * Placement is decided by `placeBooking` in the domain, so a booking made at the
 * desk and one made in the app land in the same place in the queue.
 */

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { newId } from '@/db/ids';
import { bookings } from '@/db/schema';
import * as classesRepo from '@/db/repositories/classes';
import * as membersRepo from '@/db/repositories/members';
import { enqueueOutbox, recordEvent } from '@/db/repositories/observability';
import { placeBooking, renumberWaitlist } from '@/domain/waitlist';
import { createIntegrations } from '@/integrations';
import { clock } from '@/lib/clock';
import { activeTenant, getSession, requirePermission, tenantScopeFor } from '@/lib/session';
import type { ActionResult } from './subscriptions';

async function context() {
  const session = await getSession();
  const tenant = activeTenant(session) ?? session.tenant;
  if (tenant === null) throw new Error('No tenant selected');
  return {
    session,
    tenant,
    scope: tenantScopeFor(session),
    now: clock().now,
    integrations: createIntegrations({ salt: 'beefcake' }),
  };
}

/**
 * A member books for themselves in the member app; staff book for anyone at the
 * front desk. Anything else is refused, which is what stops one member's session
 * touching another member's bookings.
 */
function assertMayActFor(session: Awaited<ReturnType<typeof getSession>>, memberId: string): void {
  if (session.user.role === 'member') {
    if (session.member?.id !== memberId) {
      throw new Error('A member can only book for themselves');
    }
    return;
  }
  requirePermission(session, 'members.write');
}

export async function bookClass(classId: string, memberId: string): Promise<ActionResult> {
  const ctx = await context();
  assertMayActFor(ctx.session, memberId);

  const klass = classesRepo.getClass(ctx.scope, classId);
  if (klass === null) return { ok: false, message: 'No such class.' };
  if (klass.cancelled) return { ok: false, message: 'That class was cancelled.' };
  if (klass.startsAt < ctx.now.toISOString()) {
    return { ok: false, message: 'That class has already started.' };
  }

  const member = membersRepo.getMember(ctx.scope, memberId);
  if (member === null) return { ok: false, message: 'No such member.' };
  if (member.status === 'blocked') return { ok: false, message: 'That member is blocked.' };

  const existing = classesRepo.listBookings(ctx.scope, classId);
  const mine = existing.find((booking) => booking.memberId === memberId);
  if (mine !== undefined && mine.status !== 'cancelled') {
    return { ok: false, message: 'Already booked on this class.' };
  }

  const snapshots = existing.map(classesRepo.toBookingSnapshot);
  const placement = placeBooking(classesRepo.toClassSnapshot(klass), snapshots);
  const at = ctx.now.toISOString();

  if (mine === undefined) {
    classesRepo.insertBooking(ctx.scope, {
      id: newId('booking'),
      classId,
      memberId,
      status: placement.status,
      position: placement.position,
      createdAt: at,
      updatedAt: at,
    });
  } else {
    // Rebooking after a cancellation reuses the row: one booking per member per
    // class is a database constraint, not a convention.
    classesRepo.setBookingStatus(ctx.scope, mine.id, placement.status, placement.position, at);
  }

  recordEvent(ctx.scope, {
    action: placement.status === 'waitlisted' ? 'booking.waitlisted' : 'booking.created',
    subjectType: 'class',
    subjectId: classId,
    payload: { member_id: memberId, position: placement.position, class_name: klass.name },
    at,
  });

  const sent = ctx.integrations.email.send({
    to: member.email,
    template: 'booking_confirmed',
    locale: ctx.tenant.locale,
    variables: { class_name: klass.name, starts_at: klass.startsAt },
    at: ctx.now,
  });
  enqueueOutbox(ctx.scope, {
    channel: 'email',
    template: 'booking_confirmed',
    recipient: member.email,
    payload: {
      class_id: classId,
      class_name: klass.name,
      status: placement.status,
      position: placement.position,
      gateway: sent.status,
    },
    at,
  });

  revalidatePath('/app', 'layout');
  revalidatePath('/me', 'layout');
  return {
    ok: true,
    message:
      placement.status === 'booked'
        ? `Booked onto ${klass.name}.`
        : `${klass.name} is full. Added to the waitlist at position ${placement.position}.`,
  };
}

export async function cancelBooking(bookingId: string): Promise<ActionResult> {
  const ctx = await context();

  const booking = ctx.scope.db
    .select()
    .from(bookings)
    .where(and(eq(bookings.tenantId, ctx.scope.tenantId), eq(bookings.id, bookingId)))
    .get();
  if (booking === undefined) return { ok: false, message: 'No such booking.' };
  assertMayActFor(ctx.session, booking.memberId);

  const klass = classesRepo.getClass(ctx.scope, booking.classId);
  if (klass === null) return { ok: false, message: 'No such class.' };
  if (klass.startsAt < ctx.now.toISOString()) {
    return { ok: false, message: 'That class has already started.' };
  }

  const at = ctx.now.toISOString();
  ctx.scope.db.transaction(() => {
    classesRepo.setBookingStatus(ctx.scope, bookingId, 'cancelled', null, at);
    // Close the gap so positions stay 1..n.
    const remaining = classesRepo
      .listBookings(ctx.scope, booking.classId)
      .map(classesRepo.toBookingSnapshot);
    for (const entry of renumberWaitlist(remaining)) {
      classesRepo.setBookingStatus(ctx.scope, entry.bookingId, 'waitlisted', entry.position, at);
    }
  });

  recordEvent(ctx.scope, {
    action: 'booking.cancelled',
    subjectType: 'booking',
    subjectId: bookingId,
    payload: { class_id: booking.classId, was: booking.status, reason: 'front_desk' },
    at,
  });

  revalidatePath('/app', 'layout');
  revalidatePath('/me', 'layout');
  return {
    ok: true,
    message: 'Booking cancelled. The waitlist moves up when the promotion job next runs.',
  };
}

export async function markAttendance(
  bookingId: string,
  status: 'attended' | 'no_show',
): Promise<ActionResult> {
  const ctx = await context();
  requirePermission(ctx.session, 'classes.write');

  const booking = ctx.scope.db
    .select()
    .from(bookings)
    .where(and(eq(bookings.tenantId, ctx.scope.tenantId), eq(bookings.id, bookingId)))
    .get();
  if (booking === undefined) return { ok: false, message: 'No such booking.' };

  const at = ctx.now.toISOString();
  classesRepo.setBookingStatus(ctx.scope, bookingId, status, null, at);
  recordEvent(ctx.scope, {
    action: 'booking.attended',
    subjectType: 'booking',
    subjectId: bookingId,
    payload: { outcome: status, class_id: booking.classId },
    at,
  });

  revalidatePath('/app', 'layout');
  return { ok: true, message: status === 'attended' ? 'Marked as attended.' : 'Marked as a no-show.' };
}
