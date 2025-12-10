/**
 * Cached `Intl.DateTimeFormat` instances.
 *
 * Constructing a formatter is expensive relative to using one, and the seed
 * formats a few hundred thousand timestamps through the provider adapters. There
 * are four timezones in the whole company, so caching by timezone is enough.
 */

const CACHE = new Map<string, Intl.DateTimeFormat>();

export function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = CACHE.get(timeZone);
  if (cached !== undefined) return cached;
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  CACHE.set(timeZone, formatter);
  return formatter;
}

export interface ZonedParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

export function zonedParts(at: Date, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(at);
  const pick = (type: string): number =>
    Number.parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    // Some ICU builds report midnight as hour 24 with hour12: false.
    hour: pick('hour') % 24,
    minute: pick('minute'),
    second: pick('second'),
  };
}
