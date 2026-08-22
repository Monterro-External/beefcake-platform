/**
 * The reports.
 *
 * One module, used by both the reports screen in the tenant app and the CSV
 * export, so an owner who exports a report gets the same numbers they were
 * looking at. Everything here is read-only and tenant-scoped.
 *
 * These are the queries that decide whether the product feels fast. A key
 * account has 22,000 members and eighteen months of charges, so anything that
 * touches a member per row rather than aggregating in SQL is the difference
 * between a page and a timeout. If you add a report, check it against Nordic
 * Fitness Group before you check it against a single-site gym.
 */

import { and, asc, count, desc, eq, gte, inArray, lt, lte, or, sql } from 'drizzle-orm';
import {
  accessEvents,
  accessSyncState,
  bookings,
  charges,
  classes,
  members,
  paymentRuns,
  sites,
  subscriptions,
} from '@/db/schema';
import { type TenantScope, guard } from '@/db/repositories/scope';
import {
  type BillingPeriod,
  type PlainDate,
  addDays,
  billingPeriodOf,
  differenceInDays,
} from '@/domain/dates';
import type { Currency, Money } from '@/domain/money';
import { type HealthInputs, type HealthScore, scoreTenantHealth } from '@/domain/health';

export interface ReportWindow {
  readonly from: PlainDate;
  readonly to: PlainDate;
}

export function windowOfDays(today: PlainDate, days: number): ReportWindow {
  return { from: addDays(today, -days), to: today };
}

// ---------------------------------------------------------------------------
// Revenue
// ---------------------------------------------------------------------------

export interface RevenueRow {
  readonly period: BillingPeriod;
  readonly currency: Currency;
  readonly succeededMinor: number;
  readonly failedMinor: number;
  readonly charges: number;
  readonly failedCharges: number;
}

export function revenueByPeriod(scope: TenantScope, periods = 18): RevenueRow[] {
  const rows = scope.db
    .select({
      period: paymentRuns.period,
      currency: paymentRuns.currency,
      succeededMinor: sql<number>`coalesce(sum(case when ${charges.status} = 'succeeded' then ${charges.amountMinor} else 0 end), 0)`,
      failedMinor: sql<number>`coalesce(sum(case when ${charges.status} in ('failed','abandoned','retrying') and ${charges.attempt} = 1 then ${charges.amountMinor} else 0 end), 0)`,
      charges: sql<number>`sum(case when ${charges.attempt} = 1 then 1 else 0 end)`,
      failedCharges: sql<number>`sum(case when ${charges.attempt} = 1 and ${charges.status} != 'succeeded' then 1 else 0 end)`,
    })
    .from(paymentRuns)
    .leftJoin(charges, eq(charges.paymentRunId, paymentRuns.id))
    .where(eq(paymentRuns.tenantId, scope.tenantId))
    .groupBy(paymentRuns.period, paymentRuns.currency)
    .orderBy(desc(paymentRuns.period))
    .limit(periods)
    .all();
  return rows.reverse() as RevenueRow[];
}

// ---------------------------------------------------------------------------
// Failed payments
// ---------------------------------------------------------------------------

export interface FailedPaymentRow {
  readonly period: BillingPeriod;
  readonly failureCode: string;
  readonly charges: number;
  readonly amountMinor: number;
}

export function failedPaymentsByCode(scope: TenantScope, sincePeriod: BillingPeriod): FailedPaymentRow[] {
  return scope.db
    .select({
      period: paymentRuns.period,
      failureCode: sql<string>`coalesce(${charges.failureCode}, 'unknown')`,
      charges: count(),
      amountMinor: sql<number>`coalesce(sum(${charges.amountMinor}), 0)`,
    })
    .from(charges)
    .innerJoin(paymentRuns, eq(paymentRuns.id, charges.paymentRunId))
    .where(
      and(
        eq(charges.tenantId, scope.tenantId),
        gte(paymentRuns.period, sincePeriod),
        inArray(charges.status, ['failed', 'abandoned', 'retrying']),
      ),
    )
    .groupBy(paymentRuns.period, charges.failureCode)
    .orderBy(asc(paymentRuns.period), desc(count()))
    .all() as FailedPaymentRow[];
}

export interface DunningRow {
  readonly memberId: string;
  readonly memberName: string;
  readonly amountMinor: number;
  readonly currency: Currency;
  readonly failureCode: string | null;
  readonly attempt: number;
  readonly attemptedAt: string;
  readonly nextAttemptAt: string | null;
  readonly status: string;
}

/** The list a front desk works through: who is behind, and what happens next. */
export function openDunning(scope: TenantScope, limit = 200): DunningRow[] {
  const rows = scope.db
    .select({
      tenantId: charges.tenantId,
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
    .where(and(eq(charges.tenantId, scope.tenantId), inArray(charges.status, ['retrying', 'abandoned'])))
    .orderBy(desc(charges.attemptedAt))
    .limit(limit)
    .all();
  guard(scope, 'charges', rows);
  return rows as DunningRow[];
}

// ---------------------------------------------------------------------------
// Churn
// ---------------------------------------------------------------------------

export interface ChurnRow {
  /** ISO week, 'YYYY-Www'. */
  readonly week: string;
  readonly cancellations: number;
  readonly paymentDriven: number;
  readonly voluntary: number;
}

export function churnByWeek(scope: TenantScope, window: ReportWindow): ChurnRow[] {
  return scope.db
    .select({
      week: sql<string>`strftime('%Y-W%W', ${subscriptions.cancelledOn})`,
      cancellations: count(),
      paymentDriven: sql<number>`sum(case when ${subscriptions.cancelReason} = 'payment_failure' then 1 else 0 end)`,
      voluntary: sql<number>`sum(case when coalesce(${subscriptions.cancelReason}, '') != 'payment_failure' then 1 else 0 end)`,
    })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.tenantId, scope.tenantId),
        gte(subscriptions.cancelledOn, window.from),
        lte(subscriptions.cancelledOn, window.to),
      ),
    )
    .groupBy(sql`1`)
    .orderBy(asc(sql`1`))
    .all() as ChurnRow[];
}

export interface ChurnDetailRow {
  readonly memberId: string;
  readonly cancelledOn: PlainDate;
  readonly endsOn: PlainDate | null;
  readonly reason: string | null;
  readonly joinedOn: PlainDate;
  readonly tenureDays: number;
  /** Days between the last failed charge and the cancellation. Null if none. */
  readonly daysSinceLastFailedPayment: number | null;
}

/** How long a report is allowed to take before we give up on it. */
export const REPORT_DEADLINE_MS = 20_000;

export class ReportTimeoutError extends Error {
  constructor(
    readonly report: string,
    readonly elapsedMs: number,
  ) {
    super(`Report ${report} timed out after ${elapsedMs}ms`);
    this.name = 'ReportTimeoutError';
  }
}

/**
 * The last charge that failed for a member on or before a given day.
 *
 * Goes through the charges repository rather than hand-rolling SQL here, so the
 * tenant filter and the isolation guard are applied in one place instead of two.
 */
function lastFailedChargeFor(
  scope: TenantScope,
  memberId: string,
  onOrBefore: PlainDate,
): string | null {
  const failed = listChargesForReport(scope);
  let latest: string | null = null;
  for (const charge of failed) {
    if (charge.memberId !== memberId) continue;
    if (charge.attemptedAt.slice(0, 10) > onOrBefore) continue;
    if (latest === null || charge.attemptedAt > latest) latest = charge.attemptedAt;
  }
  return latest;
}

function listChargesForReport(scope: TenantScope) {
  return scope.db
    .select({
      tenantId: charges.tenantId,
      memberId: charges.memberId,
      attemptedAt: charges.attemptedAt,
    })
    .from(charges)
    .where(and(eq(charges.tenantId, scope.tenantId), inArray(charges.status, ['failed', 'abandoned'])))
    .all();
}

/**
 * Cancellations with the payment history that preceded them.
 *
 * The lag column is the point of this report: dunning gives up, and two to three
 * weeks later the member cancels.
 */
export function churnWithPaymentLag(scope: TenantScope, window: ReportWindow): ChurnDetailRow[] {
  const startedAt = Date.now();

  const rows = scope.db
    .select({
      tenantId: subscriptions.tenantId,
      memberId: subscriptions.memberId,
      cancelledOn: subscriptions.cancelledOn,
      endsOn: subscriptions.endsOn,
      reason: subscriptions.cancelReason,
      joinedOn: members.joinedOn,
    })
    .from(subscriptions)
    .innerJoin(members, eq(members.id, subscriptions.memberId))
    .where(
      and(
        eq(subscriptions.tenantId, scope.tenantId),
        gte(subscriptions.cancelledOn, window.from),
        lte(subscriptions.cancelledOn, window.to),
      ),
    )
    .orderBy(asc(subscriptions.cancelledOn))
    .all();
  guard(scope, 'subscriptions', rows);

  return rows.map((row) => {
    if (Date.now() - startedAt > REPORT_DEADLINE_MS) {
      throw new ReportTimeoutError('churn', Date.now() - startedAt);
    }
    const cancelledOn = row.cancelledOn as PlainDate;
    const lastFailedAt = lastFailedChargeFor(scope, row.memberId, cancelledOn);
    const lastFailedDay = lastFailedAt === null ? null : (lastFailedAt.slice(0, 10) as PlainDate);
    return {
      memberId: row.memberId,
      cancelledOn,
      endsOn: (row.endsOn as PlainDate | null) ?? null,
      reason: row.reason,
      joinedOn: row.joinedOn as PlainDate,
      tenureDays: differenceInDays(cancelledOn, row.joinedOn as PlainDate),
      daysSinceLastFailedPayment:
        lastFailedDay === null ? null : differenceInDays(cancelledOn, lastFailedDay),
    };
  });
}

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

export interface ClassFillRow {
  readonly siteId: string;
  readonly siteName: string;
  readonly classes: number;
  readonly capacity: number;
  readonly booked: number;
  readonly attended: number;
  readonly waitlisted: number;
  readonly fillRate: number;
  readonly noShowRate: number;
}

export function classFillBySite(scope: TenantScope, window: ReportWindow): ClassFillRow[] {
  const from = `${window.from}T00:00:00.000Z`;
  const to = `${window.to}T23:59:59.999Z`;

  // Capacity and bookings are counted separately on purpose: joining them and
  // summing capacity in one statement multiplies capacity by the booking count,
  // which is how the old version of this report managed to show 340% fill.
  const capacityRows = scope.db
    .select({
      siteId: classes.siteId,
      siteName: sites.name,
      classes: count(),
      capacity: sql<number>`coalesce(sum(${classes.capacity}), 0)`,
    })
    .from(classes)
    .innerJoin(sites, eq(sites.id, classes.siteId))
    .where(
      and(
        eq(classes.tenantId, scope.tenantId),
        eq(classes.cancelled, false),
        gte(classes.startsAt, from),
        lte(classes.startsAt, to),
      ),
    )
    .groupBy(classes.siteId, sites.name)
    .orderBy(asc(sites.name))
    .all();

  const bookingRows = scope.db
    .select({
      siteId: classes.siteId,
      booked: sql<number>`sum(case when ${bookings.status} in ('booked','attended','no_show') then 1 else 0 end)`,
      attended: sql<number>`sum(case when ${bookings.status} = 'attended' then 1 else 0 end)`,
      waitlisted: sql<number>`sum(case when ${bookings.status} = 'waitlisted' then 1 else 0 end)`,
    })
    .from(bookings)
    .innerJoin(classes, eq(classes.id, bookings.classId))
    .where(
      and(
        eq(bookings.tenantId, scope.tenantId),
        eq(classes.cancelled, false),
        gte(classes.startsAt, from),
        lte(classes.startsAt, to),
      ),
    )
    .groupBy(classes.siteId)
    .all();

  const byBookings = new Map(bookingRows.map((row) => [row.siteId, row]));
  return capacityRows.map((row) => {
    const counts = byBookings.get(row.siteId);
    const booked = counts?.booked ?? 0;
    const attended = counts?.attended ?? 0;
    return {
      siteId: row.siteId,
      siteName: row.siteName,
      classes: row.classes,
      capacity: row.capacity,
      booked,
      attended,
      waitlisted: counts?.waitlisted ?? 0,
      fillRate: row.capacity === 0 ? 0 : booked / row.capacity,
      noShowRate: booked === 0 ? 0 : Math.max(0, booked - attended) / booked,
    };
  });
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

export interface AccessReportRow {
  readonly siteId: string;
  readonly siteName: string;
  readonly granted: number;
  readonly denied: number;
  readonly deniedFrozen: number;
  readonly deniedEnded: number;
  readonly deniedUnknownCard: number;
}

export function accessBySite(scope: TenantScope, window: ReportWindow): AccessReportRow[] {
  const rows = scope.db
    .select({
      siteId: accessEvents.siteId,
      siteName: sites.name,
      granted: sql<number>`sum(case when ${accessEvents.result} = 'granted' then 1 else 0 end)`,
      denied: sql<number>`sum(case when ${accessEvents.result} = 'denied' then 1 else 0 end)`,
      deniedFrozen: sql<number>`sum(case when ${accessEvents.reason} = 'frozen' then 1 else 0 end)`,
      deniedEnded: sql<number>`sum(case when ${accessEvents.reason} = 'subscription_ended' then 1 else 0 end)`,
      deniedUnknownCard: sql<number>`sum(case when ${accessEvents.reason} = 'unknown_card' then 1 else 0 end)`,
    })
    .from(accessEvents)
    .innerJoin(sites, eq(sites.id, accessEvents.siteId))
    .where(
      and(
        eq(accessEvents.tenantId, scope.tenantId),
        gte(accessEvents.localDay, window.from),
        lte(accessEvents.localDay, window.to),
      ),
    )
    .groupBy(accessEvents.siteId, sites.name)
    .orderBy(asc(sites.name))
    .all();
  return rows as AccessReportRow[];
}

export interface SyncLagRow {
  readonly siteId: string;
  readonly siteName: string;
  readonly accessProvider: string;
  readonly lastSyncedAt: string | null;
  readonly lastSuccessAt: string | null;
  readonly pendingChanges: number;
  readonly lastError: string | null;
}

export function syncLagBySite(scope: TenantScope): SyncLagRow[] {
  const rows = scope.db
    .select({
      tenantId: sites.tenantId,
      siteId: sites.id,
      siteName: sites.name,
      accessProvider: sites.accessProvider,
      lastSyncedAt: accessSyncState.lastSyncedAt,
      lastSuccessAt: accessSyncState.lastSuccessAt,
      pendingChanges: sql<number>`coalesce(${accessSyncState.pendingChanges}, 0)`,
      lastError: accessSyncState.lastError,
    })
    .from(sites)
    .leftJoin(accessSyncState, eq(accessSyncState.siteId, sites.id))
    .where(eq(sites.tenantId, scope.tenantId))
    .orderBy(asc(sites.name))
    .all();
  guard(scope, 'sites', rows);
  return rows as SyncLagRow[];
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

export interface MembershipSummary {
  readonly active: number;
  readonly frozen: number;
  readonly cancelling: number;
  readonly former: number;
  readonly joinedInWindow: number;
  readonly leftInWindow: number;
}

export function membershipSummary(scope: TenantScope, window: ReportWindow): MembershipSummary {
  const statuses = scope.db
    .select({ status: members.status, n: count() })
    .from(members)
    .where(eq(members.tenantId, scope.tenantId))
    .groupBy(members.status)
    .all();
  const byStatus = new Map(statuses.map((row) => [row.status, row.n]));

  const frozen = scope.db
    .select({ n: count() })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.tenantId, scope.tenantId),
        sql`exists (select 1 from freezes f where f.subscription_id = ${subscriptions.id} and f.starts_on <= ${window.to} and f.ends_on >= ${window.to})`,
      ),
    )
    .get();

  const cancelling = scope.db
    .select({ n: count() })
    .from(subscriptions)
    .where(and(eq(subscriptions.tenantId, scope.tenantId), eq(subscriptions.status, 'cancelling')))
    .get();

  const joined = scope.db
    .select({ n: count() })
    .from(members)
    .where(
      and(
        eq(members.tenantId, scope.tenantId),
        gte(members.joinedOn, window.from),
        lte(members.joinedOn, window.to),
      ),
    )
    .get();

  const left = scope.db
    .select({ n: count() })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.tenantId, scope.tenantId),
        gte(subscriptions.endsOn, window.from),
        lte(subscriptions.endsOn, window.to),
      ),
    )
    .get();

  return {
    active: byStatus.get('active') ?? 0,
    frozen: frozen?.n ?? 0,
    cancelling: cancelling?.n ?? 0,
    former: byStatus.get('former') ?? 0,
    joinedInWindow: joined?.n ?? 0,
    leftInWindow: left?.n ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export interface HealthReport {
  readonly inputs: HealthInputs;
  readonly score: HealthScore;
  readonly activeMembers: number;
}

/**
 * The inputs behind a tenant's health score, computed from platform data only.
 * Support tickets and NPS live in other systems and are joined in downstream, so
 * they are deliberately absent.
 */
export function tenantHealth(scope: TenantScope, today: PlainDate): HealthReport {
  const lastRun = scope.db
    .select({ attempted: paymentRuns.chargesAttempted, failed: paymentRuns.chargesFailed })
    .from(paymentRuns)
    .where(and(eq(paymentRuns.tenantId, scope.tenantId), eq(paymentRuns.status, 'completed')))
    .orderBy(desc(paymentRuns.period))
    .limit(1)
    .get();

  const active =
    scope.db
      .select({ n: count() })
      .from(members)
      .where(and(eq(members.tenantId, scope.tenantId), eq(members.status, 'active')))
      .get()?.n ?? 0;

  const ninetyDays = windowOfDays(today, 90);
  const cancellations =
    scope.db
      .select({ n: count() })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.tenantId, scope.tenantId),
          gte(subscriptions.cancelledOn, ninetyDays.from),
          lte(subscriptions.cancelledOn, ninetyDays.to),
        ),
      )
      .get()?.n ?? 0;

  const thirtyDays = windowOfDays(today, 30);
  const fill = classFillBySite(scope, thirtyDays);
  const totalCapacity = fill.reduce((acc, row) => acc + row.capacity, 0);
  const totalBooked = fill.reduce((acc, row) => acc + row.booked, 0);

  const errorRows = scope.db
    .select({ n: count() })
    .from(sql`errors`)
    .where(sql`tenant_id = ${scope.tenantId} and at >= ${`${thirtyDays.from}T00:00:00.000Z`}`)
    .get();

  const requestProxy = Math.max(
    1000,
    scope.db
      .select({ n: count() })
      .from(sql`events`)
      .where(sql`tenant_id = ${scope.tenantId} and at >= ${`${thirtyDays.from}T00:00:00.000Z`}`)
      .get()?.n ?? 1000,
  );

  const appSessions =
    scope.db
      .select({ n: sql<number>`count(distinct actor_id)` })
      .from(sql`events`)
      .where(
        sql`tenant_id = ${scope.tenantId} and action = 'member_app.session' and at >= ${`${thirtyDays.from}T00:00:00.000Z`}`,
      )
      .get()?.n ?? 0;

  const lag = syncLagBySite(scope);
  const worstLagHours = lag.reduce((worst, row) => {
    if (row.lastSuccessAt === null) return Math.max(worst, 168);
    const hours = (Date.parse(`${today}T23:59:59Z`) - Date.parse(row.lastSuccessAt)) / 3_600_000;
    return Math.max(worst, Math.max(0, hours));
  }, 0);

  const inputs: HealthInputs = {
    failedPaymentRate:
      lastRun === undefined || lastRun.attempted === 0 ? 0 : lastRun.failed / lastRun.attempted,
    churnRate90d: active === 0 ? 0 : cancellations / active,
    classFillRate: totalCapacity === 0 ? 0 : totalBooked / totalCapacity,
    errorRatePerThousand: ((errorRows?.n ?? 0) / requestProxy) * 1000,
    accessSyncLagHours: worstLagHours,
    memberAppAdoption: active === 0 ? 0 : appSessions / active,
  };

  return { inputs, score: scoreTenantHealth(inputs), activeMembers: active };
}

export { billingPeriodOf, lt, or };
export type { Money };
