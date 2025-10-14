/**
 * Proration for mid-period plan changes and mid-period sign-ups.
 *
 * The model is day-based and inclusive: a billing period is a run of calendar
 * days, the day a change takes effect belongs to the *new* plan, and the member
 * is credited for the days of the old plan they paid for but will not use.
 *
 *   period 2026-03-01 .. 2026-03-31   (31 days)
 *   upgrade takes effect 2026-03-12   -> 20 remaining days (12th..31st)
 *   credit  = old price * 20/31
 *   charge  = new price * 20/31
 *   net     = charge - credit
 *
 * Both sides are rounded half-up independently, then netted. Rounding the net
 * instead would make an upgrade and an immediate downgrade fail to cancel out.
 */

import {
  type PlainDate,
  differenceInDays,
  isAfter,
  isBefore,
} from './dates';
import { type Currency, type Money, prorate, subtract, zero } from './money';

export interface BillingPeriodDays {
  /** First day of the period, inclusive. */
  readonly from: PlainDate;
  /** Last day of the period, inclusive. */
  readonly to: PlainDate;
}

export interface ProrationLine {
  readonly kind: 'credit' | 'charge';
  readonly description: string;
  readonly planId: string;
  readonly amount: Money;
  readonly days: number;
  readonly periodDays: number;
}

export interface ProrationResult {
  readonly currency: Currency;
  readonly lines: readonly ProrationLine[];
  /** Positive means the member owes money now, negative means they are in credit. */
  readonly net: Money;
  readonly remainingDays: number;
  readonly periodDays: number;
}

export interface PlanSnapshot {
  readonly id: string;
  readonly name: string;
  readonly priceMinor: number;
  readonly currency: Currency;
}

export function periodLengthInDays(period: BillingPeriodDays): number {
  const days = differenceInDays(period.to, period.from) + 1;
  if (days <= 0) throw new RangeError(`Billing period ends before it starts: ${period.from}..${period.to}`);
  return days;
}

/**
 * Days of `period` still ahead of (and including) `changeOn`. Clamped, so a
 * change dated before the period counts as the whole period and one dated after
 * it counts as nothing.
 */
export function remainingDaysInPeriod(period: BillingPeriodDays, changeOn: PlainDate): number {
  const periodDays = periodLengthInDays(period);
  if (isBefore(changeOn, period.from)) return periodDays;
  if (isAfter(changeOn, period.to)) return 0;
  return differenceInDays(period.to, changeOn) + 1;
}

export interface PlanChangeInput {
  readonly period: BillingPeriodDays;
  readonly changeOn: PlainDate;
  readonly from: PlanSnapshot;
  readonly to: PlanSnapshot;
}

/**
 * Proration for switching plans inside a period the member has already paid for.
 * An upgrade nets positive, a downgrade nets negative (carried as credit to the
 * next run rather than refunded, see docs/adr/0004-no-outbound-refunds.md).
 */
export function proratePlanChange(input: PlanChangeInput): ProrationResult {
  const { period, changeOn, from, to } = input;
  if (from.currency !== to.currency) {
    throw new Error(
      `Cannot change plan across currencies: ${from.currency} -> ${to.currency}`,
    );
  }
  const currency = from.currency;
  const periodDays = periodLengthInDays(period);
  const remainingDays = remainingDaysInPeriod(period, changeOn);

  if (remainingDays === 0 || from.id === to.id) {
    return { currency, lines: [], net: zero(currency), remainingDays, periodDays };
  }

  const credit = prorate({ minor: from.priceMinor, currency }, remainingDays, periodDays, 'half-up');
  const charge = prorate({ minor: to.priceMinor, currency }, remainingDays, periodDays, 'half-up');

  const lines: ProrationLine[] = [
    {
      kind: 'credit',
      description: `Unused time on ${from.name}`,
      planId: from.id,
      amount: credit,
      days: remainingDays,
      periodDays,
    },
    {
      kind: 'charge',
      description: `Remaining time on ${to.name}`,
      planId: to.id,
      amount: charge,
      days: remainingDays,
      periodDays,
    },
  ];

  return { currency, lines, net: subtract(charge, credit), remainingDays, periodDays };
}

export interface FirstPeriodInput {
  readonly period: BillingPeriodDays;
  readonly startsOn: PlainDate;
  readonly plan: PlanSnapshot;
}

/** A member who signs up on the 12th pays for the 12th to the end of the period. */
export function prorateFirstPeriod(input: FirstPeriodInput): ProrationResult {
  const { period, startsOn, plan } = input;
  const periodDays = periodLengthInDays(period);
  const remainingDays = remainingDaysInPeriod(period, startsOn);
  if (remainingDays === 0) {
    return { currency: plan.currency, lines: [], net: zero(plan.currency), remainingDays, periodDays };
  }
  const charge = prorate(
    { minor: plan.priceMinor, currency: plan.currency },
    remainingDays,
    periodDays,
    'half-up',
  );
  return {
    currency: plan.currency,
    lines: [
      {
        kind: 'charge',
        description: `${plan.name} from ${startsOn}`,
        planId: plan.id,
        amount: charge,
        days: remainingDays,
        periodDays,
      },
    ],
    net: charge,
    remainingDays,
    periodDays,
  };
}

export interface FrozenDaysInput {
  readonly period: BillingPeriodDays;
  readonly plan: PlanSnapshot;
  /** Number of days inside the period the subscription was frozen. */
  readonly frozenDays: number;
}

/**
 * Frozen days are not billed. The credit is applied on the run that covers the
 * period, so a member frozen for half of March pays half of March.
 */
export function prorateFrozenDays(input: FrozenDaysInput): ProrationResult {
  const { period, plan, frozenDays } = input;
  const periodDays = periodLengthInDays(input.period);
  const billableDays = Math.max(0, periodDays - Math.max(0, frozenDays));
  const charge = prorate(
    { minor: plan.priceMinor, currency: plan.currency },
    billableDays,
    periodDays,
    'half-up',
  );
  return {
    currency: plan.currency,
    lines: [
      {
        kind: 'charge',
        description: `${plan.name} (${billableDays} of ${periodDays} days)`,
        planId: plan.id,
        amount: charge,
        days: billableDays,
        periodDays,
      },
    ],
    net: charge,
    remainingDays: billableDays,
    periodDays: periodLengthInDays(period),
  };
}
