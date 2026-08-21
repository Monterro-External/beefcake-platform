import { describe, expect, it } from 'vitest';
import { atLocalTime, plainDate } from '@/domain/dates';
import {
  DEFAULT_RETRY_SETTINGS,
  decideRetry,
  isDunningExhausted,
  isRetryable,
  retrySchedule,
} from '@/domain/retry-policy';

const settings = DEFAULT_RETRY_SETTINGS;
const failedAt = atLocalTime(plainDate(2026, 8, 26), 'Europe/Stockholm', 4, 15);

describe('which failures are worth retrying', () => {
  it('retries a transient failure', () => {
    expect(isRetryable('insufficient_funds')).toBe(true);
    expect(isRetryable('technical')).toBe(true);
    expect(isRetryable('rejected_by_bank')).toBe(true);
  });

  it('never retries a dead mandate or a closed account', () => {
    expect(isRetryable('mandate_cancelled')).toBe(false);
    expect(isRetryable('account_closed')).toBe(false);
  });
});

/** A capped policy, which is what an operator sets when they want one. */
const capped = { retryAttempts: 3, retryIntervalDays: 3 };

describe('a capped policy of three attempts, three days apart', () => {
  it('schedules the second attempt three days out', () => {
    const decision = decideRetry({
      attempt: 1,
      attemptedAt: failedAt,
      failureCode: 'insufficient_funds',
      settings: capped,
      timezone: 'Europe/Stockholm',
    });
    expect(decision).toMatchObject({ retry: true, nextAttempt: 2, nextAttemptOn: '2026-08-29' });
  });

  it('schedules the third attempt three days after the second', () => {
    const decision = decideRetry({
      attempt: 2,
      attemptedAt: atLocalTime(plainDate(2026, 8, 29), 'Europe/Stockholm', 4, 15),
      failureCode: 'insufficient_funds',
      settings: capped,
      timezone: 'Europe/Stockholm',
    });
    expect(decision).toMatchObject({ retry: true, nextAttempt: 3, nextAttemptOn: '2026-09-01' });
  });

  it('gives up after the third attempt', () => {
    const decision = decideRetry({
      attempt: 3,
      attemptedAt: failedAt,
      failureCode: 'insufficient_funds',
      settings: capped,
      timezone: 'Europe/Stockholm',
    });
    expect(decision).toEqual({ retry: false, reason: 'attempts_exhausted' });
  });

  it('gives up immediately on a terminal failure, whatever the attempt', () => {
    expect(
      decideRetry({
        attempt: 1,
        attemptedAt: failedAt,
        failureCode: 'mandate_cancelled',
        settings: capped,
        timezone: 'Europe/Stockholm',
      }),
    ).toEqual({ retry: false, reason: 'terminal_failure' });
  });

  it('produces exactly three notifications over eight days', () => {
    expect(retrySchedule(plainDate(2026, 8, 26), capped)).toEqual([
      '2026-08-26',
      '2026-08-29',
      '2026-09-01',
    ]);
  });
});

describe('an uncapped policy', () => {
  it('is what a tenant gets when they have not chosen one', () => {
    expect(settings.retryAttempts).toBe(0);
  });

  it('keeps presenting the charge', () => {
    expect(
      decideRetry({
        attempt: 9,
        attemptedAt: failedAt,
        failureCode: 'insufficient_funds',
        settings,
        timezone: 'Europe/Stockholm',
      }),
    ).toMatchObject({ retry: true, nextAttempt: 10 });
  });

  it('still stops at a terminal failure', () => {
    expect(
      decideRetry({
        attempt: 2,
        attemptedAt: failedAt,
        failureCode: 'account_closed',
        settings,
        timezone: 'Europe/Stockholm',
      }),
    ).toEqual({ retry: false, reason: 'terminal_failure' });
  });
});

describe('tenant overrides', () => {
  it('honours a longer interval', () => {
    const decision = decideRetry({
      attempt: 1,
      attemptedAt: failedAt,
      failureCode: 'technical',
      settings: { retryAttempts: 4, retryIntervalDays: 7 },
      timezone: 'Europe/Stockholm',
    });
    expect(decision).toMatchObject({ nextAttemptOn: '2026-09-02' });
  });

  it('honours a single-attempt policy by never retrying', () => {
    expect(
      decideRetry({
        attempt: 1,
        attemptedAt: failedAt,
        failureCode: 'technical',
        settings: { retryAttempts: 1, retryIntervalDays: 3 },
        timezone: 'Europe/Stockholm',
      }),
    ).toEqual({ retry: false, reason: 'attempts_exhausted' });
  });

  it('produces the schedule the tenant configured', () => {
    expect(retrySchedule(plainDate(2026, 8, 26), { retryAttempts: 4, retryIntervalDays: 7 })).toEqual([
      '2026-08-26',
      '2026-09-02',
      '2026-09-09',
      '2026-09-16',
    ]);
  });
});

describe('scheduling lands on the right bank day', () => {
  it('schedules to the start of the day in the tenant timezone', () => {
    const decision = decideRetry({
      attempt: 1,
      attemptedAt: failedAt,
      failureCode: 'technical',
      settings: capped,
      timezone: 'Europe/Oslo',
    });
    if (!decision.retry) throw new Error('expected a retry');
    expect(decision.nextAttemptAt.toISOString()).toBe('2026-08-28T22:00:00.000Z');
  });

  it('a failure just before local midnight retries three days later, not four', () => {
    const lateFailure = atLocalTime(plainDate(2026, 8, 26), 'Europe/Helsinki', 23, 50);
    const decision = decideRetry({
      attempt: 1,
      attemptedAt: lateFailure,
      failureCode: 'technical',
      settings: capped,
      timezone: 'Europe/Helsinki',
    });
    expect(decision).toMatchObject({ nextAttemptOn: '2026-08-29' });
  });

  it('crosses a month boundary', () => {
    const decision = decideRetry({
      attempt: 1,
      attemptedAt: atLocalTime(plainDate(2026, 8, 30), 'Europe/Stockholm', 4, 0),
      failureCode: 'technical',
      settings: capped,
      timezone: 'Europe/Stockholm',
    });
    expect(decision).toMatchObject({ nextAttemptOn: '2026-09-02' });
  });
});

describe('dunning', () => {
  it('is exhausted at the configured attempt count', () => {
    expect(isDunningExhausted(2, capped)).toBe(false);
    expect(isDunningExhausted(3, capped)).toBe(true);
    expect(isDunningExhausted(3, { retryAttempts: 5, retryIntervalDays: 3 })).toBe(false);
  });

  it('is never exhausted under an uncapped policy', () => {
    expect(isDunningExhausted(50, settings)).toBe(false);
  });
});
