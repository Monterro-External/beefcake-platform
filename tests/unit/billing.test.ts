import { describe, expect, it } from 'vitest';
import { plainDate } from '@/domain/dates';
import { computePeriodCharge, frozenDaysBetween, receiptLines, vatOf } from '@/domain/billing';
import { money } from '@/domain/money';
import type { PlanSnapshot } from '@/domain/proration';

const MARCH = { from: plainDate(2026, 3, 1), to: plainDate(2026, 3, 31) };

const base: PlanSnapshot = { id: 'pln_base', name: 'Bas', priceMinor: 39900, currency: 'SEK' };
const plus: PlanSnapshot = { id: 'pln_plus', name: 'Plus', priceMinor: 59900, currency: 'SEK' };

function charge(over: Partial<Parameters<typeof computePeriodCharge>[0]> = {}) {
  return computePeriodCharge({
    period: MARCH,
    plan: base,
    previousPlan: null,
    planChangeOn: null,
    subscriptionStartedOn: plainDate(2025, 1, 1),
    subscriptionEndsOn: null,
    freezes: [],
    ...over,
  });
}

describe('a full month', () => {
  it('charges the plan price exactly', () => {
    const result = charge();
    expect(result.amount).toEqual(money(39900, 'SEK'));
    expect(result.billableDays).toBe(31);
    expect(result.skip).toBe(false);
  });

  it('produces one receipt line with no day count', () => {
    expect(receiptLines(charge())).toEqual([
      { description: 'Bas', quantity: 31, unit: 'day', amountMinor: 39900, currency: 'SEK' },
    ]);
  });
});

describe('a subscription starting or ending mid-period', () => {
  it('charges from the start date', () => {
    const result = charge({ subscriptionStartedOn: plainDate(2026, 3, 12) });
    expect(result.billableDays).toBe(20);
    expect(result.amount).toEqual(money(25742, 'SEK'));
  });

  it('charges up to the end date', () => {
    const result = charge({ subscriptionEndsOn: plainDate(2026, 3, 10) });
    expect(result.billableDays).toBe(10);
  });

  it('skips a period entirely before the subscription starts', () => {
    const result = charge({ subscriptionStartedOn: plainDate(2026, 4, 1) });
    expect(result.skip).toBe(true);
    expect(result.amount.minor).toBe(0);
  });

  it('skips a period entirely after the subscription ends', () => {
    const result = charge({ subscriptionEndsOn: plainDate(2026, 2, 28) });
    expect(result.skip).toBe(true);
  });
});

describe('a mid-period plan change', () => {
  it('bills each plan for its own stretch of the period', () => {
    const result = charge({
      plan: plus,
      previousPlan: base,
      planChangeOn: plainDate(2026, 3, 12),
    });
    expect(result.segments.map((s) => [s.planId, s.billableDays])).toEqual([
      ['pln_base', 11],
      ['pln_plus', 20],
    ]);
    // Each plan is charged for the stretch it was in force for.
    expect(result.segments.map((s) => s.amount.minor)).toEqual([39900, 59900]);
    expect(result.amount).toEqual(money(99800, 'SEK'));
  });

  it('never charges more than the two plans together', () => {
    for (let day = 2; day <= 31; day += 1) {
      const result = charge({
        plan: plus,
        previousPlan: base,
        planChangeOn: plainDate(2026, 3, day),
      });
      expect(result.amount.minor).toBeLessThanOrEqual(plus.priceMinor + base.priceMinor);
      expect(result.amount.minor).toBeGreaterThanOrEqual(base.priceMinor - 1);
    }
  });

  it('a change on the first day of the period is just the new plan', () => {
    const result = charge({ plan: plus, previousPlan: base, planChangeOn: MARCH.from });
    expect(result.segments).toHaveLength(1);
    expect(result.amount).toEqual(money(59900, 'SEK'));
  });

  it('ignores a change dated outside the period', () => {
    const result = charge({ plan: plus, previousPlan: base, planChangeOn: plainDate(2026, 2, 10) });
    expect(result.segments).toHaveLength(1);
    expect(result.amount).toEqual(money(59900, 'SEK'));
  });

  it('describes both segments on the receipt', () => {
    const lines = receiptLines(
      charge({ plan: plus, previousPlan: base, planChangeOn: plainDate(2026, 3, 12) }),
    );
    expect(lines.map((l) => l.description)).toEqual([
      'Bas (11 of 31 days)',
      'Plus (20 of 31 days)',
    ]);
  });

  it('handles a downgrade the same way', () => {
    const result = charge({ plan: base, previousPlan: plus, planChangeOn: plainDate(2026, 3, 12) });
    expect(result.amount.minor).toBeGreaterThan(base.priceMinor);
  });
});

describe('freezes', () => {
  it('does not bill frozen days', () => {
    const result = charge({
      freezes: [{ startsOn: plainDate(2026, 3, 10), endsOn: plainDate(2026, 3, 19) }],
    });
    expect(result.frozenDays).toBe(10);
    expect(result.billableDays).toBe(21);
  });

  it('skips a period that is frozen end to end', () => {
    const result = charge({
      freezes: [{ startsOn: plainDate(2026, 2, 20), endsOn: plainDate(2026, 4, 5) }],
    });
    expect(result.skip).toBe(true);
    expect(result.amount.minor).toBe(0);
  });

  it('counts overlapping freezes once', () => {
    expect(
      frozenDaysBetween(
        [
          { startsOn: plainDate(2026, 3, 1), endsOn: plainDate(2026, 3, 20) },
          { startsOn: plainDate(2026, 3, 10), endsOn: plainDate(2026, 3, 25) },
        ],
        MARCH.from,
        MARCH.to,
      ),
    ).toBe(25);
  });

  it('counts adjacent freezes without double counting the join', () => {
    expect(
      frozenDaysBetween(
        [
          { startsOn: plainDate(2026, 3, 1), endsOn: plainDate(2026, 3, 10) },
          { startsOn: plainDate(2026, 3, 11), endsOn: plainDate(2026, 3, 20) },
        ],
        MARCH.from,
        MARCH.to,
      ),
    ).toBe(20);
  });

  it('ignores freezes outside the window', () => {
    expect(
      frozenDaysBetween(
        [{ startsOn: plainDate(2026, 1, 1), endsOn: plainDate(2026, 1, 31) }],
        MARCH.from,
        MARCH.to,
      ),
    ).toBe(0);
  });

  it('applies a freeze to the right side of a plan change', () => {
    const result = charge({
      plan: plus,
      previousPlan: base,
      planChangeOn: plainDate(2026, 3, 12),
      freezes: [{ startsOn: plainDate(2026, 3, 20), endsOn: plainDate(2026, 3, 31) }],
    });
    expect(result.segments.map((s) => s.frozenDays)).toEqual([0, 12]);
    expect(result.segments.map((s) => s.billableDays)).toEqual([11, 8]);
    // The frozen part of the second stretch is not billed.
    expect(result.segments[1]?.amount.minor).toBeLessThan(plus.priceMinor);
  });
});

describe('VAT', () => {
  it('extracts the VAT included in a gross amount', () => {
    // 399.00 SEK gross at 6% contains 22.58 SEK of VAT.
    expect(vatOf(money(39900, 'SEK'), 0.06)).toEqual(money(2258, 'SEK'));
    expect(vatOf(money(54900, 'NOK'), 0.25)).toEqual(money(10980, 'NOK'));
  });
});
