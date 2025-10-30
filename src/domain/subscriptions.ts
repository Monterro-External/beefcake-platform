/**
 * The subscription lifecycle, derived rather than stored.
 *
 * `subscriptions.status` in the database is the *intent* the operator or member
 * expressed: pending, active, cancelling, cancelled. Whether a subscription is
 * frozen on a given day is a fact about the freezes table, and whether it is
 * expired is a fact about `ends_at` and today's date. Storing those as well is
 * how a nightly job and a screen end up disagreeing, so they are computed here.
 */

import { type PlainDate } from './dates';
import { type StoredFreeze, isFrozenOn } from './freezes';

/** What is stored on the row. */
export type SubscriptionIntent = 'pending' | 'active' | 'cancelling' | 'cancelled';

/** What the member and the operator actually see. */
export type EffectiveStatus = 'pending' | 'active' | 'frozen' | 'cancelling' | 'ended';

export interface SubscriptionRecord {
  readonly id: string;
  readonly memberId: string;
  readonly planId: string;
  readonly status: SubscriptionIntent;
  readonly startedOn: PlainDate;
  readonly endsOn: PlainDate | null;
  readonly bindingUntil: PlainDate | null;
  readonly cancelledOn: PlainDate | null;
  readonly noticeEndsOn: PlainDate | null;
}

export function effectiveStatus(
  sub: SubscriptionRecord,
  freezes: readonly StoredFreeze[],
  on: PlainDate,
): EffectiveStatus {
  if (on < sub.startedOn) return 'pending';
  if (sub.endsOn !== null && on > sub.endsOn) return 'ended';
  if (isFrozenOn(freezes, on)) return 'frozen';
  if (sub.status === 'cancelling' || (sub.cancelledOn !== null && sub.endsOn !== null)) {
    return 'cancelling';
  }
  if (sub.status === 'cancelled') return 'ended';
  if (sub.status === 'pending') return 'pending';
  return 'active';
}

/** Whether a payment run covering `period` should produce a charge for this subscription. */
export function isBillableIn(
  sub: SubscriptionRecord,
  freezes: readonly StoredFreeze[],
  period: { from: PlainDate; to: PlainDate },
): boolean {
  if (sub.startedOn > period.to) return false;
  if (sub.endsOn !== null && sub.endsOn < period.from) return false;
  if (sub.status === 'pending') return false;
  // A subscription frozen for the entire period is not billed at all; a partly
  // frozen one is billed pro rata by the payment run.
  const everyDayFrozen =
    isFrozenOn(freezes, period.from) &&
    isFrozenOn(freezes, period.to) &&
    freezes.some((f) => f.startsOn <= period.from && f.endsOn >= period.to);
  return !everyDayFrozen;
}

export function isInBinding(sub: SubscriptionRecord, on: PlainDate): boolean {
  return sub.bindingUntil !== null && on <= sub.bindingUntil;
}

export interface PlanChangeGuard {
  readonly allowed: boolean;
  readonly reason?: 'in_binding' | 'currency_mismatch' | 'already_on_plan' | 'ended';
}

export function canChangePlan(
  sub: SubscriptionRecord,
  target: { id: string; currency: string; priceMinor: number },
  current: { id: string; currency: string; priceMinor: number },
  on: PlainDate,
): PlanChangeGuard {
  if (sub.endsOn !== null && on > sub.endsOn) return { allowed: false, reason: 'ended' };
  if (target.id === current.id) return { allowed: false, reason: 'already_on_plan' };
  if (target.currency !== current.currency) return { allowed: false, reason: 'currency_mismatch' };
  // Downgrades are blocked inside a binding period, upgrades are always allowed.
  if (target.priceMinor < current.priceMinor && isInBinding(sub, on)) {
    return { allowed: false, reason: 'in_binding' };
  }
  return { allowed: true };
}
