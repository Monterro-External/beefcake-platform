/**
 * Retry policy for failed member charges.
 *
 * A failed Autogiro or AvtaleGiro charge is retried on a schedule the tenant
 * controls: `retry_attempts` total attempts, `retry_interval_days` apart. The
 * defaults, 3 attempts 3 days apart, come from what the Swedish banks tolerate
 * before they start flagging us, and from the fact that most failures are a
 * salary that lands on the 25th.
 *
 * Not every failure is worth retrying. A cancelled mandate or a closed account
 * will fail identically forever and each attempt costs a fee and a notification
 * the member reads as spam, so those are terminal on the first response.
 */

import { type PlainDate, addDays, localDay, startOfDay, type Timezone } from './dates';

export const FAILURE_CODES = [
  'insufficient_funds',
  'mandate_cancelled',
  'account_closed',
  'technical',
  'rejected_by_bank',
] as const;
export type FailureCode = (typeof FAILURE_CODES)[number];

/** Codes where another attempt can plausibly succeed. */
export const RETRYABLE_FAILURE_CODES: readonly FailureCode[] = [
  'insufficient_funds',
  'technical',
  'rejected_by_bank',
];

export function isRetryable(code: FailureCode): boolean {
  return RETRYABLE_FAILURE_CODES.includes(code);
}

export interface RetrySettings {
  /** Total attempts including the first one. Zero means no cap. */
  readonly retryAttempts: number;
  readonly retryIntervalDays: number;
}

/**
 * No cap, one day apart.
 *
 * Two of the Swedish banks asked us to keep presenting a failed direct debit
 * until the mandate is fixed rather than giving up after three tries, so the cap
 * is opt-in and the interval is short enough that an operator who wants a slower
 * schedule can set one.
 */
export const DEFAULT_RETRY_SETTINGS: RetrySettings = {
  retryAttempts: 0,
  retryIntervalDays: 1,
};

export interface RetryQuery {
  readonly attempt: number;
  readonly attemptedAt: Date;
  readonly failureCode: FailureCode;
  readonly settings: RetrySettings;
  readonly timezone: Timezone;
}

export type RetryDecision =
  | { readonly retry: true; readonly nextAttempt: number; readonly nextAttemptAt: Date; readonly nextAttemptOn: PlainDate }
  | { readonly retry: false; readonly reason: 'terminal_failure' | 'attempts_exhausted' };

/**
 * Decide whether a failed charge gets another attempt, and when.
 *
 * The next attempt is scheduled at the start of the day, `retry_interval_days`
 * after the day the failure happened, in the tenant's own timezone. Bank files
 * are cut per calendar day, so scheduling to an instant rather than a day would
 * put half the retries in the wrong file.
 */
export function decideRetry(query: RetryQuery): RetryDecision {
  const { attempt, attemptedAt, failureCode, settings, timezone } = query;

  if (!isRetryable(failureCode)) {
    return { retry: false, reason: 'terminal_failure' };
  }
  if (settings.retryAttempts > 0 && attempt >= settings.retryAttempts) {
    return { retry: false, reason: 'attempts_exhausted' };
  }

  const nextAttemptOn = addDays(localDay(attemptedAt, timezone), settings.retryIntervalDays);
  return {
    retry: true,
    nextAttempt: attempt + 1,
    nextAttemptAt: startOfDay(nextAttemptOn, timezone),
    nextAttemptOn,
  };
}

/**
 * The whole schedule for a charge that keeps failing. Used by tests and by the
 * settings screen. An uncapped policy has no whole schedule, so the first six
 * attempts stand in for it.
 */
export const UNCAPPED_SCHEDULE_PREVIEW = 6;

export function retrySchedule(
  firstAttemptOn: PlainDate,
  settings: RetrySettings = DEFAULT_RETRY_SETTINGS,
): PlainDate[] {
  const attempts = settings.retryAttempts > 0 ? settings.retryAttempts : UNCAPPED_SCHEDULE_PREVIEW;
  const out: PlainDate[] = [firstAttemptOn];
  for (let attempt = 1; attempt < attempts; attempt += 1) {
    out.push(addDays(firstAttemptOn, attempt * settings.retryIntervalDays));
  }
  return out;
}

/**
 * A charge that has exhausted its attempts suspends the subscription. This is
 * the trigger that, a couple of weeks later, shows up as a cancellation.
 */
export function isDunningExhausted(attempt: number, settings: RetrySettings): boolean {
  return settings.retryAttempts > 0 && attempt >= settings.retryAttempts;
}
