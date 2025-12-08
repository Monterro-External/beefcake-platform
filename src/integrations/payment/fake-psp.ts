/**
 * Stand-in for the payment providers.
 *
 * Real Autogiro is a file exchange with a two-day turnaround and real card
 * charges are synchronous; both are modelled here as an immediate answer,
 * because nothing downstream of this repo depends on the latency.
 *
 * The outcome is a pure function of the request, so a payment run replayed
 * against the same seed produces the same failures. That is what lets a report
 * bug be reproduced from a fresh database.
 */

import { hashString, unitFor } from '@/lib/rng';
import type { FailureCode } from '@/domain/retry-policy';
import type { ChargeOutcome, ChargeRequest, PaymentMethod, PaymentProvider } from '../types';

export interface FakePspOptions {
  /** Base probability that a first attempt fails, 0-1. */
  readonly failureRate?: number;
  /** Extra failure probability per retry: a mandate problem does not heal. */
  readonly retryFailureRate?: number;
  readonly salt?: string;
}

const FAILURE_MIX: ReadonlyArray<{ code: FailureCode; weight: number }> = [
  { code: 'insufficient_funds', weight: 62 },
  { code: 'technical', weight: 14 },
  { code: 'mandate_cancelled', weight: 12 },
  { code: 'account_closed', weight: 7 },
  { code: 'rejected_by_bank', weight: 5 },
];

const FAILURE_MESSAGES: Record<FailureCode, string> = {
  insufficient_funds: 'Otillräckligt saldo på kontot',
  mandate_cancelled: 'Medgivandet är återkallat av betalaren',
  account_closed: 'Kontot är avslutat',
  technical: 'Tillfälligt tekniskt fel hos betaltjänsten',
  rejected_by_bank: 'Avvisad av mottagande bank',
};

export function pickFailureCode(unit: number): FailureCode {
  const total = FAILURE_MIX.reduce((acc, f) => acc + f.weight, 0);
  let cursor = unit * total;
  for (const entry of FAILURE_MIX) {
    cursor -= entry.weight;
    if (cursor <= 0) return entry.code;
  }
  return 'technical';
}

export function createFakePsp(options: FakePspOptions = {}): PaymentProvider {
  const failureRate = options.failureRate ?? 0.045;
  const retryFailureRate = options.retryFailureRate ?? 0.35;
  const salt = options.salt ?? 'psp';

  return {
    name: 'fake-psp',
    supports: ['autogiro', 'avtalegiro', 'card', 'mobilepay', 'vipps'] as readonly PaymentMethod[],

    charge(request: ChargeRequest): ChargeOutcome {
      const providerRef = `psp_${hashString(`${salt}|${request.reference}|${request.attempt}`).toString(36)}`;

      // A missing mandate is a hard, deterministic failure whatever the dice say.
      if (request.mandateId === null && request.method !== 'card') {
        return {
          status: 'failed',
          providerRef,
          failureCode: 'mandate_cancelled',
          message: FAILURE_MESSAGES.mandate_cancelled,
        };
      }

      const threshold = request.attempt === 1 ? failureRate : retryFailureRate;
      const roll = unitFor(salt, request.reference, request.attempt);
      if (roll >= threshold) {
        return {
          status: 'succeeded',
          providerRef,
          settledAt: new Date(request.attemptedAt.getTime() + 2 * 86_400_000),
        };
      }

      const failureCode = pickFailureCode(unitFor(salt, 'code', request.reference, request.attempt));
      return { status: 'failed', providerRef, failureCode, message: FAILURE_MESSAGES[failureCode] };
    },
  };
}

/** Method a tenant's members pay by, given the tenant's country. */
export function defaultMethodFor(country: 'SE' | 'NO' | 'FI' | 'DK'): PaymentMethod {
  switch (country) {
    case 'SE':
      return 'autogiro';
    case 'NO':
      return 'avtalegiro';
    case 'FI':
    case 'DK':
      return 'card';
  }
}
