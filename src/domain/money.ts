/**
 * Money is stored and passed around as integer minor units (öre, øre, cent) with
 * an explicit currency. Never use floats for amounts: a 199.00 SEK plan billed
 * to 22,000 members has to reconcile to the öre against the PSP settlement file.
 *
 * Rules (see docs/adr/0002-money-as-minor-units.md):
 *  - Every amount carries its currency. Mixing currencies throws, it never coerces.
 *  - Every operation that can produce a fraction takes an explicit rounding mode.
 *  - Splitting an amount uses `allocate`, which is remainder-preserving, so the
 *    parts always sum back to the whole.
 */

export const CURRENCIES = ['SEK', 'NOK', 'DKK', 'EUR'] as const;
export type Currency = (typeof CURRENCIES)[number];

export interface Money {
  readonly minor: number;
  readonly currency: Currency;
}

/** Minor units per major unit. All four of our currencies happen to use 100. */
export const MINOR_UNITS_PER_MAJOR: Record<Currency, number> = {
  SEK: 100,
  NOK: 100,
  DKK: 100,
  EUR: 100,
};

export type Rounding = 'half-up' | 'half-even' | 'floor' | 'ceil';

export class CurrencyMismatchError extends Error {
  constructor(a: Currency, b: Currency) {
    super(`Cannot combine ${a} and ${b}: amounts in different currencies`);
    this.name = 'CurrencyMismatchError';
  }
}

export function isCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}

export function money(minor: number, currency: Currency): Money {
  if (!Number.isInteger(minor)) {
    throw new TypeError(`Money must be integer minor units, got ${minor}`);
  }
  return { minor, currency };
}

export function zero(currency: Currency): Money {
  return { minor: 0, currency };
}

/** Convenience for tests and seed data: `fromMajor(199, 'SEK')` -> 19900 öre. */
export function fromMajor(major: number, currency: Currency, rounding: Rounding = 'half-up'): Money {
  return money(roundTo(major * MINOR_UNITS_PER_MAJOR[currency], rounding), currency);
}

export function toMajor(m: Money): number {
  return m.minor / MINOR_UNITS_PER_MAJOR[m.currency];
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.minor + b.minor, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.minor - b.minor, a.currency);
}

export function negate(a: Money): Money {
  return money(-a.minor, a.currency);
}

export function sum(amounts: readonly Money[], currency: Currency): Money {
  return amounts.reduce((acc, m) => add(acc, m), zero(currency));
}

export function isZero(a: Money): boolean {
  return a.minor === 0;
}

export function isNegative(a: Money): boolean {
  return a.minor < 0;
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.minor < b.minor) return -1;
  if (a.minor > b.minor) return 1;
  return 0;
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.minor === b.minor;
}

export function max(a: Money, b: Money): Money {
  return compare(a, b) >= 0 ? a : b;
}

export function min(a: Money, b: Money): Money {
  return compare(a, b) <= 0 ? a : b;
}

/**
 * Round a possibly fractional number of minor units to a whole one.
 * `half-even` (banker's rounding) is what the PSP settlement uses; `half-up` is
 * what customers expect on an invoice line. Pick deliberately, never by default.
 */
export function roundTo(value: number, rounding: Rounding): number {
  if (Number.isInteger(value)) return value;
  switch (rounding) {
    case 'floor':
      return Math.floor(value);
    case 'ceil':
      return Math.ceil(value);
    case 'half-up': {
      // Symmetric around zero: -0.5 rounds to -1, 0.5 rounds to 1.
      return value < 0 ? -Math.round(-value) : Math.round(value);
    }
    case 'half-even': {
      const floor = Math.floor(value);
      const diff = value - floor;
      if (diff > 0.5) return floor + 1;
      if (diff < 0.5) return floor;
      return floor % 2 === 0 ? floor : floor + 1;
    }
  }
}

/** Multiply by a scalar (a proration factor, a VAT rate, a discount). */
export function multiply(m: Money, factor: number, rounding: Rounding): Money {
  return money(roundTo(m.minor * factor, rounding), m.currency);
}

/**
 * Multiply by an exact ratio. Preferred over `multiply` for proration because it
 * avoids the intermediate float: `prorate(19900, 12, 31)` is exact in integers
 * up to the final rounding step.
 */
export function prorate(m: Money, numerator: number, denominator: number, rounding: Rounding): Money {
  if (denominator === 0) throw new RangeError('prorate: denominator must not be zero');
  return money(roundTo((m.minor * numerator) / denominator, rounding), m.currency);
}

/**
 * Split an amount into parts by weight without losing or inventing minor units.
 * The remainder is handed out one unit at a time, largest fractional part first,
 * so `allocate(money(10000,'SEK'), [1,1,1])` gives 3334 / 3333 / 3333.
 */
export function allocate(m: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) return [];
  if (weights.some((w) => w < 0)) throw new RangeError('allocate: weights must not be negative');
  const total = weights.reduce((a, b) => a + b, 0);
  if (total === 0) return weights.map(() => zero(m.currency));

  const exact = weights.map((w) => (m.minor * w) / total);
  const floored = exact.map((v) => Math.floor(v));
  let remainder = m.minor - floored.reduce((a, b) => a + b, 0);

  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const out = [...floored];
  for (const { i } of order) {
    if (remainder <= 0) break;
    out[i] = (out[i] ?? 0) + 1;
    remainder -= 1;
  }
  return out.map((minor) => money(minor, m.currency));
}

export type Locale = 'sv-SE' | 'nb-NO' | 'da-DK' | 'fi-FI' | 'en';

/**
 * Format for display. The currency always comes from the amount, never from the
 * locale: a Norwegian operator reading a Swedish report still sees SEK on the
 * SEK figures.
 */
export function format(m: Money, locale: Locale = 'sv-SE'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: m.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toMajor(m));
}

/** Stable machine-readable form for logs, events and CSV columns. */
export function serialize(m: Money): string {
  return `${m.minor}:${m.currency}`;
}

export function deserialize(value: string): Money {
  const [minor, currency] = value.split(':');
  if (minor === undefined || currency === undefined || !isCurrency(currency)) {
    throw new TypeError(`Not a serialized Money value: ${value}`);
  }
  return money(Number.parseInt(minor, 10), currency);
}
