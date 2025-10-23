import { describe, expect, it } from 'vitest';
import { plainDate } from '@/domain/dates';
import {
  type StoredFreeze,
  activeFreezeOn,
  decideFreeze,
  extendBinding,
  freezePeriod,
  frozenDaysInPeriod,
  isFrozenOn,
} from '@/domain/freezes';

describe('freezePeriod inside a month', () => {
  it('a one-month freeze from the 15th resumes on the 15th', () => {
    expect(freezePeriod(plainDate(2026, 3, 15), 1)).toMatchObject({
      startsOn: '2026-03-15',
      endsOn: '2026-04-14',
      resumesOn: '2026-04-15',
      days: 31,
    });
  });

  it('a three-month freeze from the 10th resumes three months later', () => {
    expect(freezePeriod(plainDate(2026, 6, 10), 3)).toMatchObject({
      endsOn: '2026-09-09',
      resumesOn: '2026-09-10',
    });
  });

  it('resumesOn is always the day after endsOn', () => {
    for (let day = 1; day <= 28; day += 1) {
      const period = freezePeriod(plainDate(2026, 1, day), 1);
      expect(period.resumesOn).toBe(plainDate(2026, 2, day));
    }
  });
});

describe('freezePeriod across a month boundary', () => {
  it('31 January plus one month ends on the last day of February', () => {
    expect(freezePeriod(plainDate(2026, 1, 31), 1)).toMatchObject({
      startsOn: '2026-01-31',
      endsOn: '2026-02-28',
      resumesOn: '2026-03-01',
      days: 29,
    });
  });

  it('31 January in a leap year ends on 29 February', () => {
    expect(freezePeriod(plainDate(2024, 1, 31), 1)).toMatchObject({
      endsOn: '2024-02-29',
      resumesOn: '2024-03-01',
    });
  });

  it('31 March plus one month ends on 30 April', () => {
    expect(freezePeriod(plainDate(2026, 3, 31), 1)).toMatchObject({
      endsOn: '2026-04-30',
      resumesOn: '2026-05-01',
    });
  });

  it('30 April plus one month ends on 31 May, because April has no 31st', () => {
    expect(freezePeriod(plainDate(2026, 4, 30), 1)).toMatchObject({
      endsOn: '2026-05-31',
      resumesOn: '2026-06-01',
    });
  });

  it('28 February in a non-leap year is a month end', () => {
    expect(freezePeriod(plainDate(2026, 2, 28), 1)).toMatchObject({
      endsOn: '2026-03-31',
      resumesOn: '2026-04-01',
    });
  });

  it('28 February in a leap year is not a month end', () => {
    expect(freezePeriod(plainDate(2024, 2, 28), 1)).toMatchObject({
      endsOn: '2024-03-27',
      resumesOn: '2024-03-28',
    });
  });

  it('a month-end freeze never resumes mid-month, for any month of the year', () => {
    for (let month = 1; month <= 12; month += 1) {
      const start = freezePeriod(plainDate(2026, month, 1), 1).endsOn;
      const period = freezePeriod(start, 1);
      expect(period.resumesOn.endsWith('-01')).toBe(true);
    }
  });

  it('a freeze over the new year lands in the right year', () => {
    expect(freezePeriod(plainDate(2026, 12, 31), 1)).toMatchObject({
      endsOn: '2027-01-31',
      resumesOn: '2027-02-01',
    });
  });
});

describe('freezePeriod validation', () => {
  it('refuses part months', () => {
    expect(() => freezePeriod(plainDate(2026, 3, 1), 0)).toThrow(RangeError);
    expect(() => freezePeriod(plainDate(2026, 3, 1), 1.5)).toThrow(RangeError);
  });
});

describe('is the member frozen', () => {
  const freezes: StoredFreeze[] = [
    { startsOn: plainDate(2026, 1, 31), endsOn: plainDate(2026, 2, 28) },
    { startsOn: plainDate(2026, 7, 1), endsOn: plainDate(2026, 8, 31) },
  ];

  it('is inclusive of both ends', () => {
    expect(isFrozenOn(freezes, plainDate(2026, 1, 31))).toBe(true);
    expect(isFrozenOn(freezes, plainDate(2026, 2, 28))).toBe(true);
    expect(isFrozenOn(freezes, plainDate(2026, 3, 1))).toBe(false);
    expect(isFrozenOn(freezes, plainDate(2026, 1, 30))).toBe(false);
  });

  it('finds which freeze applies', () => {
    expect(activeFreezeOn(freezes, plainDate(2026, 7, 15))?.startsOn).toBe('2026-07-01');
    expect(activeFreezeOn(freezes, plainDate(2026, 6, 15))).toBeUndefined();
  });
});

describe('frozen days inside a billing period', () => {
  it('counts only the overlap', () => {
    const freezes: StoredFreeze[] = [{ startsOn: plainDate(2026, 1, 31), endsOn: plainDate(2026, 2, 28) }];
    expect(frozenDaysInPeriod(freezes, { from: plainDate(2026, 1, 1), to: plainDate(2026, 1, 31) })).toBe(1);
    expect(frozenDaysInPeriod(freezes, { from: plainDate(2026, 2, 1), to: plainDate(2026, 2, 28) })).toBe(28);
    expect(frozenDaysInPeriod(freezes, { from: plainDate(2026, 3, 1), to: plainDate(2026, 3, 31) })).toBe(0);
  });

  it('counts an overlapping pair of freezes once', () => {
    const freezes: StoredFreeze[] = [
      { startsOn: plainDate(2026, 3, 1), endsOn: plainDate(2026, 3, 20) },
      { startsOn: plainDate(2026, 3, 10), endsOn: plainDate(2026, 3, 25) },
    ];
    expect(frozenDaysInPeriod(freezes, { from: plainDate(2026, 3, 1), to: plainDate(2026, 3, 31) })).toBe(25);
  });
});

describe('binding periods', () => {
  it('a freeze pushes the binding end out by its own length', () => {
    const period = freezePeriod(plainDate(2026, 1, 31), 1);
    expect(extendBinding(plainDate(2026, 10, 1), period)).toBe('2026-10-30');
  });

  it('leaves an unbound subscription alone', () => {
    expect(extendBinding(null, freezePeriod(plainDate(2026, 1, 31), 1))).toBeNull();
  });
});

describe('decideFreeze', () => {
  const rules = { maxFreezeMonths: 3, maxFreezeMonthsPerYear: 6 };
  const today = plainDate(2026, 8, 26);

  it('accepts a freeze within the limits', () => {
    const decision = decideFreeze({ startsOn: plainDate(2026, 9, 1), months: 2 }, [], rules, today);
    expect(decision.ok).toBe(true);
  });

  it('rejects a backdated freeze', () => {
    const decision = decideFreeze({ startsOn: plainDate(2026, 8, 1), months: 1 }, [], rules, today);
    expect(decision).toMatchObject({ ok: false, reason: 'starts_in_past' });
  });

  it('rejects a freeze longer than the tenant allows', () => {
    const decision = decideFreeze({ startsOn: plainDate(2026, 9, 1), months: 4 }, [], rules, today);
    expect(decision).toMatchObject({ ok: false, reason: 'too_long', limitMonths: 3 });
  });

  it('rejects a freeze that overlaps an existing one', () => {
    const existing = [{ startsOn: plainDate(2026, 9, 15), endsOn: plainDate(2026, 10, 14) }];
    const decision = decideFreeze({ startsOn: plainDate(2026, 9, 1), months: 1 }, existing, rules, today);
    expect(decision).toMatchObject({ ok: false, reason: 'overlaps_existing' });
  });

  it('allows a freeze that starts the day the previous one ends', () => {
    const existing = [{ startsOn: plainDate(2026, 8, 1), endsOn: plainDate(2026, 8, 31) }];
    const decision = decideFreeze({ startsOn: plainDate(2026, 9, 1), months: 1 }, existing, rules, today);
    expect(decision.ok).toBe(true);
  });

  it('rejects a freeze that would break the annual limit', () => {
    const existing = [
      { startsOn: plainDate(2026, 1, 1), endsOn: plainDate(2026, 3, 31) },
      { startsOn: plainDate(2026, 5, 1), endsOn: plainDate(2026, 7, 31) },
    ];
    const decision = decideFreeze({ startsOn: plainDate(2026, 9, 1), months: 2 }, existing, rules, today);
    expect(decision).toMatchObject({ ok: false, reason: 'annual_limit' });
  });
});
