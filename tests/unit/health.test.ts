import { describe, expect, it } from 'vitest';
import { type HealthInputs, bandFor, scoreTenantHealth } from '@/domain/health';

const healthy: HealthInputs = {
  failedPaymentRate: 0.015,
  churnRate90d: 0.015,
  classFillRate: 0.88,
  errorRatePerThousand: 0.3,
  accessSyncLagHours: 4,
  memberAppAdoption: 0.6,
};

const struggling: HealthInputs = {
  failedPaymentRate: 0.14,
  churnRate90d: 0.18,
  classFillRate: 0.35,
  errorRatePerThousand: 12,
  accessSyncLagHours: 96,
  memberAppAdoption: 0.02,
};

describe('scoring', () => {
  it('gives a perfect score to a tenant at or better than every target', () => {
    expect(scoreTenantHealth(healthy).score).toBe(100);
  });

  it('gives zero to a tenant at or worse than every threshold', () => {
    expect(scoreTenantHealth(struggling).score).toBe(0);
  });

  it('weights sum to one, so the score is bounded', () => {
    const total = scoreTenantHealth(healthy).components.reduce((acc, c) => acc + c.weight, 0);
    expect(total).toBeCloseTo(1);
  });

  it('stays inside 0..100 for out-of-range inputs', () => {
    const wild = scoreTenantHealth({
      failedPaymentRate: 3,
      churnRate90d: -1,
      classFillRate: 5,
      errorRatePerThousand: 5000,
      accessSyncLagHours: -10,
      memberAppAdoption: 9,
    });
    expect(wild.score).toBeGreaterThanOrEqual(0);
    expect(wild.score).toBeLessThanOrEqual(100);
  });

  it('failed payments move the score more than app adoption does', () => {
    const worsePayments = scoreTenantHealth({ ...healthy, failedPaymentRate: 0.12 });
    const worseAdoption = scoreTenantHealth({ ...healthy, memberAppAdoption: 0 });
    expect(100 - worsePayments.score).toBeGreaterThan(100 - worseAdoption.score);
  });

  it('exposes the inputs behind the number, so a CSM can explain it', () => {
    const result = scoreTenantHealth(struggling);
    expect(result.components.map((c) => c.key)).toEqual([
      'failedPaymentRate',
      'churnRate90d',
      'classFillRate',
      'errorRatePerThousand',
      'accessSyncLagHours',
      'memberAppAdoption',
    ]);
    expect(result.components.every((c) => c.label.length > 0)).toBe(true);
  });
});

describe('bands', () => {
  it('splits at 70 and 45', () => {
    expect(bandFor(100)).toBe('green');
    expect(bandFor(70)).toBe('green');
    expect(bandFor(69)).toBe('amber');
    expect(bandFor(45)).toBe('amber');
    expect(bandFor(44)).toBe('red');
    expect(bandFor(0)).toBe('red');
  });

  it('agrees with the score it was computed from', () => {
    const result = scoreTenantHealth(struggling);
    expect(result.band).toBe(bandFor(result.score));
  });
});
