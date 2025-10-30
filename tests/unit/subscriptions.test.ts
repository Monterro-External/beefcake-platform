import { describe, expect, it } from 'vitest';
import { plainDate } from '@/domain/dates';
import {
  type SubscriptionRecord,
  canChangePlan,
  effectiveStatus,
  isBillableIn,
  isInBinding,
} from '@/domain/subscriptions';

function sub(over: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return {
    id: 'sub_1',
    memberId: 'mem_1',
    planId: 'pln_base',
    status: 'active',
    startedOn: plainDate(2026, 1, 1),
    endsOn: null,
    bindingUntil: null,
    cancelledOn: null,
    noticeEndsOn: null,
    ...over,
  };
}

const AUGUST = { from: plainDate(2026, 8, 1), to: plainDate(2026, 8, 31) };

describe('effective status', () => {
  it('is pending before the start date', () => {
    expect(effectiveStatus(sub({ startedOn: plainDate(2026, 9, 1) }), [], plainDate(2026, 8, 26))).toBe(
      'pending',
    );
  });

  it('is active on an open-ended subscription', () => {
    expect(effectiveStatus(sub(), [], plainDate(2026, 8, 26))).toBe('active');
  });

  it('is frozen while a freeze covers the day, even though the row says active', () => {
    const freezes = [{ startsOn: plainDate(2026, 8, 20), endsOn: plainDate(2026, 9, 19) }];
    expect(effectiveStatus(sub(), freezes, plainDate(2026, 8, 26))).toBe('frozen');
  });

  it('is cancelling between notice and end date', () => {
    const record = sub({
      status: 'cancelling',
      cancelledOn: plainDate(2026, 8, 20),
      noticeEndsOn: plainDate(2026, 9, 19),
      endsOn: plainDate(2026, 9, 30),
    });
    expect(effectiveStatus(record, [], plainDate(2026, 8, 26))).toBe('cancelling');
  });

  it('is ended the day after the end date', () => {
    const record = sub({ status: 'cancelling', endsOn: plainDate(2026, 8, 25) });
    expect(effectiveStatus(record, [], plainDate(2026, 8, 26))).toBe('ended');
  });

  it('prefers frozen over cancelling when both apply', () => {
    const record = sub({ status: 'cancelling', endsOn: plainDate(2026, 9, 30) });
    const freezes = [{ startsOn: plainDate(2026, 8, 20), endsOn: plainDate(2026, 9, 19) }];
    expect(effectiveStatus(record, freezes, plainDate(2026, 8, 26))).toBe('frozen');
  });
});

describe('billability', () => {
  it('bills an active subscription', () => {
    expect(isBillableIn(sub(), [], AUGUST)).toBe(true);
  });

  it('does not bill a subscription that has not started', () => {
    expect(isBillableIn(sub({ startedOn: plainDate(2026, 9, 5) }), [], AUGUST)).toBe(false);
  });

  it('does not bill a subscription that ended before the period', () => {
    expect(isBillableIn(sub({ endsOn: plainDate(2026, 7, 31) }), [], AUGUST)).toBe(false);
  });

  it('bills a subscription that ends mid-period', () => {
    expect(isBillableIn(sub({ endsOn: plainDate(2026, 8, 15) }), [], AUGUST)).toBe(true);
  });

  it('does not bill a subscription frozen for the whole period', () => {
    const freezes = [{ startsOn: plainDate(2026, 7, 31), endsOn: plainDate(2026, 8, 31) }];
    expect(isBillableIn(sub(), freezes, AUGUST)).toBe(false);
  });

  it('bills a subscription frozen for part of the period', () => {
    const freezes = [{ startsOn: plainDate(2026, 8, 10), endsOn: plainDate(2026, 8, 31) }];
    expect(isBillableIn(sub(), freezes, AUGUST)).toBe(true);
  });

  it('never bills a pending subscription', () => {
    expect(isBillableIn(sub({ status: 'pending' }), [], AUGUST)).toBe(false);
  });
});

describe('binding periods', () => {
  it('is inclusive of the binding end date', () => {
    const record = sub({ bindingUntil: plainDate(2026, 8, 26) });
    expect(isInBinding(record, plainDate(2026, 8, 26))).toBe(true);
    expect(isInBinding(record, plainDate(2026, 8, 27))).toBe(false);
  });

  it('is false without a binding period', () => {
    expect(isInBinding(sub(), plainDate(2026, 8, 26))).toBe(false);
  });
});

describe('plan change guards', () => {
  const base = { id: 'pln_base', currency: 'SEK', priceMinor: 39900 };
  const plus = { id: 'pln_plus', currency: 'SEK', priceMinor: 59900 };
  const today = plainDate(2026, 8, 26);

  it('allows an upgrade inside a binding period', () => {
    const record = sub({ bindingUntil: plainDate(2027, 1, 1) });
    expect(canChangePlan(record, plus, base, today)).toEqual({ allowed: true });
  });

  it('blocks a downgrade inside a binding period', () => {
    const record = sub({ bindingUntil: plainDate(2027, 1, 1) });
    expect(canChangePlan(record, base, plus, today)).toEqual({ allowed: false, reason: 'in_binding' });
  });

  it('allows a downgrade once the binding period is over', () => {
    const record = sub({ bindingUntil: plainDate(2026, 8, 1) });
    expect(canChangePlan(record, base, plus, today)).toEqual({ allowed: true });
  });

  it('blocks a change to the plan the member is already on', () => {
    expect(canChangePlan(sub(), base, base, today)).toEqual({
      allowed: false,
      reason: 'already_on_plan',
    });
  });

  it('blocks a change across currencies', () => {
    expect(canChangePlan(sub(), { ...plus, currency: 'NOK' }, base, today)).toEqual({
      allowed: false,
      reason: 'currency_mismatch',
    });
  });

  it('blocks any change on an ended subscription', () => {
    const record = sub({ endsOn: plainDate(2026, 8, 1) });
    expect(canChangePlan(record, plus, base, today)).toEqual({ allowed: false, reason: 'ended' });
  });
});
