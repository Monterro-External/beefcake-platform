import { describe, expect, it } from 'vitest';
import { plainDate } from '@/domain/dates';
import {
  canWithdrawCancellation,
  hasEnded,
  periodsStillBillable,
  planCancellation,
} from '@/domain/cancellation';

const thirtyDays = { noticePeriodDays: 30, billToEndOfPeriod: true };
const noRounding = { noticePeriodDays: 30, billToEndOfPeriod: false };

describe('notice period', () => {
  it('runs from the day notice is given', () => {
    const plan = planCancellation({
      requestedOn: plainDate(2026, 8, 26),
      bindingUntil: null,
      rules: noRounding,
    });
    expect(plan.noticeEndsOn).toBe('2026-09-25');
    expect(plan.endsOn).toBe('2026-09-25');
    expect(plan.driver).toBe('notice');
  });

  it('rounds up to the end of the billing period when the tenant bills that way', () => {
    const plan = planCancellation({
      requestedOn: plainDate(2026, 8, 26),
      bindingUntil: null,
      rules: thirtyDays,
    });
    expect(plan.noticeEndsOn).toBe('2026-09-25');
    expect(plan.endsOn).toBe('2026-09-30');
    expect(plan.lastBilledPeriod).toBe('2026-09');
  });

  it('handles a zero notice period', () => {
    const plan = planCancellation({
      requestedOn: plainDate(2026, 8, 26),
      bindingUntil: null,
      rules: { noticePeriodDays: 0, billToEndOfPeriod: false },
    });
    expect(plan.endsOn).toBe('2026-08-26');
  });

  it('refuses a negative notice period', () => {
    expect(() =>
      planCancellation({
        requestedOn: plainDate(2026, 8, 26),
        bindingUntil: null,
        rules: { noticePeriodDays: -1, billToEndOfPeriod: false },
      }),
    ).toThrow(RangeError);
  });

  it('crosses a year boundary correctly', () => {
    const plan = planCancellation({
      requestedOn: plainDate(2026, 12, 20),
      bindingUntil: null,
      rules: noRounding,
    });
    expect(plan.endsOn).toBe('2027-01-19');
  });
});

describe('binding periods', () => {
  it('a binding period beyond the notice wins', () => {
    const plan = planCancellation({
      requestedOn: plainDate(2026, 8, 26),
      bindingUntil: plainDate(2027, 2, 14),
      rules: noRounding,
    });
    expect(plan.endsOn).toBe('2027-02-14');
    expect(plan.driver).toBe('binding');
  });

  it('a binding period already inside the notice does not shorten it', () => {
    const plan = planCancellation({
      requestedOn: plainDate(2026, 8, 26),
      bindingUntil: plainDate(2026, 9, 1),
      rules: noRounding,
    });
    expect(plan.endsOn).toBe('2026-09-25');
    expect(plan.driver).toBe('notice');
  });

  it('a binding period that ends exactly with the notice is not a binding case', () => {
    const plan = planCancellation({
      requestedOn: plainDate(2026, 8, 26),
      bindingUntil: plainDate(2026, 9, 25),
      rules: noRounding,
    });
    expect(plan.driver).toBe('notice');
  });
});

describe('remaining billable periods', () => {
  it('lists every period up to and including the end date', () => {
    const plan = planCancellation({
      requestedOn: plainDate(2026, 8, 26),
      bindingUntil: plainDate(2026, 11, 30),
      rules: thirtyDays,
    });
    expect(periodsStillBillable(plan, '2026-09')).toEqual(['2026-09', '2026-10', '2026-11']);
  });

  it('is empty once the run is past the end date', () => {
    const plan = planCancellation({
      requestedOn: plainDate(2026, 8, 26),
      bindingUntil: null,
      rules: thirtyDays,
    });
    expect(periodsStillBillable(plan, '2026-11')).toEqual([]);
  });
});

describe('has the subscription run out', () => {
  it('is false on the end date and true the day after', () => {
    const plan = { endsOn: plainDate(2026, 9, 30) };
    expect(hasEnded(plan, plainDate(2026, 9, 30))).toBe(false);
    expect(hasEnded(plan, plainDate(2026, 10, 1))).toBe(true);
  });
});

describe('withdrawing a cancellation', () => {
  it('is allowed up to and including the end date', () => {
    const input = {
      requestedOn: plainDate(2026, 8, 26),
      endsOn: plainDate(2026, 9, 30),
      withdrawnOn: plainDate(2026, 9, 30),
    };
    expect(canWithdrawCancellation(input)).toBe(true);
  });

  it('is not allowed after the subscription has ended', () => {
    expect(
      canWithdrawCancellation({
        requestedOn: plainDate(2026, 8, 26),
        endsOn: plainDate(2026, 9, 30),
        withdrawnOn: plainDate(2026, 10, 1),
      }),
    ).toBe(false);
  });
});
