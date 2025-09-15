import { describe, expect, it } from 'vitest';
import {
  CurrencyMismatchError,
  add,
  allocate,
  deserialize,
  format,
  fromMajor,
  money,
  multiply,
  prorate,
  roundTo,
  serialize,
  subtract,
  sum,
  toMajor,
  zero,
} from '@/domain/money';

describe('money construction', () => {
  it('refuses fractional minor units', () => {
    expect(() => money(10.5, 'SEK')).toThrow(TypeError);
  });

  it('converts to and from major units', () => {
    expect(fromMajor(199, 'SEK')).toEqual({ minor: 19900, currency: 'SEK' });
    expect(fromMajor(199.9, 'NOK')).toEqual({ minor: 19990, currency: 'NOK' });
    expect(toMajor(money(19900, 'SEK'))).toBe(199);
  });

  it('rounds a fractional major amount rather than storing a float', () => {
    expect(fromMajor(10.005, 'EUR')).toEqual({ minor: 1001, currency: 'EUR' });
  });
});

describe('arithmetic', () => {
  it('adds and subtracts within a currency', () => {
    expect(add(money(19900, 'SEK'), money(5000, 'SEK'))).toEqual(money(24900, 'SEK'));
    expect(subtract(money(19900, 'SEK'), money(24900, 'SEK'))).toEqual(money(-5000, 'SEK'));
  });

  it('refuses to mix currencies', () => {
    expect(() => add(money(100, 'SEK'), money(100, 'NOK'))).toThrow(CurrencyMismatchError);
  });

  it('sums an empty list to zero in the stated currency', () => {
    expect(sum([], 'DKK')).toEqual(zero('DKK'));
  });
});

describe('rounding', () => {
  it('half-up rounds away from zero on a tie', () => {
    expect(roundTo(0.5, 'half-up')).toBe(1);
    expect(roundTo(1.5, 'half-up')).toBe(2);
    expect(roundTo(-0.5, 'half-up')).toBe(-1);
    expect(roundTo(-1.5, 'half-up')).toBe(-2);
  });

  it('half-even rounds to the nearest even on a tie', () => {
    expect(roundTo(0.5, 'half-even')).toBe(0);
    expect(roundTo(1.5, 'half-even')).toBe(2);
    expect(roundTo(2.5, 'half-even')).toBe(2);
    expect(roundTo(3.5, 'half-even')).toBe(4);
  });

  it('floor and ceil are not symmetric around zero', () => {
    expect(roundTo(-1.2, 'floor')).toBe(-2);
    expect(roundTo(-1.2, 'ceil')).toBe(-1);
  });
});

describe('multiply and prorate', () => {
  it('multiplies with the requested rounding', () => {
    expect(multiply(money(19900, 'SEK'), 0.25, 'half-up')).toEqual(money(4975, 'SEK'));
    expect(multiply(money(101, 'SEK'), 0.5, 'half-up')).toEqual(money(51, 'SEK'));
    expect(multiply(money(101, 'SEK'), 0.5, 'half-even')).toEqual(money(50, 'SEK'));
  });

  it('prorates by an exact ratio', () => {
    // 199.00 SEK for 20 of 31 days
    expect(prorate(money(19900, 'SEK'), 20, 31, 'half-up')).toEqual(money(12839, 'SEK'));
  });

  it('prorating the whole period is the identity', () => {
    expect(prorate(money(44900, 'NOK'), 31, 31, 'half-up')).toEqual(money(44900, 'NOK'));
  });

  it('rejects a zero denominator', () => {
    expect(() => prorate(money(100, 'SEK'), 1, 0, 'half-up')).toThrow(RangeError);
  });
});

describe('allocate', () => {
  it('never loses or invents minor units', () => {
    const parts = allocate(money(10000, 'SEK'), [1, 1, 1]);
    expect(parts.map((p) => p.minor)).toEqual([3334, 3333, 3333]);
    expect(parts.reduce((acc, p) => acc + p.minor, 0)).toBe(10000);
  });

  it('splits by weight', () => {
    const parts = allocate(money(9999, 'EUR'), [70, 20, 10]);
    expect(parts.map((p) => p.minor)).toEqual([6999, 2000, 1000]);
    expect(parts.reduce((acc, p) => acc + p.minor, 0)).toBe(9999);
  });

  it('handles all-zero weights without dividing by zero', () => {
    expect(allocate(money(500, 'DKK'), [0, 0]).map((p) => p.minor)).toEqual([0, 0]);
  });

  it('rejects negative weights', () => {
    expect(() => allocate(money(500, 'DKK'), [1, -1])).toThrow(RangeError);
  });
});

describe('formatting', () => {
  const normalise = (s: string): string => s.replace(/\u00a0|\u202f/g, ' ');

  it('takes the currency from the amount, never from the locale', () => {
    // Same number of minor units, two currencies, one reader: the two must not
    // render identically or a Norwegian invoice read in Stockholm looks Swedish.
    const inSwedish = (m: Parameters<typeof format>[0]) => normalise(format(m, 'sv-SE'));
    expect(inSwedish(money(44900, 'NOK'))).not.toBe(inSwedish(money(44900, 'SEK')));
    expect(normalise(format(money(44900, 'NOK'), 'nb-NO'))).toContain('kr');
  });

  it('always shows two decimals', () => {
    expect(normalise(format(money(19900, 'SEK'), 'en'))).toBe('SEK 199.00');
    expect(normalise(format(money(19900, 'SEK'), 'en'))).toMatch(/199\.00$/);
    expect(normalise(format(money(5, 'EUR'), 'en'))).toBe('€0.05');
  });
});

describe('serialization', () => {
  it('round-trips', () => {
    const m = money(-12345, 'DKK');
    expect(deserialize(serialize(m))).toEqual(m);
  });

  it('rejects junk', () => {
    expect(() => deserialize('123:GBP')).toThrow(TypeError);
  });
});
