/**
 * What one member owes for one billing period.
 *
 * The monthly payment run bills in arrears on the 25th for the calendar month
 * it is in, so the amount for a period depends on four things that can all
 * happen inside it: the subscription starting, the subscription ending, a plan
 * change, and one or more freezes.
 *
 * The period is broken into segments, one per plan the member was on, each
 * segment is reduced by the days it was frozen, and each segment is charged pro
 * rata. Splitting first and prorating second is the part that matters: a member
 * who moves from Bas to Plus on the 12th is charged 11 days of Bas and 20 days
 * of Plus, never a full month of either.
 */

import {
  type PlainDate,
  differenceInDays,
  maxPlainDate,
  minPlainDate,
} from './dates';
import type { StoredFreeze } from './freezes';
import { type Money, prorate, sum, zero } from './money';
import type { BillingPeriodDays, PlanSnapshot } from './proration';

export interface ChargeSegment {
  readonly planId: string;
  readonly planName: string;
  readonly from: PlainDate;
  readonly to: PlainDate;
  readonly billableDays: number;
  readonly frozenDays: number;
  readonly periodDays: number;
  readonly amount: Money;
}

export interface PeriodCharge {
  readonly amount: Money;
  readonly segments: readonly ChargeSegment[];
  readonly billableDays: number;
  readonly frozenDays: number;
  readonly periodDays: number;
  /** True when the member owes nothing: not yet started, ended, or fully frozen. */
  readonly skip: boolean;
}

export interface PeriodChargeInput {
  readonly period: BillingPeriodDays;
  /** The plan the member is on at the end of the period. */
  readonly plan: PlanSnapshot;
  /** The plan they were on before a mid-period change, if there was one. */
  readonly previousPlan: PlanSnapshot | null;
  /** The day a plan change took effect, if it falls inside this period. */
  readonly planChangeOn: PlainDate | null;
  readonly subscriptionStartedOn: PlainDate;
  readonly subscriptionEndsOn: PlainDate | null;
  readonly freezes: readonly StoredFreeze[];
}

/** Days of [from, to] covered by any freeze. Overlapping freezes count once. */
export function frozenDaysBetween(
  freezes: readonly StoredFreeze[],
  from: PlainDate,
  to: PlainDate,
): number {
  if (freezes.length === 0 || from > to) return 0;
  const spans = freezes
    .map((f) => ({ from: maxPlainDate(f.startsOn, from), to: minPlainDate(f.endsOn, to) }))
    .filter((s) => s.from <= s.to)
    .sort((a, b) => a.from.localeCompare(b.from));

  let days = 0;
  let cursorEnd: PlainDate | null = null;
  for (const span of spans) {
    if (cursorEnd === null || span.from > cursorEnd) {
      days += differenceInDays(span.to, span.from) + 1;
      cursorEnd = span.to;
    } else if (span.to > cursorEnd) {
      days += differenceInDays(span.to, cursorEnd);
      cursorEnd = span.to;
    }
  }
  return days;
}

export function computePeriodCharge(input: PeriodChargeInput): PeriodCharge {
  const { period, plan, previousPlan, planChangeOn, subscriptionStartedOn, subscriptionEndsOn, freezes } =
    input;
  const currency = plan.currency;
  const periodDays = differenceInDays(period.to, period.from) + 1;

  const serviceFrom = maxPlainDate(period.from, subscriptionStartedOn);
  const serviceTo =
    subscriptionEndsOn === null ? period.to : minPlainDate(period.to, subscriptionEndsOn);

  const empty: PeriodCharge = {
    amount: zero(currency),
    segments: [],
    billableDays: 0,
    frozenDays: 0,
    periodDays,
    skip: true,
  };

  if (serviceFrom > serviceTo) return empty;

  // One segment per plan the member was on during the served part of the period.
  //
  // A segment is prorated against its own stretch, not against the whole period:
  // each plan is billed for the days it was actually in force, which is what an
  // operator means when they say "bill each plan for its own time".
  const boundaries: { plan: PlanSnapshot; from: PlainDate; to: PlainDate; ownStretch: boolean }[] = [];
  const changed =
    planChangeOn !== null &&
    previousPlan !== null &&
    planChangeOn > serviceFrom &&
    planChangeOn <= serviceTo;

  if (changed && planChangeOn !== null && previousPlan !== null) {
    boundaries.push({
      plan: previousPlan,
      from: serviceFrom,
      to: addDaysLocal(planChangeOn, -1),
      ownStretch: true,
    });
    boundaries.push({ plan, from: planChangeOn, to: serviceTo, ownStretch: true });
  } else {
    boundaries.push({ plan, from: serviceFrom, to: serviceTo, ownStretch: false });
  }

  const segments: ChargeSegment[] = boundaries
    .filter((b) => b.from <= b.to)
    .map((b) => {
      const days = differenceInDays(b.to, b.from) + 1;
      const frozenDays = frozenDaysBetween(freezes, b.from, b.to);
      const billableDays = Math.max(0, days - frozenDays);
      const basis = b.ownStretch ? days : periodDays;
      return {
        planId: b.plan.id,
        planName: b.plan.name,
        from: b.from,
        to: b.to,
        billableDays,
        frozenDays,
        periodDays,
        amount: prorate(
          { minor: b.plan.priceMinor, currency: b.plan.currency },
          billableDays,
          basis,
          'half-up',
        ),
      };
    });

  const billableDays = segments.reduce((acc, s) => acc + s.billableDays, 0);
  const frozenDays = segments.reduce((acc, s) => acc + s.frozenDays, 0);
  const amount = sum(
    segments.map((s) => s.amount),
    currency,
  );

  return {
    amount,
    segments,
    billableDays,
    frozenDays,
    periodDays,
    skip: billableDays === 0 || amount.minor === 0,
  };
}

/** Local copy so this module does not import the whole dates surface. */
function addDaysLocal(day: PlainDate, days: number): PlainDate {
  const [y, m, d] = day.split('-').map((v) => Number.parseInt(v, 10)) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}` as PlainDate;
}

export interface ReceiptLine {
  readonly description: string;
  readonly quantity: number;
  readonly unit: string;
  readonly amountMinor: number;
  readonly currency: string;
}

/** Receipt lines for a computed charge. One line per plan segment. */
export function receiptLines(charge: PeriodCharge): ReceiptLine[] {
  return charge.segments.map((segment) => ({
    description:
      segment.billableDays === segment.periodDays
        ? segment.planName
        : `${segment.planName} (${segment.billableDays} of ${segment.periodDays} days)`,
    quantity: segment.billableDays,
    unit: 'day',
    amountMinor: segment.amount.minor,
    currency: segment.amount.currency,
  }));
}

/** Swedish VAT on gym memberships is 6%, and the other three markets differ. */
export const VAT_RATE_BY_COUNTRY: Record<'SE' | 'NO' | 'FI' | 'DK', number> = {
  SE: 0.06,
  NO: 0.25,
  FI: 0.1,
  DK: 0.25,
};

/** VAT included in a gross amount. */
export function vatOf(amount: Money, rate: number): Money {
  return prorate(amount, Math.round(rate * 10000), Math.round((1 + rate) * 10000), 'half-up');
}
