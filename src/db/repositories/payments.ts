import { and, asc, count, countDistinct, desc, eq, gte, inArray, isNotNull, lte, sql, sum } from 'drizzle-orm';
import type { BillingPeriod } from '@/domain/dates';
import type { Currency } from '@/domain/money';
import { FAILURE_CODES, type FailureCode } from '@/domain/retry-policy';
import { type Charge, type PaymentRun, charges, members, paymentRuns, receipts } from '../schema';
import { memberSearchCondition } from './members';
import { type AdminScope, type TenantScope, guard, guardOne } from './scope';
import { getSite } from './tenants';

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

// ---------------------------------------------------------------------------
// Open dunning
// ---------------------------------------------------------------------------

export interface DunningRow {
  readonly tenantId: string;
  readonly chargeId: string;
  readonly memberId: string;
  readonly memberName: string;
  readonly amountMinor: number;
  readonly currency: Currency;
  readonly failureCode: string | null;
  readonly attempt: number;
  readonly attemptedAt: string;
  readonly nextAttemptAt: string | null;
  readonly status: DunningStatus;
}

/** The two states of a charge in open dunning. */
export const DUNNING_STATUSES = ['retrying', 'abandoned'] as const;
export type DunningStatus = (typeof DUNNING_STATUSES)[number];

/**
 * What narrows open dunning. Every field is optional and an empty filter is all
 * of open dunning.
 */
export interface DunningFilter {
  /** The member search rule (name, email, phone, card number); trimmed, spaces only is no search. */
  readonly q?: string;
  /** `retrying` or `abandoned`. */
  readonly status?: string;
  /** A failure code, see `FAILURE_CODES`. */
  readonly reason?: string;
  /** A site id: the member's home site. */
  readonly site?: string;
}

/** The filter applied: the known values of the one given, the search trimmed. */
export interface AppliedDunningFilter {
  readonly q?: string;
  readonly status?: DunningStatus;
  readonly reason?: FailureCode;
  readonly site?: string;
}

/** The window of matching rows to return. */
export interface DunningWindow {
  /** Rows to return; the counts always cover every match. Defaults to 200. */
  readonly limit?: number;
  /** Matching rows to skip, for paging. Defaults to 0. */
  readonly offset?: number;
}

/** A filter plus the window of matching rows to return. */
export interface DunningQuery extends DunningFilter, DunningWindow {}

export interface OpenDunningCounts {
  /** Every matching charge, not just the rows returned. */
  readonly chargeCount: number;
  /** The distinct members those charges belong to. */
  readonly memberCount: number;
  /**
   * Charges each status chip would leave: every other active filter and the
   * search apply, the status filter does not.
   */
  readonly statusCounts: Record<DunningStatus, number>;
  /** Charges each reason chip would leave: every other filter applies, the reason filter does not. */
  readonly reasonCounts: Record<FailureCode, number>;
}

export interface OpenDunning extends OpenDunningCounts {
  /** What narrowed the list. Values not known are left out, as if not given. */
  readonly filter: AppliedDunningFilter;
  /** The window of matching rows, newest attempt first. */
  readonly rows: DunningRow[];
}

/**
 * The conditions that pick open dunning out of charges joined to members,
 * built once and used by both the rows and the counts so the count line never
 * disagrees with the list. Both tables are filtered on the tenant.
 */
function openDunningConditions(scope: TenantScope, filter: AppliedDunningFilter) {
  const conditions = [
    eq(charges.tenantId, scope.tenantId),
    eq(members.tenantId, scope.tenantId),
    filter.status === undefined
      ? inArray(charges.status, [...DUNNING_STATUSES])
      : eq(charges.status, filter.status),
  ];
  if (filter.reason !== undefined) conditions.push(eq(charges.failureCode, filter.reason));
  if (filter.site !== undefined) conditions.push(eq(members.homeSiteId, filter.site));
  const match = memberSearchCondition(filter.q);
  if (match !== undefined) conditions.push(match);
  return conditions;
}

/**
 * The charges in open dunning that match the filter, joined to their members:
 * the one query the rows, the totals and the chip counts all read from.
 */
function openDunningCharges(scope: TenantScope, filter: AppliedDunningFilter) {
  return scope.db
    .select({
      tenantId: charges.tenantId,
      chargeId: charges.id,
      memberId: charges.memberId,
      memberName: members.name,
      amountMinor: charges.amountMinor,
      currency: charges.currency,
      failureCode: charges.failureCode,
      attempt: charges.attempt,
      attemptedAt: charges.attemptedAt,
      nextAttemptAt: charges.nextAttemptAt,
      status: charges.status,
    })
    .from(charges)
    .innerJoin(members, eq(members.id, charges.memberId))
    .where(and(...openDunningConditions(scope, filter)))
    .as('open_dunning');
}

function isOneOf<T extends string>(values: readonly T[], value: string | undefined): value is T {
  return value !== undefined && (values as readonly string[]).includes(value);
}

/**
 * Keeps the values open dunning knows and drops the rest, so a mistyped or
 * stale link shows a wider list rather than an empty one. A site counts only if
 * it is one of this tenant's.
 */
export function openDunningFilter(scope: TenantScope, filter: DunningFilter): AppliedDunningFilter {
  const q = filter.q?.trim() ?? '';
  const site = filter.site === undefined || filter.site === '' ? undefined : getSite(scope, filter.site)?.id;
  return {
    ...(q === '' ? {} : { q }),
    ...(isOneOf(DUNNING_STATUSES, filter.status) ? { status: filter.status } : {}),
    ...(isOneOf(FAILURE_CODES, filter.reason) ? { reason: filter.reason } : {}),
    ...(site === undefined ? {} : { site }),
  };
}

/**
 * Open dunning: every `retrying` and `abandoned` charge of the tenant that
 * matches the filter, newest attempt first, one row per charge. The list a
 * front desk works through: who is behind, and what happens next.
 */
export function listOpenDunning(
  scope: TenantScope,
  query: AppliedDunningFilter & DunningWindow = {},
): DunningRow[] {
  const { limit = 200, offset = 0, ...filter } = query;
  const open = openDunningCharges(scope, filter);
  return guard(
    scope,
    'charges',
    scope.db
      .select()
      .from(open)
      // The charge id breaks ties between attempts in the same second, so a page
      // boundary never moves.
      .orderBy(desc(open.attemptedAt), desc(open.chargeId))
      .limit(limit)
      .offset(offset)
      .all(),
  ) as DunningRow[];
}

/** Matching charges per value of one column, with a 0 for every value that has none. */
function chipCounts<T extends string>(
  scope: TenantScope,
  filter: AppliedDunningFilter,
  column: 'status' | 'failureCode',
  values: readonly T[],
): Record<T, number> {
  const open = openDunningCharges(scope, filter);
  const groups = scope.db
    .select({ value: open[column], charges: count() })
    .from(open)
    .groupBy(open[column])
    .all();
  return Object.fromEntries(
    values.map((value) => [value, groups.find((group) => group.value === value)?.charges ?? 0]),
  ) as Record<T, number>;
}

/** The totals and chip counts of open dunning, counted over every match. */
export function openDunningCounts(scope: TenantScope, filter: AppliedDunningFilter = {}): OpenDunningCounts {
  const open = openDunningCharges(scope, filter);
  const totals = scope.db
    .select({ chargeCount: count(), memberCount: countDistinct(open.memberId) })
    .from(open)
    .get();
  const { status: _status, ...withoutStatus } = filter;
  const { reason: _reason, ...withoutReason } = filter;
  return {
    chargeCount: totals?.chargeCount ?? 0,
    memberCount: totals?.memberCount ?? 0,
    statusCounts: chipCounts(scope, withoutStatus, 'status', DUNNING_STATUSES),
    reasonCounts: chipCounts(scope, withoutReason, 'failureCode', FAILURE_CODES),
  };
}

/**
 * Open dunning narrowed by a filter as it arrives from a link: the applied
 * filter, the window of matching rows, and the counts over every match.
 */
export function openDunning(scope: TenantScope, query: DunningQuery = {}): OpenDunning {
  const filter = openDunningFilter(scope, query);
  return {
    filter,
    rows: listOpenDunning(scope, { ...filter, limit: query.limit, offset: query.offset }),
    ...openDunningCounts(scope, filter),
  };
}
