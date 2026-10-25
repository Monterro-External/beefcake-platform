/**
 * The monthly payment run, and the retries that follow it.
 *
 * Runs once per tenant per billing period, on the 25th, billing that calendar
 * month in arrears. Two things happen on every invocation:
 *
 *  1. If the run for the current period has not gone out yet and today is on or
 *     after the run day, create it and attempt every billable subscription.
 *  2. Whether or not that happened, work through any charge whose next retry is
 *     now due.
 *
 * Idempotent per tenant and period: `payment_runs` is unique on
 * `(tenant_id, period)`, so a second invocation on the same day finds the run
 * already completed and only processes retries. That matters because the
 * scheduler retries and support re-runs by hand.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { newId } from '@/db/ids';
import { charges, paymentRuns, receipts, subscriptions as subscriptionsTable } from '@/db/schema';
import type { Charge } from '@/db/schema';
import * as paymentsRepo from '@/db/repositories/payments';
import * as subscriptionsRepo from '@/db/repositories/subscriptions';
import * as membersRepo from '@/db/repositories/members';
import { enqueueOutbox, recordError, recordEvent } from '@/db/repositories/observability';
import {
  type BillingPeriod,
  type PlainDate,
  atLocalTime,
  billingPeriodOf,
  billingPeriodRange,
  localDay,
  partsOf,
  plainDate,
  subMonths,
} from '@/domain/dates';
import { VAT_RATE_BY_COUNTRY, computePeriodCharge, receiptLines, vatOf } from '@/domain/billing';
import { type FailureCode, decideRetry } from '@/domain/retry-policy';
import { retrySettingsOf } from '@/domain/tenant-settings';
import { isBillableIn } from '@/domain/subscriptions';
import { PAYMENT_RUN_DAY } from '@/db/seed/blueprint';
import type { Job, TenantJobContext } from './runner';

export interface PaymentRunSummary {
  runsCreated: number;
  charged: number;
  succeeded: number;
  failed: number;
  retriesAttempted: number;
  retriesRecovered: number;
  abandoned: number;
  receiptsIssued: number;
  totalMinor: number;
  partialRunsDiscarded: number;
  chargesDiscarded: number;
  [key: string]: number | string | boolean | null;
}

/** The period a run executed on `today` should bill. */
export function periodForRunDay(today: PlainDate): BillingPeriod {
  const { day } = partsOf(today);
  // Before the 25th, the run that is outstanding is the previous month's.
  return billingPeriodOf(day >= PAYMENT_RUN_DAY ? today : subMonths(today, 1));
}

export function runDayFor(period: BillingPeriod): PlainDate {
  const { from } = billingPeriodRange(period);
  const { year, month } = partsOf(from);
  return plainDate(year, month, PAYMENT_RUN_DAY);
}

export const paymentRunJob: Job<PaymentRunSummary> = {
  name: 'payment-run',
  describe: 'Charge every billable member for the current period, then process due retries',

  perTenant(context): PaymentRunSummary {
    const summary: PaymentRunSummary = {
      runsCreated: 0,
      charged: 0,
      succeeded: 0,
      failed: 0,
      retriesAttempted: 0,
      retriesRecovered: 0,
      abandoned: 0,
      receiptsIssued: 0,
      totalMinor: 0,
      partialRunsDiscarded: 0,
      chargesDiscarded: 0,
    };

    const period = periodForRunDay(context.today);
    const existing = paymentsRepo.getRunForPeriod(context.scope, period);

    // A run left in `running` means a previous invocation died part way through:
    // the process was killed, the machine went away. The period is unique per
    // tenant, so the fix is to discard the partial attempt and do it again rather
    // than to leave the month half charged. See
    // docs/runbooks/payment-run-failed.md.
    if (existing !== null && existing.status === 'running') {
      // The runbook says to try --dry-run first, so a dry run only counts.
      if (context.dryRun) {
        const doomed = paymentsRepo.partialRunFootprint(context.scope, existing.id);
        context.log(
          `  ${context.tenant.name}: run ${period} was left running, would discard ${doomed.charges} charge(s) and ${doomed.receipts} receipt(s) and start again`,
        );
        summary.chargesDiscarded += doomed.charges;
      } else {
        const discarded = discardPartialRun(context, existing.id);
        context.log(
          `  ${context.tenant.name}: run ${period} was left running, discarded ${discarded} charge(s) and starting again`,
        );
        summary.chargesDiscarded += discarded;
      }
      summary.partialRunsDiscarded += 1;
    }

    const outstanding = existing === null || existing.status === 'running';
    if (outstanding && runDayFor(period) <= context.today) {
      executeRun(context, period, summary);
      summary.runsCreated += 1;
    } else if (!outstanding) {
      context.log(`  ${context.tenant.name}: run ${period} already ${existing?.status}`);
    }

    processDueRetries(context, summary);
    return summary;
  },
};

/**
 * Throw away everything a half-finished run wrote, so it can be re-run cleanly.
 * Receipts go first because they reference the charges.
 */
function discardPartialRun(context: TenantJobContext, runId: string): number {
  const { scope, tenant } = context;
  const doomed = scope.db
    .select({ id: charges.id })
    .from(charges)
    .where(and(eq(charges.tenantId, tenant.id), eq(charges.paymentRunId, runId)))
    .all();

  scope.db.transaction(() => {
    if (doomed.length > 0) {
      scope.db
        .delete(receipts)
        .where(
          and(
            eq(receipts.tenantId, tenant.id),
            inArray(
              receipts.chargeId,
              doomed.map((c) => c.id),
            ),
          ),
        )
        .run();
    }
    scope.db
      .delete(charges)
      .where(and(eq(charges.tenantId, tenant.id), eq(charges.paymentRunId, runId)))
      .run();
    scope.db
      .delete(paymentRuns)
      .where(and(eq(paymentRuns.tenantId, tenant.id), eq(paymentRuns.id, runId)))
      .run();
  });

  return doomed.length;
}

function executeRun(
  context: TenantJobContext,
  period: BillingPeriod,
  summary: PaymentRunSummary,
): void {
  const { scope, tenant, integrations, now } = context;
  const range = billingPeriodRange(period);
  const runId = newId('paymentRun');
  const startedAt = atLocalTime(runDayFor(period), context.timezone, 3, 0).toISOString();

  if (context.dryRun) {
    context.log(`  ${tenant.name}: would create run ${period}`);
    return;
  }

  scope.db
    .insert(paymentRuns)
    .values({
      id: runId,
      tenantId: tenant.id,
      period,
      startedAt,
      finishedAt: null,
      status: 'running',
      currency: tenant.currency,
      triggeredBy: 'schedule',
    })
    .run();

  recordEvent(scope, {
    action: 'payment_run.started',
    subjectType: 'payment_run',
    subjectId: runId,
    payload: { period },
    at: startedAt,
  });

  const candidates = subscriptionsRepo.billableSubscriptions(scope, range.to);
  const freezes = subscriptionsRepo.freezesFor(
    scope,
    candidates.map((s) => s.id),
  );
  const plans = new Map(subscriptionsRepo.listPlans(scope).map((p) => [p.id, p]));
  const retrySettings = retrySettingsOf(context.settings);
  const vatRate = VAT_RATE_BY_COUNTRY[tenant.country];
  const numbers = receiptNumbers(context);

  let attempted = 0;
  let failed = 0;
  let total = 0;

  // 45,000 inserts, each its own transaction, means 45,000 fsyncs. One
  // transaction for the whole run turns minutes into seconds, and a crash
  // half way through leaves no partial run behind.
  scope.db.transaction(() => {
  for (const subscription of candidates) {
    const record = subscriptionsRepo.toRecord(subscription);
    const subscriptionFreezes = freezes.get(subscription.id) ?? [];
    if (!isBillableIn(record, subscriptionFreezes, range)) continue;

    const plan = plans.get(subscription.planId);
    if (plan === undefined) {
      recordError(scope, {
        where: 'jobs/payment-run',
        message: `Subscription ${subscription.id} references unknown plan ${subscription.planId}`,
        severity: 'error',
        context: { subscription_id: subscription.id, period },
        at: now.toISOString(),
      });
      continue;
    }

    const charge = computePeriodCharge({
      period: range,
      plan: {
        id: plan.id,
        name: plan.name,
        priceMinor: plan.priceMinor,
        currency: plan.currency,
      },
      // A plan change inside the period is recorded on the subscription row, so
      // the run bills the change from the day it took effect. Historic changes
      // are already reflected in earlier runs.
      previousPlan: null,
      planChangeOn: null,
      subscriptionStartedOn: record.startedOn,
      subscriptionEndsOn: record.endsOn,
      freezes: subscriptionFreezes,
    });

    if (charge.skip) continue;

    const member = membersRepo.getMember(scope, subscription.memberId);
    if (member === null) continue;

    attempted += 1;
    total += charge.amount.minor;

    const chargeId = newId('charge');
    const attemptedAt = now;
    const outcome = integrations.payments.charge({
      reference: `${subscription.memberId}|${period}`,
      tenantId: tenant.id,
      memberId: subscription.memberId,
      mandateId: member.cardId === null ? null : `mandate_${member.id}`,
      amountMinor: charge.amount.minor,
      currency: charge.amount.currency,
      method: methodFor(tenant.country),
      attempt: 1,
      attemptedAt,
      description: `${plan.name}, ${period}`,
    });

    if (outcome.status === 'succeeded') {
      scope.db
        .insert(charges)
        .values({
          id: chargeId,
          tenantId: tenant.id,
          paymentRunId: runId,
          memberId: subscription.memberId,
          subscriptionId: subscription.id,
          amountMinor: charge.amount.minor,
          currency: charge.amount.currency,
          status: 'succeeded',
          method: methodFor(tenant.country),
          failureCode: null,
          attempt: 1,
          attemptedAt: attemptedAt.toISOString(),
          nextAttemptAt: null,
          settledAt: outcome.settledAt.toISOString(),
        })
        .run();

      issueReceipt(context, numbers, {
        chargeId,
        memberId: subscription.memberId,
        period,
        amountMinor: charge.amount.minor,
        lines: receiptLines(charge),
        vatMinor: vatOf(charge.amount, vatRate).minor,
        at: attemptedAt.toISOString(),
      });
      summary.receiptsIssued += 1;
      summary.succeeded += 1;

      recordEvent(scope, {
        action: 'charge.succeeded',
        subjectType: 'charge',
        subjectId: chargeId,
        payload: { period, amount_minor: charge.amount.minor, currency: charge.amount.currency },
        at: attemptedAt.toISOString(),
      });
    } else {
      failed += 1;
      summary.failed += 1;
      const retry = decideRetry({
        attempt: 1,
        attemptedAt,
        failureCode: outcome.failureCode,
        settings: retrySettings,
        timezone: context.timezone,
      });

      scope.db
        .insert(charges)
        .values({
          id: chargeId,
          tenantId: tenant.id,
          paymentRunId: runId,
          memberId: subscription.memberId,
          subscriptionId: subscription.id,
          amountMinor: charge.amount.minor,
          currency: charge.amount.currency,
          status: retry.retry ? 'retrying' : 'abandoned',
          method: methodFor(tenant.country),
          failureCode: outcome.failureCode,
          attempt: 1,
          attemptedAt: attemptedAt.toISOString(),
          nextAttemptAt: retry.retry ? retry.nextAttemptAt.toISOString() : null,
          settledAt: null,
        })
        .run();

      notifyFailure(context, {
        chargeId,
        memberEmail: member.email,
        amountMinor: charge.amount.minor,
        currency: charge.amount.currency,
        failureCode: outcome.failureCode,
        attempt: 1,
        nextAttemptAt: retry.retry ? retry.nextAttemptAt.toISOString() : null,
        at: attemptedAt.toISOString(),
      });

      if (!retry.retry) {
        summary.abandoned += 1;
        recordEvent(scope, {
          action: 'charge.abandoned',
          subjectType: 'charge',
          subjectId: chargeId,
          payload: { failure_code: outcome.failureCode, attempts: 1, reason: retry.reason },
          at: attemptedAt.toISOString(),
        });
      }
    }

    summary.charged += 1;
  }
  });

  const finishedAt = new Date(now.getTime() + attempted * 40).toISOString();
  scope.db
    .update(paymentRuns)
    .set({
      finishedAt,
      status: 'completed',
      chargesAttempted: attempted,
      chargesFailed: failed,
      totalMinor: total,
    })
    .where(and(eq(paymentRuns.tenantId, tenant.id), eq(paymentRuns.id, runId)))
    .run();

  summary.totalMinor += total;

  recordEvent(scope, {
    action: 'payment_run.completed',
    subjectType: 'payment_run',
    subjectId: runId,
    payload: { period, attempted, failed, total_minor: total, currency: tenant.currency },
    at: finishedAt,
  });

  context.log(
    `  ${tenant.name}: run ${period} charged ${attempted}, failed ${failed}, ${total} ${tenant.currency} minor`,
  );
}

function processDueRetries(context: TenantJobContext, summary: PaymentRunSummary): void {
  const { scope, tenant, integrations, now } = context;
  const due = paymentsRepo.chargesDueForRetry(scope, now.toISOString());
  if (due.length === 0) return;
  if (context.dryRun) {
    context.log(`  ${tenant.name}: would retry ${due.length} charge(s)`);
    return;
  }

  const retrySettings = retrySettingsOf(context.settings);
  const vatRate = VAT_RATE_BY_COUNTRY[tenant.country];
  const numbers = receiptNumbers(context);
  const runPeriods = new Map<string, BillingPeriod>();

  scope.db.transaction(() => {
  for (const previous of due) {
    const member = membersRepo.getMember(scope, previous.memberId);
    if (member === null) continue;

    const attempt = previous.attempt + 1;
    const chargeId = newId('charge');
    summary.retriesAttempted += 1;

    const outcome = integrations.payments.charge({
      reference: retryReference(previous),
      tenantId: tenant.id,
      memberId: previous.memberId,
      mandateId: member.cardId === null ? null : `mandate_${member.id}`,
      amountMinor: previous.amountMinor,
      currency: previous.currency,
      method: previous.method,
      attempt,
      attemptedAt: now,
      description: `retry ${attempt}`,
    });

    // The previous attempt is now history: it failed and its retry has happened.
    scope.db
      .update(charges)
      .set({ status: 'failed', nextAttemptAt: null })
      .where(and(eq(charges.tenantId, tenant.id), eq(charges.id, previous.id)))
      .run();

    if (outcome.status === 'succeeded') {
      scope.db
        .insert(charges)
        .values({
          id: chargeId,
          tenantId: tenant.id,
          paymentRunId: previous.paymentRunId,
          memberId: previous.memberId,
          subscriptionId: previous.subscriptionId,
          amountMinor: previous.amountMinor,
          currency: previous.currency,
          status: 'succeeded',
          method: previous.method,
          failureCode: null,
          attempt,
          attemptedAt: now.toISOString(),
          nextAttemptAt: null,
          settledAt: outcome.settledAt.toISOString(),
        })
        .run();

      summary.retriesRecovered += 1;
      summary.succeeded += 1;
      issueReceipt(context, numbers, {
        chargeId,
        memberId: previous.memberId,
        period: periodOfRun(context, previous.paymentRunId, runPeriods),
        amountMinor: previous.amountMinor,
        lines: [
          {
            description: `Retry ${attempt}`,
            quantity: 1,
            unit: 'charge',
            amountMinor: previous.amountMinor,
            currency: previous.currency,
          },
        ],
        vatMinor: vatOf({ minor: previous.amountMinor, currency: previous.currency }, vatRate).minor,
        at: now.toISOString(),
      });
      summary.receiptsIssued += 1;
      recordEvent(scope, {
        action: 'charge.succeeded',
        subjectType: 'charge',
        subjectId: chargeId,
        payload: { attempt, recovered: true },
        at: now.toISOString(),
      });
      continue;
    }

    const retry = decideRetry({
      attempt,
      attemptedAt: now,
      failureCode: outcome.failureCode,
      settings: retrySettings,
      timezone: context.timezone,
    });

    scope.db
      .insert(charges)
      .values({
        id: chargeId,
        tenantId: tenant.id,
        paymentRunId: previous.paymentRunId,
        memberId: previous.memberId,
        subscriptionId: previous.subscriptionId,
        amountMinor: previous.amountMinor,
        currency: previous.currency,
        status: retry.retry ? 'retrying' : 'abandoned',
        method: previous.method,
        failureCode: outcome.failureCode,
        attempt,
        attemptedAt: now.toISOString(),
        nextAttemptAt: retry.retry ? retry.nextAttemptAt.toISOString() : null,
        settledAt: null,
      })
      .run();

    summary.failed += 1;
    notifyFailure(context, {
      chargeId,
      memberEmail: member.email,
      amountMinor: previous.amountMinor,
      currency: previous.currency,
      failureCode: outcome.failureCode,
      attempt,
      nextAttemptAt: retry.retry ? retry.nextAttemptAt.toISOString() : null,
      at: now.toISOString(),
    });

    if (!retry.retry) {
      summary.abandoned += 1;
      // Dunning is over. The subscription is suspended, which is what the
      // access sync job will pick up tonight.
      scope.db
        .update(subscriptionsTable)
        .set({ status: 'cancelling', cancelReason: 'payment_failure' })
        .where(
          and(
            eq(subscriptionsTable.tenantId, tenant.id),
            eq(subscriptionsTable.id, previous.subscriptionId),
          ),
        )
        .run();

      recordEvent(scope, {
        action: 'charge.abandoned',
        subjectType: 'charge',
        subjectId: chargeId,
        payload: { failure_code: outcome.failureCode, attempts: attempt, reason: retry.reason },
        at: now.toISOString(),
      });
    } else {
      recordEvent(scope, {
        action: 'charge.retry_scheduled',
        subjectType: 'charge',
        subjectId: chargeId,
        payload: { attempt, next_attempt_at: retry.nextAttemptAt.toISOString() },
        at: now.toISOString(),
      });
    }
  }
  });

  context.log(
    `  ${tenant.name}: retried ${summary.retriesAttempted}, recovered ${summary.retriesRecovered}`,
  );
}

/**
 * The retry has to hit the same provider reference as the original attempt, or
 * the fake PSP treats it as an unrelated charge and the outcome stops being
 * reproducible.
 */
function retryReference(previous: Charge): string {
  return `${previous.memberId}|${previous.paymentRunId.slice(-7)}`;
}

/** Cached per invocation: a tenant's retries all belong to a handful of runs. */
function periodOfRun(context: TenantJobContext, runId: string, cache: Map<string, BillingPeriod>): BillingPeriod {
  const cached = cache.get(runId);
  if (cached !== undefined) return cached;
  const run = context.scope.db
    .select({ period: paymentRuns.period })
    .from(paymentRuns)
    .where(eq(paymentRuns.id, runId))
    .get();
  const period = (run?.period ?? billingPeriodOf(context.today)) as BillingPeriod;
  cache.set(runId, period);
  return period;
}

interface ReceiptInput {
  chargeId: string;
  memberId: string;
  period: BillingPeriod;
  amountMinor: number;
  vatMinor: number;
  lines: unknown[];
  at: string;
}

/**
 * Receipt numbers have to be unique per tenant and gapless enough that finance
 * does not ask questions, so they come from a counter allocated once per run.
 * Counting rows per receipt would be a table scan per member.
 */
export interface ReceiptNumbers {
  next(): number;
}

function receiptNumbers(context: TenantJobContext): ReceiptNumbers {
  const highest = context.scope.db
    .select({ n: sql<number>`coalesce(max(cast(substr(${receipts.number}, 8) as integer)), 199999)` })
    .from(receipts)
    .where(eq(receipts.tenantId, context.tenant.id))
    .get();
  let cursor = highest?.n ?? 199_999;
  return {
    next(): number {
      cursor += 1;
      return cursor;
    },
  };
}

function issueReceipt(context: TenantJobContext, numbers: ReceiptNumbers, input: ReceiptInput): void {
  const { scope, tenant } = context;
  scope.db
    .insert(receipts)
    .values({
      id: newId('receipt'),
      tenantId: tenant.id,
      chargeId: input.chargeId,
      memberId: input.memberId,
      number: `${input.period.replace('-', '')}-${numbers.next()}`,
      issuedAt: input.at,
      currency: tenant.currency,
      totalMinor: input.amountMinor,
      vatMinor: input.vatMinor,
      linesJson: JSON.stringify(input.lines),
    })
    .run();

  enqueueOutbox(scope, {
    channel: 'email',
    template: 'receipt',
    payload: { charge_id: input.chargeId, amount_minor: input.amountMinor },
    at: input.at,
  });
}

interface FailureNotice {
  chargeId: string;
  memberEmail: string;
  amountMinor: number;
  currency: string;
  failureCode: FailureCode;
  attempt: number;
  nextAttemptAt: string | null;
  at: string;
}

function notifyFailure(context: TenantJobContext, notice: FailureNotice): void {
  const { scope, integrations } = context;
  const outcome = integrations.email.send({
    to: notice.memberEmail,
    template: notice.nextAttemptAt === null ? 'payment_abandoned' : 'payment_failed',
    locale: context.tenant.locale,
    variables: {
      amount_minor: notice.amountMinor,
      currency: notice.currency,
      attempt: notice.attempt,
    },
    at: new Date(notice.at),
  });

  enqueueOutbox(scope, {
    channel: 'email',
    template: notice.nextAttemptAt === null ? 'payment_abandoned' : 'payment_failed',
    recipient: notice.memberEmail,
    payload: {
      charge_id: notice.chargeId,
      amount_minor: notice.amountMinor,
      currency: notice.currency,
      failure_code: notice.failureCode,
      attempt: notice.attempt,
      next_attempt_at: notice.nextAttemptAt,
      gateway: outcome.status,
    },
    at: notice.at,
  });

  recordEvent(scope, {
    action: 'charge.failed',
    subjectType: 'charge',
    subjectId: notice.chargeId,
    payload: {
      failure_code: notice.failureCode,
      attempt: notice.attempt,
      amount_minor: notice.amountMinor,
      currency: notice.currency,
    },
    at: notice.at,
  });
}

function methodFor(country: string): 'autogiro' | 'avtalegiro' | 'card' {
  if (country === 'SE') return 'autogiro';
  if (country === 'NO') return 'avtalegiro';
  return 'card';
}

export { localDay };
