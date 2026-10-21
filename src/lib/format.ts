/**
 * Display formatting.
 *
 * Every operator-facing number goes through here, for one reason: the currency
 * comes from the amount and the timezone comes from the site, and neither is
 * allowed to default to whatever the reader happens to be. A Norwegian operator
 * looking at a Swedish site's report sees SEK and Stockholm time.
 */

import { type Money, format as formatMoney, money } from '@/domain/money';
import type { Currency } from '@/domain/money';
import { type PlainDate, type Timezone, localDay, localTime } from '@/domain/dates';

export type Locale = 'sv-SE' | 'nb-NO' | 'da-DK' | 'fi-FI' | 'en';

export function amount(minor: number, currency: Currency, locale: Locale = 'sv-SE'): string {
  return formatMoney(money(minor, currency), locale);
}

export function amountOf(value: Money, locale: Locale = 'sv-SE'): string {
  return formatMoney(value, locale);
}

/** Compact form for dashboard tiles: 1,1 MSEK rather than 1 124 335,23 kr. */
export function amountCompact(minor: number, currency: Currency, locale: Locale = 'sv-SE'): string {
  const major = minor / 100;
  if (Math.abs(major) >= 1_000_000) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(major / 1_000_000)} M${currency}`;
  }
  if (Math.abs(major) >= 10_000) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(major / 1000)}k ${currency}`;
  }
  return amount(minor, currency, locale);
}

export function integer(value: number, locale: Locale = 'sv-SE'): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

export function percent(fraction: number, digits = 1, locale: Locale = 'sv-SE'): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(fraction);
}

/** A rate that may not exist, such as a no-show rate where nothing was marked: "–", never 0%. */
export function optionalPercent(fraction: number | null, digits = 1, locale: Locale = 'sv-SE'): string {
  return fraction === null ? '–' : percent(fraction, digits, locale);
}

const MONTHS: Record<Locale, string[]> = {
  'sv-SE': ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'],
  'nb-NO': ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'],
  'da-DK': ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'],
  'fi-FI': ['tammi', 'helmi', 'maalis', 'huhti', 'touko', 'kesä', 'heinä', 'elo', 'syys', 'loka', 'marras', 'joulu'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

/** A plain date, human form: '26 aug 2026'. Never reinterpreted as an instant. */
export function date(day: PlainDate, locale: Locale = 'sv-SE'): string {
  const [year, month, dayOfMonth] = day.split('-') as [string, string, string];
  const monthName = MONTHS[locale][Number.parseInt(month, 10) - 1] ?? month;
  return `${Number.parseInt(dayOfMonth, 10)} ${monthName} ${year}`;
}

/** A plain date, short form: '26 aug'. For dense tables. */
export function dateShort(day: PlainDate, locale: Locale = 'sv-SE'): string {
  const [, month, dayOfMonth] = day.split('-') as [string, string, string];
  const monthName = MONTHS[locale][Number.parseInt(month, 10) - 1] ?? month;
  return `${Number.parseInt(dayOfMonth, 10)} ${monthName}`;
}

/** An instant, in the timezone of the site it belongs to. */
export function instant(at: string | Date, timezone: Timezone, locale: Locale = 'sv-SE'): string {
  const value = typeof at === 'string' ? new Date(at) : at;
  const day = localDay(value, timezone);
  const time = localTime(value, timezone);
  return `${date(day, locale)} ${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}

/** Just the wall-clock time at a site: '18:15'. */
export function timeOfDay(at: string | Date, timezone: Timezone): string {
  const value = typeof at === 'string' ? new Date(at) : at;
  const time = localTime(value, timezone);
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}

/** '2026-08' becomes 'aug 2026'. */
export function period(value: string, locale: Locale = 'sv-SE'): string {
  const [year, month] = value.split('-') as [string, string];
  return `${MONTHS[locale][Number.parseInt(month, 10) - 1] ?? month} ${year}`;
}

/**
 * How long ago, roughly. For sync lag, last-seen and next-attempt columns, so it
 * has to read correctly in both directions: a scheduled retry is in the future.
 */
export function ago(at: string | null, now: Date): string {
  if (at === null) return '-';
  const hours = (now.getTime() - new Date(at).getTime()) / 3_600_000;
  if (hours < 0) {
    const ahead = -hours;
    if (ahead < 1) return 'within the hour';
    if (ahead < 24) return `in ${Math.round(ahead)}h`;
    const days = Math.round(ahead / 24);
    return days === 1 ? 'tomorrow' : `in ${days} days`;
  }
  if (hours < 1) return 'under an hour ago';
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

const HUMAN: Record<string, string> = {
  // Charge and failure vocabulary, written the way support says it out loud.
  insufficient_funds: 'Insufficient funds',
  mandate_cancelled: 'Mandate cancelled',
  account_closed: 'Account closed',
  technical: 'Technical error',
  rejected_by_bank: 'Rejected by bank',
  succeeded: 'Paid',
  failed: 'Failed',
  retrying: 'Retrying',
  abandoned: 'Given up',
  pending: 'Pending',
  autogiro: 'Autogiro',
  avtalegiro: 'AvtaleGiro',
  card: 'Card',
  mobilepay: 'MobilePay',
  vipps: 'Vipps',
  // Subscription and access vocabulary.
  active: 'Active',
  frozen: 'Frozen',
  cancelling: 'Notice given',
  cancelled: 'Cancelled',
  ended: 'Ended',
  blocked: 'Blocked',
  former: 'Archived',
  booked: 'Booked',
  waitlisted: 'Waitlisted',
  attended: 'Attended',
  no_show: 'No show',
  granted: 'Granted',
  denied: 'Denied',
  grace: 'Granted (grace period)',
  subscription_ended: 'Membership ended',
  not_started: 'Not started yet',
  no_subscription: 'No membership',
  unknown_card: 'Unknown card',
  member_blocked: 'Member blocked',
  site_not_included: 'Wrong site for plan',
  payment_failure: 'Payment failure',
  moving: 'Moving away',
  too_expensive: 'Too expensive',
  not_using: 'Not using it',
  other_gym: 'Went elsewhere',
  health: 'Health',
  other: 'Other',
  travel: 'Travel',
  injury: 'Injury',
  parental_leave: 'Parental leave',
  work: 'Work',
  // Segments and tiers.
  long_tail: 'Single site',
  mid: 'Mid',
  key_account: 'Key account',
  starter: 'Starter',
  growth: 'Growth',
  enterprise: 'Enterprise',
  home_site: 'Home site only',
  all_sites: 'All sites',
  'access-provider-a': 'Provider A',
  'access-provider-b': 'Provider B',
};

/** Turn an enum value into something an owner would recognise. */
export function humanise(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  return HUMAN[value] ?? value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
