/**
 * Two kinds of time exist in this codebase and they must not be mixed:
 *
 *  - An **instant** (`Date`, stored as an ISO-8601 UTC string). Something that
 *    happened: a check-in, a charge attempt, an event row.
 *  - A **plain date** (`PlainDate`, a 'YYYY-MM-DD' string). Something on a
 *    calendar: the day a freeze ends, a billing period boundary, a notice date.
 *    A plain date has no timezone, because "the freeze ends on 28 February"
 *    means the same thing in Oslo and Helsinki.
 *
 * Every site has a timezone. Converting an instant to the calendar day a site
 * would file it under always goes through `localDay`. Never use the host
 * machine's timezone: CI runs in UTC and a developer runs in Stockholm, and the
 * two must produce identical results.
 *
 * See docs/adr/0005-plain-dates-for-calendar-logic.md.
 */

import { TZDate } from '@date-fns/tz';

export const TIMEZONES = [
  'Europe/Stockholm',
  'Europe/Oslo',
  'Europe/Helsinki',
  'Europe/Copenhagen',
] as const;
export type Timezone = (typeof TIMEZONES)[number];

/** A calendar date with no timezone, formatted 'YYYY-MM-DD'. */
export type PlainDate = string & { readonly __plainDate?: unique symbol };

const PLAIN_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isPlainDate(value: string): value is PlainDate {
  if (!PLAIN_DATE_RE.test(value)) return false;
  const { year, month, day } = partsOf(value as PlainDate);
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;
  return day <= daysInMonth(year, month);
}

export function assertPlainDate(value: string): PlainDate {
  if (!isPlainDate(value)) throw new TypeError(`Not a valid plain date: ${value}`);
  return value;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

export function plainDate(year: number, month: number, day: number): PlainDate {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}` as PlainDate;
}

export interface DateParts {
  year: number;
  /** 1-12, unlike `Date#getMonth`. */
  month: number;
  /** 1-31. */
  day: number;
}

export function partsOf(d: PlainDate): DateParts {
  const m = PLAIN_DATE_RE.exec(d);
  if (!m) throw new TypeError(`Not a valid plain date: ${d}`);
  return {
    year: Number.parseInt(m[1] as string, 10),
    month: Number.parseInt(m[2] as string, 10),
    day: Number.parseInt(m[3] as string, 10),
  };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isLastDayOfMonth(d: PlainDate): boolean {
  const { year, month, day } = partsOf(d);
  return day === daysInMonth(year, month);
}

export function firstDayOfMonth(d: PlainDate): PlainDate {
  const { year, month } = partsOf(d);
  return plainDate(year, month, 1);
}

export function lastDayOfMonth(d: PlainDate): PlainDate {
  const { year, month } = partsOf(d);
  return plainDate(year, month, daysInMonth(year, month));
}

/** Days since the Unix epoch. Used as the canonical integer form for arithmetic. */
export function toEpochDay(d: PlainDate): number {
  const { year, month, day } = partsOf(d);
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function fromEpochDay(epochDay: number): PlainDate {
  const dt = new Date(epochDay * 86_400_000);
  return plainDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(d: PlainDate, days: number): PlainDate {
  return fromEpochDay(toEpochDay(d) + days);
}

export function subDays(d: PlainDate, days: number): PlainDate {
  return addDays(d, -days);
}

/**
 * Add whole months, clamping the day of month to the length of the target month.
 * 31 January + 1 month is 28 February (29 in a leap year), never 3 March.
 */
export function addMonths(d: PlainDate, months: number): PlainDate {
  const { year, month, day } = partsOf(d);
  const zeroBased = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(zeroBased / 12);
  const targetMonth = (zeroBased % 12) + 1;
  return plainDate(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
}

export function subMonths(d: PlainDate, months: number): PlainDate {
  return addMonths(d, -months);
}

export function differenceInDays(later: PlainDate, earlier: PlainDate): number {
  return toEpochDay(later) - toEpochDay(earlier);
}

export function comparePlainDates(a: PlainDate, b: PlainDate): -1 | 0 | 1 {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function minPlainDate(a: PlainDate, b: PlainDate): PlainDate {
  return a <= b ? a : b;
}

export function maxPlainDate(a: PlainDate, b: PlainDate): PlainDate {
  return a >= b ? a : b;
}

export function isBefore(a: PlainDate, b: PlainDate): boolean {
  return a < b;
}

export function isAfter(a: PlainDate, b: PlainDate): boolean {
  return a > b;
}

/** Inclusive on both ends, which is how every period in this domain is stored. */
export function isWithin(d: PlainDate, from: PlainDate, to: PlainDate): boolean {
  return d >= from && d <= to;
}

export function eachDay(from: PlainDate, to: PlainDate): PlainDate[] {
  const out: PlainDate[] = [];
  for (let e = toEpochDay(from); e <= toEpochDay(to); e += 1) out.push(fromEpochDay(e));
  return out;
}

/** 0 = Sunday .. 6 = Saturday, matching `Date#getDay`. */
export function dayOfWeek(d: PlainDate): number {
  return ((toEpochDay(d) % 7) + 11) % 7;
}

export function isWeekend(d: PlainDate): boolean {
  const dow = dayOfWeek(d);
  return dow === 0 || dow === 6;
}

// ---------------------------------------------------------------------------
// Instant <-> plain date, always through an explicit timezone
// ---------------------------------------------------------------------------

/** The calendar day `at` falls on, as seen from `timezone`. */
export function localDay(at: Date, timezone: Timezone): PlainDate {
  const z = new TZDate(at.getTime(), timezone);
  return plainDate(z.getFullYear(), z.getMonth() + 1, z.getDate());
}

export interface LocalTime {
  hour: number;
  minute: number;
  second: number;
}

export function localTime(at: Date, timezone: Timezone): LocalTime {
  const z = new TZDate(at.getTime(), timezone);
  return { hour: z.getHours(), minute: z.getMinutes(), second: z.getSeconds() };
}

/** The instant at which `day` begins in `timezone`. DST-safe. */
export function startOfDay(day: PlainDate, timezone: Timezone): Date {
  const { year, month, day: dayOfMonth } = partsOf(day);
  return new Date(new TZDate(year, month - 1, dayOfMonth, 0, 0, 0, 0, timezone).getTime());
}

/** The instant at which `day` ends in `timezone` (exclusive upper bound). */
export function endOfDayExclusive(day: PlainDate, timezone: Timezone): Date {
  return startOfDay(addDays(day, 1), timezone);
}

/** Build an instant from a local wall-clock time in a given zone. */
export function atLocalTime(
  day: PlainDate,
  timezone: Timezone,
  hour: number,
  minute = 0,
  second = 0,
): Date {
  const { year, month, day: dayOfMonth } = partsOf(day);
  return new Date(
    new TZDate(year, month - 1, dayOfMonth, hour, minute, second, 0, timezone).getTime(),
  );
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/** All instants are persisted as ISO-8601 with an explicit `Z`. */
export function toIso(at: Date): string {
  return at.toISOString();
}

export function fromIso(value: string): Date {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) throw new TypeError(`Not a valid ISO instant: ${value}`);
  return at;
}

/** Billing periods are named by their first day, e.g. period '2026-08'. */
export type BillingPeriod = string & { readonly __billingPeriod?: unique symbol };

export function billingPeriodOf(d: PlainDate): BillingPeriod {
  const { year, month } = partsOf(d);
  return `${pad(year, 4)}-${pad(month)}` as BillingPeriod;
}

export function billingPeriodRange(period: BillingPeriod): { from: PlainDate; to: PlainDate } {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) throw new TypeError(`Not a valid billing period: ${period}`);
  const year = Number.parseInt(m[1] as string, 10);
  const month = Number.parseInt(m[2] as string, 10);
  return { from: plainDate(year, month, 1), to: plainDate(year, month, daysInMonth(year, month)) };
}

export function addBillingPeriods(period: BillingPeriod, count: number): BillingPeriod {
  return billingPeriodOf(addMonths(billingPeriodRange(period).from, count));
}
