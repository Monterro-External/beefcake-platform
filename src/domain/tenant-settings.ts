/**
 * Tenant settings live in a key-value table (see
 * docs/adr/0003-tenant-settings-as-kv.md) so that support can change one
 * operator's notice period without a migration. The cost of that is this file:
 * the only place that knows what a key means, what type its value has and what
 * it falls back to when a tenant has never set it.
 *
 * Anything reading `tenant_settings` goes through `readSettings`. Reading the
 * raw rows and coercing at the call site is how you end up with three different
 * ideas of what the default notice period is.
 */

import { type Currency, isCurrency } from './money';
import { DEFAULT_RETRY_SETTINGS, type RetrySettings } from './retry-policy';

export const SETTING_KEYS = [
  'retry_attempts',
  'retry_interval_days',
  'notice_period_days',
  'bill_to_end_of_period',
  'access_grace_hours',
  'max_freeze_months',
  'max_freeze_months_per_year',
  'invoice_currency',
  'flag_member_app',
  'flag_new_reports',
  'flag_self_serve_freeze',
  'flag_waitlist_auto_promote',
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export interface TenantSettings {
  readonly retryAttempts: number;
  readonly retryIntervalDays: number;
  readonly noticePeriodDays: number;
  readonly billToEndOfPeriod: boolean;
  readonly accessGraceHours: number;
  readonly maxFreezeMonths: number;
  readonly maxFreezeMonthsPerYear: number;
  /**
   * Currency to bill in. Normally null, meaning "use the tenant's own currency".
   * Only set for the handful of operators who invoice a parent company abroad.
   */
  readonly invoiceCurrency: Currency | null;
  readonly flags: Readonly<Record<FeatureFlag, boolean>>;
}

export const FEATURE_FLAGS = [
  'member_app',
  'new_reports',
  'self_serve_freeze',
  'waitlist_auto_promote',
] as const;
export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

export const DEFAULT_SETTINGS: TenantSettings = {
  retryAttempts: DEFAULT_RETRY_SETTINGS.retryAttempts,
  retryIntervalDays: DEFAULT_RETRY_SETTINGS.retryIntervalDays,
  noticePeriodDays: 30,
  billToEndOfPeriod: true,
  accessGraceHours: 48,
  maxFreezeMonths: 3,
  maxFreezeMonthsPerYear: 6,
  invoiceCurrency: null,
  flags: {
    member_app: true,
    new_reports: false,
    self_serve_freeze: false,
    waitlist_auto_promote: true,
  },
};

export interface SettingRow {
  readonly key: string;
  readonly value: string;
}

function readInt(rows: Map<string, string>, key: SettingKey, fallback: number): number {
  const raw = rows.get(key);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBool(rows: Map<string, string>, key: SettingKey, fallback: boolean): boolean {
  const raw = rows.get(key);
  if (raw === undefined) return fallback;
  return raw === 'true' || raw === '1';
}

/** Turn raw key-value rows for one tenant into a fully populated settings object. */
export function readSettings(rows: readonly SettingRow[]): TenantSettings {
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const rawCurrency = map.get('invoice_currency');

  return {
    retryAttempts: readInt(map, 'retry_attempts', DEFAULT_SETTINGS.retryAttempts),
    retryIntervalDays: readInt(map, 'retry_interval_days', DEFAULT_SETTINGS.retryIntervalDays),
    noticePeriodDays: readInt(map, 'notice_period_days', DEFAULT_SETTINGS.noticePeriodDays),
    billToEndOfPeriod: readBool(map, 'bill_to_end_of_period', DEFAULT_SETTINGS.billToEndOfPeriod),
    accessGraceHours: readInt(map, 'access_grace_hours', DEFAULT_SETTINGS.accessGraceHours),
    maxFreezeMonths: readInt(map, 'max_freeze_months', DEFAULT_SETTINGS.maxFreezeMonths),
    maxFreezeMonthsPerYear: readInt(
      map,
      'max_freeze_months_per_year',
      DEFAULT_SETTINGS.maxFreezeMonthsPerYear,
    ),
    invoiceCurrency:
      rawCurrency !== undefined && isCurrency(rawCurrency) ? rawCurrency : DEFAULT_SETTINGS.invoiceCurrency,
    flags: {
      member_app: readBool(map, 'flag_member_app', DEFAULT_SETTINGS.flags.member_app),
      new_reports: readBool(map, 'flag_new_reports', DEFAULT_SETTINGS.flags.new_reports),
      self_serve_freeze: readBool(map, 'flag_self_serve_freeze', DEFAULT_SETTINGS.flags.self_serve_freeze),
      waitlist_auto_promote: readBool(
        map,
        'flag_waitlist_auto_promote',
        DEFAULT_SETTINGS.flags.waitlist_auto_promote,
      ),
    },
  };
}

export function retrySettingsOf(settings: TenantSettings): RetrySettings {
  return { retryAttempts: settings.retryAttempts, retryIntervalDays: settings.retryIntervalDays };
}

export function settingRows(partial: Partial<Record<SettingKey, string | number | boolean>>): SettingRow[] {
  return Object.entries(partial)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => ({ key, value: String(value) }));
}

export function flagKey(flag: FeatureFlag): SettingKey {
  return `flag_${flag}` as SettingKey;
}
