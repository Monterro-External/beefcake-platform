import { describe, expect, it } from 'vitest';
import { createFakePsp, defaultMethodFor, pickFailureCode } from '@/integrations/payment/fake-psp';
import { isRetryable } from '@/domain/retry-policy';
import type { ChargeRequest } from '@/integrations/types';

const psp = createFakePsp({ salt: 'test' });

function request(over: Partial<ChargeRequest> = {}): ChargeRequest {
  return {
    reference: 'chg_0000001',
    tenantId: 'ten_a',
    memberId: 'mem_a1',
    mandateId: 'mandate_1',
    amountMinor: 39900,
    currency: 'SEK',
    method: 'autogiro',
    attempt: 1,
    attemptedAt: new Date('2026-08-26T03:00:00.000Z'),
    description: 'Bas, augusti 2026',
    ...over,
  };
}

describe('determinism', () => {
  it('gives the same answer for the same request', () => {
    expect(psp.charge(request())).toEqual(psp.charge(request()));
  });

  it('gives a different answer for a different attempt', () => {
    const first = psp.charge(request({ attempt: 1 }));
    const second = psp.charge(request({ attempt: 2 }));
    expect(first.providerRef).not.toBe(second.providerRef);
  });

  it('is insensitive to the order requests arrive in', () => {
    const a = psp.charge(request({ reference: 'chg_a' }));
    const b = psp.charge(request({ reference: 'chg_b' }));
    expect(psp.charge(request({ reference: 'chg_a' }))).toEqual(a);
    expect(psp.charge(request({ reference: 'chg_b' }))).toEqual(b);
  });
});

describe('outcomes', () => {
  it('fails a charge with no mandate, whatever the dice say', () => {
    const outcome = psp.charge(request({ mandateId: null }));
    expect(outcome).toMatchObject({ status: 'failed', failureCode: 'mandate_cancelled' });
  });

  it('still allows a card charge with no mandate', () => {
    const outcomes = Array.from({ length: 20 }, (_, i) =>
      psp.charge(request({ mandateId: null, method: 'card', reference: `chg_card_${i}` })),
    );
    expect(outcomes.some((o) => o.status === 'succeeded')).toBe(true);
  });

  it('settles two banking days out', () => {
    const outcome = psp.charge(request({ reference: 'chg_settles' }));
    if (outcome.status !== 'succeeded') throw new Error('expected a success for this reference');
    expect(outcome.settledAt.toISOString()).toBe('2026-08-28T03:00:00.000Z');
  });

  it('fails somewhere near the configured rate over a large batch', () => {
    const provider = createFakePsp({ failureRate: 0.05, salt: 'rate' });
    const total = 4000;
    const failures = Array.from({ length: total }, (_, i) =>
      provider.charge(request({ reference: `chg_${i}` })),
    ).filter((o) => o.status === 'failed').length;
    expect(failures / total).toBeGreaterThan(0.03);
    expect(failures / total).toBeLessThan(0.07);
  });

  it('fails retries far more often than first attempts, because mandates do not heal', () => {
    const provider = createFakePsp({ failureRate: 0.05, retryFailureRate: 0.35, salt: 'retry' });
    const count = (attempt: number) =>
      Array.from({ length: 2000 }, (_, i) => provider.charge(request({ reference: `r_${i}`, attempt })))
        .filter((o) => o.status === 'failed').length;
    expect(count(2)).toBeGreaterThan(count(1) * 3);
  });

  it('only produces failure codes the domain knows about', () => {
    const provider = createFakePsp({ failureRate: 1, salt: 'codes' });
    const codes = new Set(
      Array.from({ length: 500 }, (_, i) => provider.charge(request({ reference: `c_${i}` }))).flatMap(
        (o) => (o.status === 'failed' ? [o.failureCode] : []),
      ),
    );
    expect(codes.size).toBeGreaterThan(2);
    for (const code of codes) {
      expect(typeof isRetryable(code)).toBe('boolean');
    }
  });
});

describe('failure mix', () => {
  it('insufficient funds dominates', () => {
    expect(pickFailureCode(0.1)).toBe('insufficient_funds');
    expect(pickFailureCode(0.6)).toBe('insufficient_funds');
  });

  it('covers the whole unit interval', () => {
    for (let i = 0; i <= 100; i += 1) {
      expect(pickFailureCode(i / 100)).toBeTruthy();
    }
  });
});

describe('payment method per market', () => {
  it('matches the local direct-debit scheme', () => {
    expect(defaultMethodFor('SE')).toBe('autogiro');
    expect(defaultMethodFor('NO')).toBe('avtalegiro');
    expect(defaultMethodFor('FI')).toBe('card');
    expect(defaultMethodFor('DK')).toBe('card');
  });
});
