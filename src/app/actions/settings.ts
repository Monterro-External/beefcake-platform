'use server';

/**
 * Changing a tenant setting or a feature flag.
 *
 * Values are validated against what the domain says the key means before they
 * are written, because `tenant_settings` has no types of its own and a bad value
 * silently falls back to the default (see
 * docs/adr/0003-tenant-settings-as-kv.md).
 */

import { revalidatePath } from 'next/cache';
import * as tenantsRepo from '@/db/repositories/tenants';
import { recordEvent } from '@/db/repositories/observability';
import {
  DEFAULT_SETTINGS,
  type FeatureFlag,
  FEATURE_FLAGS,
  type SettingKey,
  SETTING_KEYS,
  flagKey,
} from '@/domain/tenant-settings';
import { clock } from '@/lib/clock';
import { activeTenant, getSession, requirePermission, tenantScopeFor } from '@/lib/session';
import type { ActionResult } from './subscriptions';

/** Sensible bounds per key. Support has typed 300 into a days field before. */
const LIMITS: Partial<Record<SettingKey, { min: number; max: number }>> = {
  retry_attempts: { min: 1, max: 6 },
  retry_interval_days: { min: 1, max: 30 },
  notice_period_days: { min: 0, max: 180 },
  access_grace_hours: { min: 0, max: 168 },
  max_freeze_months: { min: 1, max: 12 },
  max_freeze_months_per_year: { min: 1, max: 12 },
};

export async function setNumericSetting(key: string, raw: string): Promise<ActionResult> {
  const session = await getSession();
  requirePermission(session, 'settings.write');
  const tenant = activeTenant(session);
  if (tenant === null) return { ok: false, message: 'No tenant selected.' };

  if (!(SETTING_KEYS as readonly string[]).includes(key)) {
    return { ok: false, message: `Unknown setting: ${key}` };
  }
  const limits = LIMITS[key as SettingKey];
  if (limits === undefined) return { ok: false, message: `${key} is not a numeric setting.` };

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return { ok: false, message: 'That is not a number.' };
  if (value < limits.min || value > limits.max) {
    return { ok: false, message: `Must be between ${limits.min} and ${limits.max}.` };
  }

  const scope = tenantScopeFor(session);
  const at = clock().now.toISOString();
  const before = tenantsRepo.getSettings(scope);
  tenantsRepo.setSetting(scope, key, String(value), at);

  recordEvent(scope, {
    action: 'settings.changed',
    subjectType: 'setting',
    subjectId: key,
    payload: { key, value, previous: readNumeric(before, key as SettingKey) },
    at,
  });

  revalidatePath('/app', 'layout');
  return { ok: true, message: `${key} is now ${value}.` };
}

/** Remove an override so the tenant falls back to the platform default. */
export async function clearSetting(key: string): Promise<ActionResult> {
  const session = await getSession();
  requirePermission(session, 'settings.write');
  if (!(SETTING_KEYS as readonly string[]).includes(key)) {
    return { ok: false, message: `Unknown setting: ${key}` };
  }

  const scope = tenantScopeFor(session);
  const at = clock().now.toISOString();
  tenantsRepo.clearSetting(scope, key);

  recordEvent(scope, {
    action: 'settings.changed',
    subjectType: 'setting',
    subjectId: key,
    payload: { key, cleared: true, default: readNumeric(DEFAULT_SETTINGS, key as SettingKey) },
    at,
  });

  revalidatePath('/app', 'layout');
  return { ok: true, message: `${key} is back to the platform default.` };
}

export async function setFlag(flag: string, enabled: boolean): Promise<ActionResult> {
  const session = await getSession();
  requirePermission(session, 'settings.write');
  if (!(FEATURE_FLAGS as readonly string[]).includes(flag)) {
    return { ok: false, message: `Unknown flag: ${flag}` };
  }

  const scope = tenantScopeFor(session);
  const at = clock().now.toISOString();
  tenantsRepo.setSetting(scope, flagKey(flag as FeatureFlag), String(enabled), at);

  recordEvent(scope, {
    action: 'settings.changed',
    subjectType: 'flag',
    subjectId: flag,
    payload: { flag, enabled },
    at,
  });

  revalidatePath('/app', 'layout');
  revalidatePath('/admin', 'layout');
  return { ok: true, message: `${flag} is ${enabled ? 'on' : 'off'}.` };
}

function readNumeric(settings: typeof DEFAULT_SETTINGS, key: SettingKey): number | null {
  switch (key) {
    case 'retry_attempts':
      return settings.retryAttempts;
    case 'retry_interval_days':
      return settings.retryIntervalDays;
    case 'notice_period_days':
      return settings.noticePeriodDays;
    case 'access_grace_hours':
      return settings.accessGraceHours;
    case 'max_freeze_months':
      return settings.maxFreezeMonths;
    case 'max_freeze_months_per_year':
      return settings.maxFreezeMonthsPerYear;
    default:
      return null;
  }
}
