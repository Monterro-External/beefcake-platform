import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  flagKey,
  readSettings,
  retrySettingsOf,
  settingRows,
} from '@/domain/tenant-settings';
import { DEFAULT_RETRY_SETTINGS } from '@/domain/retry-policy';

describe('a tenant with no settings rows', () => {
  it('gets the documented defaults', () => {
    const settings = readSettings([]);
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it('inherits the retry policy from the payments domain, not a second copy', () => {
    expect(retrySettingsOf(readSettings([]))).toEqual(DEFAULT_RETRY_SETTINGS);
  });

  it('leaves the retry policy uncapped until an operator chooses one', () => {
    const settings = readSettings([]);
    expect(settings.retryAttempts).toBe(0);
    expect(settings.retryIntervalDays).toBe(1);
  });
});

describe('reading values', () => {
  it('parses integers', () => {
    const settings = readSettings([
      { key: 'retry_attempts', value: '5' },
      { key: 'notice_period_days', value: '90' },
      { key: 'access_grace_hours', value: '0' },
    ]);
    expect(settings.retryAttempts).toBe(5);
    expect(settings.noticePeriodDays).toBe(90);
    expect(settings.accessGraceHours).toBe(0);
  });

  it('parses booleans from both spellings', () => {
    expect(readSettings([{ key: 'flag_new_reports', value: 'true' }]).flags.new_reports).toBe(true);
    expect(readSettings([{ key: 'flag_new_reports', value: '1' }]).flags.new_reports).toBe(true);
    expect(readSettings([{ key: 'flag_member_app', value: 'false' }]).flags.member_app).toBe(false);
    expect(readSettings([{ key: 'flag_member_app', value: '0' }]).flags.member_app).toBe(false);
  });

  it('falls back to the default on an unparseable value rather than NaN', () => {
    const settings = readSettings([{ key: 'retry_attempts', value: 'three' }]);
    expect(settings.retryAttempts).toBe(DEFAULT_SETTINGS.retryAttempts);
    expect(Number.isFinite(settings.retryAttempts)).toBe(true);
  });

  it('ignores keys it does not know', () => {
    expect(() => readSettings([{ key: 'colour_scheme', value: 'dark' }])).not.toThrow();
  });

  it('accepts a supported invoice currency and rejects anything else', () => {
    expect(readSettings([{ key: 'invoice_currency', value: 'EUR' }]).invoiceCurrency).toBe('EUR');
    expect(readSettings([{ key: 'invoice_currency', value: 'GBP' }]).invoiceCurrency).toBeNull();
    expect(readSettings([]).invoiceCurrency).toBeNull();
  });
});

describe('writing values', () => {
  it('serializes every value as a string', () => {
    const rows = settingRows({ retry_attempts: 4, flag_new_reports: true, notice_period_days: 60 });
    expect(rows).toEqual([
      { key: 'retry_attempts', value: '4' },
      { key: 'flag_new_reports', value: 'true' },
      { key: 'notice_period_days', value: '60' },
    ]);
  });

  it('round-trips through readSettings', () => {
    const rows = settingRows({ retry_attempts: 4, retry_interval_days: 5, access_grace_hours: 12 });
    const settings = readSettings(rows);
    expect(settings.retryAttempts).toBe(4);
    expect(settings.retryIntervalDays).toBe(5);
    expect(settings.accessGraceHours).toBe(12);
  });

  it('maps a feature flag to its storage key', () => {
    expect(flagKey('self_serve_freeze')).toBe('flag_self_serve_freeze');
  });
});
