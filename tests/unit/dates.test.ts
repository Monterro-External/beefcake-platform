import { describe, expect, it } from 'vitest';
import {
  addBillingPeriods,
  addDays,
  addMonths,
  atLocalTime,
  billingPeriodOf,
  billingPeriodRange,
  dayOfWeek,
  daysInMonth,
  differenceInDays,
  eachDay,
  isLastDayOfMonth,
  isPlainDate,
  isWithin,
  lastDayOfMonth,
  localDay,
  localTime,
  plainDate,
  startOfDay,
} from '@/domain/dates';

describe('plain dates', () => {
  it('validates the shape and the calendar', () => {
    expect(isPlainDate('2026-02-28')).toBe(true);
    expect(isPlainDate('2026-02-29')).toBe(false);
    expect(isPlainDate('2024-02-29')).toBe(true);
    expect(isPlainDate('2026-13-01')).toBe(false);
    expect(isPlainDate('26-01-01')).toBe(false);
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays(plainDate(2026, 8, 30), 3)).toBe('2026-09-02');
    expect(addDays(plainDate(2026, 12, 31), 1)).toBe('2027-01-01');
    expect(addDays(plainDate(2026, 1, 1), -1)).toBe('2025-12-31');
  });

  it('counts days between dates', () => {
    expect(differenceInDays(plainDate(2026, 3, 1), plainDate(2026, 2, 1))).toBe(28);
    expect(differenceInDays(plainDate(2024, 3, 1), plainDate(2024, 2, 1))).toBe(29);
  });

  it('knows the length of a month', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe('addMonths clamps rather than overflows', () => {
  it('31 January plus one month is the end of February', () => {
    expect(addMonths(plainDate(2026, 1, 31), 1)).toBe('2026-02-28');
    expect(addMonths(plainDate(2024, 1, 31), 1)).toBe('2024-02-29');
  });

  it('31 March plus one month is 30 April', () => {
    expect(addMonths(plainDate(2026, 3, 31), 1)).toBe('2026-04-30');
  });

  it('keeps the day of month where it exists', () => {
    expect(addMonths(plainDate(2026, 1, 15), 1)).toBe('2026-02-15');
    expect(addMonths(plainDate(2026, 8, 26), 6)).toBe('2027-02-26');
  });

  it('goes backwards across a year boundary', () => {
    expect(addMonths(plainDate(2026, 2, 15), -3)).toBe('2025-11-15');
  });

  it('is not always reversible, and that is the clamp working', () => {
    const forward = addMonths(plainDate(2026, 1, 31), 1);
    expect(addMonths(forward, -1)).toBe('2026-01-28');
  });
});

describe('month helpers', () => {
  it('identifies the last day of a month', () => {
    expect(isLastDayOfMonth(plainDate(2026, 2, 28))).toBe(true);
    expect(isLastDayOfMonth(plainDate(2026, 2, 27))).toBe(false);
    expect(isLastDayOfMonth(plainDate(2024, 2, 28))).toBe(false);
  });

  it('finds the last day of a month', () => {
    expect(lastDayOfMonth(plainDate(2026, 2, 3))).toBe('2026-02-28');
    expect(lastDayOfMonth(plainDate(2026, 6, 3))).toBe('2026-06-30');
  });
});

describe('ranges', () => {
  it('is inclusive on both ends', () => {
    expect(isWithin(plainDate(2026, 1, 1), plainDate(2026, 1, 1), plainDate(2026, 1, 31))).toBe(true);
    expect(isWithin(plainDate(2026, 1, 31), plainDate(2026, 1, 1), plainDate(2026, 1, 31))).toBe(true);
    expect(isWithin(plainDate(2026, 2, 1), plainDate(2026, 1, 1), plainDate(2026, 1, 31))).toBe(false);
  });

  it('enumerates days inclusively', () => {
    expect(eachDay(plainDate(2026, 1, 30), plainDate(2026, 2, 2))).toEqual([
      '2026-01-30',
      '2026-01-31',
      '2026-02-01',
      '2026-02-02',
    ]);
  });

  it('knows the day of week', () => {
    // 2026-08-26 is a Wednesday.
    expect(dayOfWeek(plainDate(2026, 8, 26))).toBe(3);
    expect(dayOfWeek(plainDate(2026, 8, 30))).toBe(0);
  });
});

describe('timezones', () => {
  it('files an instant under the site-local day, not the host day', () => {
    // 22:30 UTC on 26 August is already the 27th in Helsinki (UTC+3 in summer).
    const at = new Date('2026-08-26T22:30:00Z');
    expect(localDay(at, 'Europe/Helsinki')).toBe('2026-08-27');
    expect(localDay(at, 'Europe/Stockholm')).toBe('2026-08-27');
    expect(localDay(new Date('2026-08-26T21:30:00Z'), 'Europe/Stockholm')).toBe('2026-08-26');
  });

  it('reports local wall-clock time', () => {
    expect(localTime(new Date('2026-08-26T21:14:07Z'), 'Europe/Helsinki')).toEqual({
      hour: 0,
      minute: 14,
      second: 7,
    });
  });

  it('starts the day at the right instant either side of DST', () => {
    // Summer: Stockholm is UTC+2. Winter: UTC+1.
    expect(startOfDay(plainDate(2026, 7, 1), 'Europe/Stockholm').toISOString()).toBe(
      '2026-06-30T22:00:00.000Z',
    );
    expect(startOfDay(plainDate(2026, 1, 1), 'Europe/Stockholm').toISOString()).toBe(
      '2025-12-31T23:00:00.000Z',
    );
  });

  it('builds an instant from a local wall clock', () => {
    expect(atLocalTime(plainDate(2026, 8, 26), 'Europe/Helsinki', 23, 14, 7).toISOString()).toBe(
      '2026-08-26T20:14:07.000Z',
    );
  });

  it('round-trips a late-evening check-in in every market', () => {
    for (const tz of ['Europe/Stockholm', 'Europe/Oslo', 'Europe/Helsinki', 'Europe/Copenhagen'] as const) {
      const at = atLocalTime(plainDate(2026, 8, 26), tz, 23, 45);
      expect(localDay(at, tz)).toBe('2026-08-26');
    }
  });
});

describe('billing periods', () => {
  it('names a period by its month', () => {
    expect(billingPeriodOf(plainDate(2026, 8, 26))).toBe('2026-08');
  });

  it('expands to an inclusive day range', () => {
    expect(billingPeriodRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(billingPeriodRange('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  });

  it('steps across a year boundary', () => {
    expect(addBillingPeriods('2026-11', 3)).toBe('2027-02');
    expect(addBillingPeriods('2026-01', -1)).toBe('2025-12');
  });
});
