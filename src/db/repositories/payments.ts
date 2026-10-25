import { and, asc, count, desc, eq, gte, inArray, isNotNull, lte, sql, sum } from 'drizzle-orm';
import type { BillingPeriod } from '@/domain/dates';
import { type Charge, type PaymentRun, charges, paymentRuns, receipts } from '../schema';
import { type AdminScope, type TenantScope, guard, guardOne } from './scope';

export function lastCompletedRun(scope: TenantScope): PaymentRun | null {
  return guardOne(
    scope,
    'payment_runs',
    scope.db
      .select()
      .from(paymentRuns)
      .where(and(eq(paymentRuns.tenantId, scope.tenantId), eq(paymentRuns.status, 'completed')))
      .orderBy(desc(paymentRuns.period))
      .limit(1)
      .get(),
  );
}

export function getRunForPeriod(scope: TenantScope, period: BillingPeriod): PaymentRun | null {
  return guardOne(
    scope,
    'payment_runs',
    scope.db
      .select()
      .from(paymentRuns)
      .where(and(eq(paymentRuns.tenantId, scope.tenantId), eq(paymentRuns.period, period)))
      .get(),
  );
}

export function listRuns(scope: TenantScope, limit = 24): PaymentRun[] {
  return guard(
    scope,
    'payment_runs',
    scope.db
      .select()
      .from(paymentRuns)
      .where(eq(paymentRuns.tenantId, scope.tenantId))
      .orderBy(desc(paymentRuns.period))
      .limit(limit)
      .all(),
  );
}

export function listCharges(
  scope: TenantScope,
  filter: { runId?: string; memberId?: string; status?: Charge['status']; limit?: number } = {},
): Charge[] {
  const conditions = [eq(charges.tenantId, scope.tenantId)];
  if (filter.runId !== undefined) conditions.push(eq(charges.paymentRunId, filter.runId));
  if (filter.memberId !== undefined) conditions.push(eq(charges.memberId, filter.memberId));
  if (filter.status !== undefined) conditions.push(eq(charges.status, filter.status));
  return guard(
    scope,
    'charges',
    scope.db
      .select()
      .from(charges)
      .where(and(...conditions))
      .orderBy(desc(charges.attemptedAt))
      .limit(filter.limit ?? 200)
      .all(),
  );
}

/** Charges whose next retry is due at or before `at`. Driven by the payment run job. */
export function chargesDueForRetry(scope: TenantScope, at: string, limit = 5000): Charge[] {
  return guard(
    scope,
    'charges',
    scope.db
      .select()
      .from(charges)
      .where(
        and(
          eq(charges.tenantId, scope.tenantId),
          eq(charges.status, 'retrying'),
          isNotNull(charges.nextAttemptAt),
          lte(charges.nextAttemptAt, at),
        ),
      )
      .orderBy(asc(charges.nextAttemptAt))
      .limit(limit)
      .all(),
  );
}

export interface FailureBreakdown {
  readonly failureCode: string;
  readonly n: number;
}

export function failureBreakdown(scope: TenantScope, runId: string): FailureBreakdown[] {
  return scope.db
    .select({ failureCode: sql<string>`coalesce(${charges.failureCode}, 'none')`, n: count() })
    .from(charges)
    .where(
      and(
        eq(charges.tenantId, scope.tenantId),
        eq(charges.paymentRunId, runId),
        inArray(charges.status, ['failed', 'abandoned', 'retrying']),
      ),
    )
    .groupBy(charges.failureCode)
    .all();
}

export interface PartialRunFootprint {
  readonly charges: number;
  readonly receipts: number;
}

/** What discarding a half-finished run would delete. The payment run's dry run reports it. */
export function partialRunFootprint(scope: TenantScope, runId: string): PartialRunFootprint {
  const ofRun = and(eq(charges.tenantId, scope.tenantId), eq(charges.paymentRunId, runId));
  const chargeCount = scope.db.select({ n: count() }).from(charges).where(ofRun).get();
  const receiptCount = scope.db
    .select({ n: count() })
    .from(receipts)
    .where(
      and(
        eq(receipts.tenantId, scope.tenantId),
        inArray(receipts.chargeId, scope.db.select({ id: charges.id }).from(charges).where(ofRun)),
      ),
    )
    .get();
  return { charges: chargeCount?.n ?? 0, receipts: receiptCount?.n ?? 0 };
}

export interface RunSummary {
  readonly tenantId: string;
  readonly period: string;
  readonly attempted: number;
  readonly failed: number;
  readonly totalMinor: number;
  readonly currency: string;
}

/** Cross-tenant, for the payment-runs signal export. */
export function allRunSummaries(scope: AdminScope, sincePeriod: string): RunSummary[] {
  return scope.db
    .select({
      tenantId: paymentRuns.tenantId,
      period: paymentRuns.period,
      attempted: paymentRuns.chargesAttempted,
      failed: paymentRuns.chargesFailed,
      totalMinor: paymentRuns.totalMinor,
      currency: paymentRuns.currency,
    })
    .from(paymentRuns)
    .where(gte(paymentRuns.period, sincePeriod))
    .orderBy(asc(paymentRuns.tenantId), asc(paymentRuns.period))
    .all();
}

export function receiptsForMember(scope: TenantScope, memberId: string, limit = 24) {
  return guard(
    scope,
    'receipts',
    scope.db
      .select()
      .from(receipts)
      .where(and(eq(receipts.tenantId, scope.tenantId), eq(receipts.memberId, memberId)))
      .orderBy(desc(receipts.issuedAt))
      .limit(limit)
      .all(),
  );
}

export function revenueByPeriod(scope: TenantScope, limit = 18) {
  const rows = scope.db
    .select({
      period: paymentRuns.period,
      totalMinor: sum(charges.amountMinor).mapWith(Number),
      currency: paymentRuns.currency,
    })
    .from(charges)
    .innerJoin(paymentRuns, eq(charges.paymentRunId, paymentRuns.id))
    .where(and(eq(charges.tenantId, scope.tenantId), eq(charges.status, 'succeeded')))
    .groupBy(paymentRuns.period)
    .orderBy(desc(paymentRuns.period))
    .limit(limit)
    .all();
  return rows.reverse();
}
