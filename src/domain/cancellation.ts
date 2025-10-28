/**
 * Cancellation and notice periods.
 *
 * A member gives notice, the notice period runs, and the subscription ends at
 * the end of the last billing period the notice covers. If the member is still
 * inside a binding period the subscription runs to the end of that instead,
 * whichever is later. Consumer law in all four markets requires that the notice
 * period is honoured but never that we bill beyond it, so the two dates are
 * tracked separately:
 *
 *   notice_ends_on : requested_on + notice_period_days
 *   ends_on        : the later of notice_ends_on and binding_until, rounded up
 *                    to the end of the billing period it falls in
 *
 * Access is granted up to and including `ends_on`. There is no grace period on
 * a cancellation: the card stops working the day after.
 */

import {
  type BillingPeriod,
  type PlainDate,
  addDays,
  billingPeriodOf,
  billingPeriodRange,
  differenceInDays,
  lastDayOfMonth,
  maxPlainDate,
} from './dates';

export type CancellationDriver = 'notice' | 'binding';

export interface CancellationRules {
  readonly noticePeriodDays: number;
  /** When true, the subscription runs to the end of the billing period. */
  readonly billToEndOfPeriod: boolean;
}

export interface CancellationInput {
  readonly requestedOn: PlainDate;
  readonly bindingUntil: PlainDate | null;
  readonly rules: CancellationRules;
}

export interface CancellationPlan {
  readonly requestedOn: PlainDate;
  readonly noticeEndsOn: PlainDate;
  readonly endsOn: PlainDate;
  readonly driver: CancellationDriver;
  readonly lastBilledPeriod: BillingPeriod;
  readonly daysOfAccessLeft: number;
}

export function planCancellation(input: CancellationInput): CancellationPlan {
  const { requestedOn, bindingUntil, rules } = input;
  if (rules.noticePeriodDays < 0) {
    throw new RangeError(`Notice period must not be negative, got ${rules.noticePeriodDays}`);
  }

  const noticeEndsOn = addDays(requestedOn, rules.noticePeriodDays);
  const bindingEnd = bindingUntil ?? noticeEndsOn;
  const driver: CancellationDriver = bindingEnd > noticeEndsOn ? 'binding' : 'notice';
  const rawEnd = maxPlainDate(noticeEndsOn, bindingEnd);
  const endsOn = rules.billToEndOfPeriod ? lastDayOfMonth(rawEnd) : rawEnd;

  return {
    requestedOn,
    noticeEndsOn,
    endsOn,
    driver,
    lastBilledPeriod: billingPeriodOf(endsOn),
    daysOfAccessLeft: differenceInDays(endsOn, requestedOn),
  };
}

/**
 * Periods still to be billed for a subscription that is cancelling, given the
 * period the next payment run covers. Empty once the run has passed `endsOn`.
 */
export function periodsStillBillable(plan: CancellationPlan, nextPeriod: BillingPeriod): BillingPeriod[] {
  const out: BillingPeriod[] = [];
  let period = nextPeriod;
  for (let guard = 0; guard < 36; guard += 1) {
    const range = billingPeriodRange(period);
    if (range.from > plan.endsOn) break;
    out.push(period);
    period = billingPeriodOf(addDays(range.to, 1));
  }
  return out;
}

/** True once the subscription has run out, i.e. from the day after `ends_on`. */
export function hasEnded(plan: Pick<CancellationPlan, 'endsOn'>, on: PlainDate): boolean {
  return on > plan.endsOn;
}

export interface WithdrawalInput {
  readonly requestedOn: PlainDate;
  readonly withdrawnOn: PlainDate;
  readonly endsOn: PlainDate;
}

/**
 * A member can take a cancellation back at any point before it takes effect.
 * Front desk does this constantly, usually after offering a freeze instead.
 */
export function canWithdrawCancellation(input: WithdrawalInput): boolean {
  return input.withdrawnOn <= input.endsOn && input.withdrawnOn >= input.requestedOn;
}
