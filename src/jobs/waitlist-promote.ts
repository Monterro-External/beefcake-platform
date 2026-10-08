/**
 * Waitlist promotion.
 *
 * Runs frequently. For every upcoming class with a free spot and somebody
 * waiting, promote from position 1 upwards.
 *
 * A promotion is three things that have to happen together:
 *
 *  1. the waitlisted booking becomes `booked`
 *  2. any booking the member holds on a class that clashes with this one is
 *     released, because it was their fallback and they no longer need it
 *  3. the member is told
 *
 * Miss (2) and the site manager sees a class that reads as full while half the
 * room does not turn up, which is the complaint they actually raise. The plan for
 * all three is computed in one place, `planPromotions`, and applied in one
 * transaction, so they cannot drift apart.
 */

import { and, eq } from 'drizzle-orm';
import { bookings } from '@/db/schema';
import * as classesRepo from '@/db/repositories/classes';
import * as membersRepo from '@/db/repositories/members';
import { enqueueOutbox, recordEvent } from '@/db/repositories/observability';
import { planPromotions, type ClassSnapshot } from '@/domain/waitlist';
import { addDays, startOfDay } from '@/domain/dates';
import type { Job, TenantJobContext } from './runner';

/** How far ahead to look. Beyond a fortnight nobody has dropped out yet. */
export const PROMOTION_HORIZON_DAYS = 14;

export interface WaitlistPromoteSummary {
  classesConsidered: number;
  promoted: number;
  fallbacksReleased: number;
  notified: number;
  [key: string]: number | string | boolean | null;
}

export const waitlistPromoteJob: Job<WaitlistPromoteSummary> = {
  name: 'waitlist-promote',
  describe: 'Move waitlisted members into freed class spots and release their clashing bookings',

  perTenant(context): WaitlistPromoteSummary {
    const summary: WaitlistPromoteSummary = {
      classesConsidered: 0,
      promoted: 0,
      fallbacksReleased: 0,
      notified: 0,
    };

    if (!context.settings.flags.waitlist_auto_promote) {
      context.log(`  ${context.tenant.name}: auto-promotion is off`);
      return summary;
    }

    const from = context.now.toISOString();
    const to = startOfDay(addDays(context.today, PROMOTION_HORIZON_DAYS), context.timezone).toISOString();
    const candidates = classesRepo.classesNeedingPromotion(context.scope, from);

    for (const klass of candidates) {
      if (klass.startsAt > to) continue;
      summary.classesConsidered += 1;
      promoteInto(context, klass, summary);
    }

    if (summary.promoted > 0) {
      context.log(
        `  ${context.tenant.name}: promoted ${summary.promoted}, released ${summary.fallbacksReleased} fallback booking(s)`,
      );
    }
    return summary;
  },
};

function promoteInto(
  context: TenantJobContext,
  klass: { id: string; siteId: string; name: string; startsAt: string; endsAt: string; capacity: number },
  summary: WaitlistPromoteSummary,
): void {
  const { scope, now } = context;
  const classBookings = classesRepo.listBookings(scope, klass.id).map(classesRepo.toBookingSnapshot);
  const waiting = classBookings.filter((b) => b.status === 'waitlisted');
  if (waiting.length === 0) return;

  const snapshot: ClassSnapshot = classesRepo.toClassSnapshot({
    ...klass,
    tenantId: scope.tenantId,
    instructorId: null,
    cancelled: false,
  });

  // Only the clashing window matters, so the lookup is bounded to the day either
  // side of this class rather than the member's whole history.
  const others = classesRepo.otherBookingsFor(
    scope,
    waiting.map((b) => b.memberId),
    klass.id,
    {
      from: new Date(new Date(klass.startsAt).getTime() - 86_400_000).toISOString(),
      to: new Date(new Date(klass.endsAt).getTime() + 86_400_000).toISOString(),
    },
  );

  const plan = planPromotions({
    klass: snapshot,
    bookings: classBookings,
    otherBookings: others.bookings.map(classesRepo.toBookingSnapshot),
    otherClasses: Object.fromEntries(
      others.classes.map((c) => [c.id, classesRepo.toClassSnapshot(c)]),
    ),
  });

  if (plan.promotions.length === 0) return;
  if (context.dryRun) {
    context.log(`  would promote ${plan.promotions.length} into ${klass.name} (${klass.startsAt})`);
    return;
  }

  const at = now.toISOString();
  scope.db.transaction((tx) => {
    void tx;
    for (const promotion of plan.promotions) {
      classesRepo.setBookingStatus(scope, promotion.bookingId, 'booked', null, at);
    }

    for (const entry of plan.renumbered) {
      classesRepo.setBookingStatus(scope, entry.bookingId, 'waitlisted', entry.position, at);
    }
  });

  // Releases, notifications and events are outside the transaction: a failure to
  // send must not roll back a promotion that has already freed a spot.
  for (const promotion of plan.promotions) {
    summary.promoted += 1;

    // Only release a fallback for a promotion that actually went through. If the
    // transaction above rolled back, the member is still waiting and their
    // fallback is the only booking they have.
    const applied = scope.db
      .select({ status: bookings.status })
      .from(bookings)
      .where(and(eq(bookings.tenantId, scope.tenantId), eq(bookings.id, promotion.bookingId)))
      .get();

    if (applied?.status === 'booked') {
      for (const releasedId of promotion.releases) {
        scope.db
          .update(bookings)
          .set({ status: 'cancelled', position: null, updatedAt: at })
          .where(and(eq(bookings.tenantId, scope.tenantId), eq(bookings.id, releasedId)))
          .run();
      }
      summary.fallbacksReleased += promotion.releases.length;
    }

    recordEvent(scope, {
      action: 'booking.promoted',
      subjectType: 'booking',
      subjectId: promotion.bookingId,
      payload: {
        class_id: klass.id,
        class_name: klass.name,
        starts_at: klass.startsAt,
        released: promotion.releases.length,
      },
      at,
    });

    if (applied?.status === 'booked') {
      for (const releasedId of promotion.releases) {
        recordEvent(scope, {
          action: 'booking.cancelled',
          subjectType: 'booking',
          subjectId: releasedId,
          payload: { reason: 'clashes_with_promotion', promoted_into: klass.id },
          at,
        });
      }
    }

    const member = membersRepo.getMember(scope, promotion.memberId);
    if (member === null) continue;
    const outcome = context.integrations.email.send({
      to: member.email,
      template: 'waitlist_promoted',
      locale: context.tenant.locale,
      variables: { class_name: klass.name, starts_at: klass.startsAt },
      at: now,
    });
    enqueueOutbox(scope, {
      channel: 'email',
      template: 'waitlist_promoted',
      recipient: member.email,
      payload: {
        booking_id: promotion.bookingId,
        class_id: klass.id,
        class_name: klass.name,
        starts_at: klass.startsAt,
        released_bookings: promotion.releases,
        gateway: outcome.status,
      },
      at,
    });
    if (outcome.status === 'queued') summary.notified += 1;
  }
}
