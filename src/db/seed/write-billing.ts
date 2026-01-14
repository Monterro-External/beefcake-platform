/**
 * Writes the payment runs, charges and receipts.
 *
 * The run for each historical month is replayed through the same fake PSP the
 * job uses, so failures, retries and abandonments in the seed are exactly what
 * the payment run would have produced. That is what makes a payment problem
 * reproducible from a fresh database: the data is not decorative.
 *
 * The last completed run is the one dated on or before `today`. Charges that
 * failed on it and are still inside their retry window are left in `retrying`
 * with a `next_attempt_at` in the future, so the tenant app shows work in
 * progress rather than a tidy finished month.
 */

import {
  type BillingPeriod,
  type PlainDate,
  type Timezone,
  addDays,
  atLocalTime,
  billingPeriodRange,
  localDay,
  startOfDay,
} from '@/domain/dates';
import { VAT_RATE_BY_COUNTRY, computePeriodCharge, receiptLines, vatOf } from '@/domain/billing';
import { decideRetry } from '@/domain/retry-policy';
import { readSettings, retrySettingsOf } from '@/domain/tenant-settings';
import { createFakePsp } from '@/integrations/payment/fake-psp';
import { createRng } from '@/lib/rng';
import { sequentialId } from '../ids';
import type { Sqlite } from '../client';
import { timezoneFor } from './blueprint';
import { BulkInserter } from './writer';
import type { SeedMember, SeedTenant, SeedWorld, TableCounts } from './model';
import type { Anchors } from './options';

/**
 * Receipts are only materialised for the most recent periods. Older ones are
 * archived out of the operational database, which keeps a fresh `db:reset`
 * inside a few seconds. See README, "What the seed does and does not build".
 */
export const RECEIPT_PERIODS = 6;

export interface BillingResult {
  /** The day dunning gave up on a member, for the churn-follows-failure pattern. */
  readonly dunningFailures: Map<string, PlainDate>;
  /** Charges still mid-retry as of today. */
  readonly midRetry: number;
}

export function writeBilling(
  sqlite: Sqlite,
  world: SeedWorld,
  anchors: Anchors,
  seed: string,
  counts: TableCounts,
): BillingResult {
  const runRows = new BulkInserter(sqlite, 'payment_runs', [
    'id',
    'tenantId',
    'period',
    'startedAt',
    'finishedAt',
    'status',
    'chargesAttempted',
    'chargesFailed',
    'totalMinor',
    'currency',
    'triggeredBy',
  ]);
  const chargeRows = new BulkInserter(sqlite, 'charges', [
    'id',
    'tenantId',
    'paymentRunId',
    'memberId',
    'subscriptionId',
    'amountMinor',
    'currency',
    'status',
    'method',
    'failureCode',
    'attempt',
    'attemptedAt',
    'nextAttemptAt',
    'settledAt',
  ]);
  const receiptRows = new BulkInserter(sqlite, 'receipts', [
    'id',
    'tenantId',
    'chargeId',
    'memberId',
    'number',
    'issuedAt',
    'currency',
    'totalMinor',
    'vatMinor',
    'linesJson',
  ]);

  const dunningFailures = new Map<string, PlainDate>();
  let midRetry = 0;
  let runSeq = 0;
  let chargeSeq = 0;
  let receiptSeq = 0;

  const recentPeriods = new Set(
    anchors.runs
      .filter((r) => r.completed)
      .slice(-RECEIPT_PERIODS)
      .map((r) => r.period),
  );

  for (const tenant of world.tenants) {
    const settings = readSettings(
      Object.entries(tenant.blueprint.settings).map(([key, value]) => ({ key, value })),
    );
    const retrySettings = retrySettingsOf(settings);
    const psp = createFakePsp({
      failureRate: tenant.blueprint.failureRate,
      retryFailureRate: 0.38,
      salt: `${seed}|psp|${tenant.id}`,
    });
    const timezone = timezoneFor(tenant.blueprint.country);
    const vatRate = VAT_RATE_BY_COUNTRY[tenant.blueprint.country];
    const rng = createRng(`${seed}|billing|${tenant.id}`);
    const cutoff = startOfDay(addDays(anchors.today, 1), timezone);

    let receiptNumber = 100_000;

    for (const run of anchors.runs) {
      if (!run.completed) continue;
      if (run.to < tenant.createdOn) continue;

      runSeq += 1;
      const runId = sequentialId('paymentRun', runSeq);
      const startedAt = atLocalTime(run.runOn, timezone, 3, 0, 0);
      const range = billingPeriodRange(run.period);

      let attempted = 0;
      let failed = 0;
      let total = 0;

      for (const member of tenant.members) {
        // The run can only bill what existed when it went out. A member who
        // joins after the 25th pays their first, pro-rated month at the desk and
        // appears on the next run.
        if (member.startedOn > run.runOn) continue;
        const planned = chargeForMember(tenant, member, range);
        if (planned === null) continue;

        attempted += 1;
        total += planned.amountMinor;

        // Attempt 1 goes out with the run, spread over the small hours.
        let attempt = 1;
        let attemptedAt = new Date(startedAt.getTime() + rng.int(0, 90 * 60) * 1000);

        for (let guard = 0; guard < 8; guard += 1) {
          chargeSeq += 1;
          const chargeId = sequentialId('charge', chargeSeq);
          const outcome = psp.charge({
            reference: `${member.id}|${run.period}`,
            tenantId: tenant.id,
            memberId: member.id,
            mandateId: member.mandateId,
            amountMinor: planned.amountMinor,
            currency: tenant.blueprint.currency,
            method: member.method,
            attempt,
            attemptedAt,
            description: planned.description,
          });

          if (outcome.status === 'succeeded') {
            chargeRows.push({
              id: chargeId,
              tenantId: tenant.id,
              paymentRunId: runId,
              memberId: member.id,
              subscriptionId: member.subscriptionId,
              amountMinor: planned.amountMinor,
              currency: tenant.blueprint.currency,
              status: 'succeeded',
              method: member.method,
              failureCode: null,
              attempt,
              attemptedAt: attemptedAt.toISOString(),
              nextAttemptAt: null,
              settledAt: outcome.settledAt.toISOString(),
            });

            if (recentPeriods.has(run.period)) {
              receiptSeq += 1;
              receiptNumber += 1;
              receiptRows.push({
                id: sequentialId('receipt', receiptSeq),
                tenantId: tenant.id,
                chargeId,
                memberId: member.id,
                number: `${run.period.replace('-', '')}-${receiptNumber}`,
                issuedAt: attemptedAt.toISOString(),
                currency: tenant.blueprint.currency,
                totalMinor: planned.amountMinor,
                vatMinor: vatOf(
                  { minor: planned.amountMinor, currency: tenant.blueprint.currency },
                  vatRate,
                ).minor,
                linesJson: JSON.stringify(planned.lines),
              });
            }
            break;
          }

          const retry = decideRetry({
            attempt,
            attemptedAt,
            failureCode: outcome.failureCode,
            settings: retrySettings,
            timezone,
          });

          if (attempt === 1) failed += 1;

          if (retry.retry && retry.nextAttemptAt >= cutoff) {
            // Still inside the retry window as of today: this is live work.
            chargeRows.push({
              id: chargeId,
              tenantId: tenant.id,
              paymentRunId: runId,
              memberId: member.id,
              subscriptionId: member.subscriptionId,
              amountMinor: planned.amountMinor,
              currency: tenant.blueprint.currency,
              status: 'retrying',
              method: member.method,
              failureCode: outcome.failureCode,
              attempt,
              attemptedAt: attemptedAt.toISOString(),
              nextAttemptAt: retry.nextAttemptAt.toISOString(),
              settledAt: null,
            });
            midRetry += 1;
            break;
          }

          chargeRows.push({
            id: chargeId,
            tenantId: tenant.id,
            paymentRunId: runId,
            memberId: member.id,
            subscriptionId: member.subscriptionId,
            amountMinor: planned.amountMinor,
            currency: tenant.blueprint.currency,
            status: retry.retry ? 'failed' : 'abandoned',
            method: member.method,
            failureCode: outcome.failureCode,
            attempt,
            attemptedAt: attemptedAt.toISOString(),
            nextAttemptAt: retry.retry ? retry.nextAttemptAt.toISOString() : null,
            settledAt: null,
          });

          if (!retry.retry) {
            // Dunning is over. This is the event that shows up as a cancellation
            // two to three weeks later.
            dunningFailures.set(member.id, localDay(attemptedAt, timezone));
            break;
          }

          attempt = retry.nextAttempt;
          attemptedAt = new Date(retry.nextAttemptAt.getTime() + rng.int(0, 3600) * 1000);
        }
      }

      runRows.push({
        id: runId,
        tenantId: tenant.id,
        period: run.period,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date(
          startedAt.getTime() + Math.max(45, Math.round(attempted / 12)) * 1000,
        ).toISOString(),
        status: 'completed',
        chargesAttempted: attempted,
        chargesFailed: failed,
        totalMinor: total,
        currency: tenant.blueprint.currency,
        triggeredBy: 'schedule',
      });
    }
  }

  counts.payment_runs = runRows.flush();
  counts.charges = chargeRows.flush();
  counts.receipts = receiptRows.flush();

  return { dunningFailures, midRetry };
}

interface PlannedCharge {
  readonly amountMinor: number;
  readonly description: string;
  readonly lines: unknown[];
}

function chargeForMember(
  tenant: SeedTenant,
  member: SeedMember,
  range: { from: PlainDate; to: PlainDate },
): PlannedCharge | null {
  const plan = tenant.plans[member.planIndex];
  if (plan === undefined) return null;
  const previous =
    member.planChange === null ? null : (tenant.plans[member.planChange.fromPlanIndex] ?? null);

  const snapshot = (p: typeof plan) => ({
    id: p.id,
    name: p.name,
    priceMinor: p.priceMinor,
    currency: p.currency,
  });

  const charge = computePeriodCharge({
    period: range,
    plan: snapshot(plan),
    previousPlan: previous === null ? null : snapshot(previous),
    planChangeOn: member.planChange?.on ?? null,
    subscriptionStartedOn: member.startedOn,
    subscriptionEndsOn: member.endsOn,
    freezes: member.freezes,
  });

  if (charge.skip) return null;
  return {
    amountMinor: charge.amount.minor,
    description: `${plan.name}, ${range.from.slice(0, 7)}`,
    lines: receiptLines(charge),
  };
}

export type { BillingPeriod, Timezone };
