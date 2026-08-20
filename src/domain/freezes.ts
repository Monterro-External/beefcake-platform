/**
 * Freezes ("uppehåll" in Swedish, "frys" in Norwegian) pause a subscription for
 * a whole number of months. The member is not billed for frozen days, their
 * access card stops working, and their binding period is pushed out by the same
 * length so the gym does not lose committed months.
 *
 * The only subtle part is the end date. A freeze is stored as an inclusive
 * `starts_on` .. `ends_on` pair, and the member resumes on the day after
 * `ends_on`. A one-month freeze taken on the 15th resumes on the 15th of the
 * next month.
 *
 *   2026-01-15 + 1 month -> ends 2026-02-14, resumes 2026-02-15
 *   2026-03-31 + 1 month -> ends 2026-04-29, resumes 2026-04-30
 *
 * January and the summer months are the peak, so this runs thousands of times a
 * year.
 */

import {
  type PlainDate,
  addDays,
  addMonths,
  differenceInDays,
  isWithin,
  maxPlainDate,
  subDays,
} from './dates';

export interface FreezePeriod {
  readonly startsOn: PlainDate;
  /** Last frozen day, inclusive. */
  readonly endsOn: PlainDate;
  /** First day back, always `endsOn` + 1. */
  readonly resumesOn: PlainDate;
  readonly months: number;
  readonly days: number;
}

export const MIN_FREEZE_MONTHS = 1;

/**
 * Work out the inclusive end date and resume date of a freeze of `months`
 * whole months starting on `startsOn`.
 */
export function freezePeriod(startsOn: PlainDate, months: number): FreezePeriod {
  if (!Number.isInteger(months) || months < MIN_FREEZE_MONTHS) {
    throw new RangeError(`A freeze must be a whole number of months, got ${months}`);
  }

  // `addMonths` already clamps the day of month to the length of the target
  // month, so the month-end branch this used to have was doing the same work
  // twice.
  const resumesOn = addMonths(startsOn, months);

  const endsOn = subDays(resumesOn, 1);
  return {
    startsOn,
    endsOn,
    resumesOn,
    months,
    days: differenceInDays(endsOn, startsOn) + 1,
  };
}

export interface StoredFreeze {
  readonly startsOn: PlainDate;
  readonly endsOn: PlainDate;
}

export function isFrozenOn(freezes: readonly StoredFreeze[], day: PlainDate): boolean {
  return freezes.some((f) => isWithin(day, f.startsOn, f.endsOn));
}

export function activeFreezeOn(
  freezes: readonly StoredFreeze[],
  day: PlainDate,
): StoredFreeze | undefined {
  return freezes.find((f) => isWithin(day, f.startsOn, f.endsOn));
}

/** How many days of `period` a set of freezes covers. Overlaps count once. */
export function frozenDaysInPeriod(
  freezes: readonly StoredFreeze[],
  period: { from: PlainDate; to: PlainDate },
): number {
  const days = new Set<PlainDate>();
  for (const f of freezes) {
    const from = maxPlainDate(f.startsOn, period.from);
    const to = f.endsOn < period.to ? f.endsOn : period.to;
    for (let d = from; d <= to; d = addDays(d, 1)) days.add(d);
  }
  return days.size;
}

/** A freeze does not consume binding months: push `bindingUntil` out by its length. */
export function extendBinding(
  bindingUntil: PlainDate | null,
  freeze: FreezePeriod,
): PlainDate | null {
  if (bindingUntil === null) return null;
  return addDays(bindingUntil, freeze.days);
}

export interface FreezeRequest {
  readonly startsOn: PlainDate;
  readonly months: number;
}

export interface FreezeRules {
  /** Longest single freeze a tenant allows, in months. */
  readonly maxFreezeMonths: number;
  /** Total frozen months allowed per rolling 12 months. */
  readonly maxFreezeMonthsPerYear: number;
}

export type FreezeRejection =
  | { readonly ok: false; readonly reason: 'too_long'; readonly limitMonths: number }
  | { readonly ok: false; readonly reason: 'annual_limit'; readonly limitMonths: number }
  | { readonly ok: false; readonly reason: 'overlaps_existing' }
  | { readonly ok: false; readonly reason: 'starts_in_past' };

export type FreezeDecision = { readonly ok: true; readonly period: FreezePeriod } | FreezeRejection;

export function decideFreeze(
  request: FreezeRequest,
  existing: readonly StoredFreeze[],
  rules: FreezeRules,
  today: PlainDate,
): FreezeDecision {
  if (request.startsOn < today) return { ok: false, reason: 'starts_in_past' };
  if (request.months > rules.maxFreezeMonths) {
    return { ok: false, reason: 'too_long', limitMonths: rules.maxFreezeMonths };
  }

  const period = freezePeriod(request.startsOn, request.months);

  if (existing.some((f) => f.startsOn <= period.endsOn && period.startsOn <= f.endsOn)) {
    return { ok: false, reason: 'overlaps_existing' };
  }

  const yearFrom = addMonths(request.startsOn, -12);
  const monthsUsed = existing
    .filter((f) => f.endsOn >= yearFrom)
    .reduce((acc, f) => acc + (differenceInDays(f.endsOn, f.startsOn) + 1) / 30, 0);
  if (monthsUsed + request.months > rules.maxFreezeMonthsPerYear + 0.5) {
    return { ok: false, reason: 'annual_limit', limitMonths: rules.maxFreezeMonthsPerYear };
  }

  return { ok: true, period };
}
