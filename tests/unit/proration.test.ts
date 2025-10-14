import { describe, expect, it } from 'vitest';
import {
  type PlanSnapshot,
  periodLengthInDays,
  prorateFirstPeriod,
  prorateFrozenDays,
  proratePlanChange,
  remainingDaysInPeriod,
} from '@/domain/proration';
import { plainDate } from '@/domain/dates';
import { money, subtract } from '@/domain/money';

const MARCH = { from: plainDate(2026, 3, 1), to: plainDate(2026, 3, 31) };
const FEBRUARY = { from: plainDate(2026, 2, 1), to: plainDate(2026, 2, 28) };

const base: PlanSnapshot = { id: 'pln_base', name: 'Bas', priceMinor: 39900, currency: 'SEK' };
const plus: PlanSnapshot = { id: 'pln_plus', name: 'Plus', priceMinor: 59900, currency: 'SEK' };

describe('period arithmetic', () => {
  it('counts an inclusive period', () => {
    expect(periodLengthInDays(MARCH)).toBe(31);
    expect(periodLengthInDays(FEBRUARY)).toBe(28);
  });

  it('refuses a backwards period', () => {
    expect(() => periodLengthInDays({ from: MARCH.to, to: MARCH.from })).toThrow(RangeError);
  });

  it('counts the change day as belonging to the new plan', () => {
    expect(remainingDaysInPeriod(MARCH, plainDate(2026, 3, 12))).toBe(20);
    expect(remainingDaysInPeriod(MARCH, plainDate(2026, 3, 1))).toBe(31);
    expect(remainingDaysInPeriod(MARCH, plainDate(2026, 3, 31))).toBe(1);
  });

  it('clamps a change dated outside the period', () => {
    expect(remainingDaysInPeriod(MARCH, plainDate(2026, 2, 20))).toBe(31);
    expect(remainingDaysInPeriod(MARCH, plainDate(2026, 4, 2))).toBe(0);
  });
});

describe('mid-period upgrade', () => {
  it('charges the difference for the remaining days only', () => {
    const result = proratePlanChange({
      period: MARCH,
      changeOn: plainDate(2026, 3, 12),
      from: base,
      to: plus,
    });
    // 20/31 of 399.00 credited, 20/31 of 599.00 charged.
    expect(result.lines.map((l) => l.amount.minor)).toEqual([25742, 38645]);
    expect(result.net).toEqual(money(12903, 'SEK'));
  });

  it('never charges more than the difference between the two plans', () => {
    for (let day = 1; day <= 31; day += 1) {
      const result = proratePlanChange({
        period: MARCH,
        changeOn: plainDate(2026, 3, day),
        from: base,
        to: plus,
      });
      expect(result.net.minor).toBeGreaterThanOrEqual(0);
      expect(result.net.minor).toBeLessThanOrEqual(plus.priceMinor - base.priceMinor);
    }
  });

  it('a change on the first day of the period is the full price difference', () => {
    const result = proratePlanChange({
      period: MARCH,
      changeOn: MARCH.from,
      from: base,
      to: plus,
    });
    expect(result.net).toEqual(subtract(money(plus.priceMinor, 'SEK'), money(base.priceMinor, 'SEK')));
  });

  it('produces one credit line and one charge line', () => {
    const result = proratePlanChange({
      period: MARCH,
      changeOn: plainDate(2026, 3, 20),
      from: base,
      to: plus,
    });
    expect(result.lines.map((l) => l.kind)).toEqual(['credit', 'charge']);
    expect(result.lines[0]?.planId).toBe(base.id);
    expect(result.lines[1]?.planId).toBe(plus.id);
  });
});

describe('mid-period downgrade', () => {
  it('nets negative, leaving the member in credit', () => {
    const result = proratePlanChange({
      period: MARCH,
      changeOn: plainDate(2026, 3, 12),
      from: plus,
      to: base,
    });
    expect(result.net.minor).toBeLessThan(0);
  });

  it('an upgrade followed by an immediate downgrade cancels out', () => {
    const changeOn = plainDate(2026, 3, 17);
    const up = proratePlanChange({ period: MARCH, changeOn, from: base, to: plus });
    const down = proratePlanChange({ period: MARCH, changeOn, from: plus, to: base });
    expect(up.net.minor + down.net.minor).toBe(0);
  });
});

describe('no-op changes', () => {
  it('changing to the same plan costs nothing', () => {
    const result = proratePlanChange({
      period: MARCH,
      changeOn: plainDate(2026, 3, 12),
      from: base,
      to: base,
    });
    expect(result.lines).toHaveLength(0);
    expect(result.net.minor).toBe(0);
  });

  it('a change after the period ends costs nothing', () => {
    const result = proratePlanChange({
      period: MARCH,
      changeOn: plainDate(2026, 4, 5),
      from: base,
      to: plus,
    });
    expect(result.net.minor).toBe(0);
  });

  it('refuses to cross currencies', () => {
    expect(() =>
      proratePlanChange({
        period: MARCH,
        changeOn: plainDate(2026, 3, 12),
        from: base,
        to: { ...plus, currency: 'NOK' },
      }),
    ).toThrow(/currencies/);
  });
});

describe('short and long months', () => {
  it('the same day-of-month costs more in February than in March', () => {
    const feb = proratePlanChange({
      period: FEBRUARY,
      changeOn: plainDate(2026, 2, 15),
      from: base,
      to: plus,
    });
    const mar = proratePlanChange({
      period: MARCH,
      changeOn: plainDate(2026, 3, 15),
      from: base,
      to: plus,
    });
    // 14/28 of the period remains in February, 17/31 in March.
    expect(feb.remainingDays / feb.periodDays).toBeGreaterThan(0.49);
    expect(mar.remainingDays / mar.periodDays).toBeGreaterThan(feb.remainingDays / feb.periodDays);
  });
});

describe('first period', () => {
  it('a member joining on the 12th pays for 20 days', () => {
    const result = prorateFirstPeriod({ period: MARCH, startsOn: plainDate(2026, 3, 12), plan: base });
    expect(result.remainingDays).toBe(20);
    expect(result.net).toEqual(money(25742, 'SEK'));
  });

  it('a member joining on the first pays the full price', () => {
    const result = prorateFirstPeriod({ period: MARCH, startsOn: MARCH.from, plan: base });
    expect(result.net).toEqual(money(base.priceMinor, 'SEK'));
  });
});

describe('frozen days', () => {
  it('bills only the unfrozen part of the period', () => {
    const result = prorateFrozenDays({ period: MARCH, plan: base, frozenDays: 10 });
    expect(result.net).toEqual(money(27029, 'SEK')); // 21 of 31 days
  });

  it('a fully frozen period is free', () => {
    const result = prorateFrozenDays({ period: MARCH, plan: base, frozenDays: 31 });
    expect(result.net.minor).toBe(0);
  });

  it('more frozen days than the period has is still free, not negative', () => {
    const result = prorateFrozenDays({ period: MARCH, plan: base, frozenDays: 45 });
    expect(result.net.minor).toBe(0);
  });
});
