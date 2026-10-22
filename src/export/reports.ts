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

import { and, asc, count, countDistinct, desc, eq, gte, inArray, lt, lte, or, sql } from 'drizzle-orm';
import {
  accessEvents,
  accessSyncState,
  charges,
  members,
  paymentRuns,
  sites,
  subscriptions,
} from '@/db/schema';
import { type TenantScope, guard } from '@/db/repositories/scope';
import * as classesRepo from '@/db/repositories/classes';
import * as tenantsRepo from '@/db/repositories/tenants';
import { memberSearchCondition } from '@/db/repositories/members';
import {
  type BillingPeriod,
  type PlainDate,
  TIMEZONES,
  addDays,
  billingPeriodOf,
  differenceInDays,
  endOfDayExclusive,
  startOfDay,
} from '@/domain/dates';
import type { Currency, Money } from '@/domain/money';
import { type SiteClassFill, tallyClassFill } from '@/domain/class-fill';
import { type HealthInputs, type HealthScore, scoreTenantHealth } from '@/domain/health';
import { FAILURE_CODES, type FailureCode } from '@/domain/retry-policy';

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
  readonly chargeId: string;
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

/** The filter the report applied: the known values of the one it was given, the search trimmed. */
export interface AppliedDunningFilter {
  readonly q?: string;
  readonly status?: DunningStatus;
  readonly reason?: FailureCode;
  readonly site?: string;
}

/** A filter plus the window of matching rows to return. */
export interface DunningQuery extends DunningFilter {
  /** Rows to return; the counts always cover every match. Defaults to 200. */
  readonly limit?: number;
  /** Matching rows to skip, for paging. Defaults to 0. */
  readonly offset?: number;
}

export interface OpenDunning {
  /** What narrowed the list. Values the report did not know are left out, as if not given. */
  readonly filter: AppliedDunningFilter;
  /** The window of matching rows, newest attempt first. */
  readonly rows: DunningRow[];
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

/**
 * The conditions that pick open dunning out of charges joined to members,
 * built once and used by both the rows and the counts so the count line never
 * disagrees with the list.
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

function openDunningRows(scope: TenantScope, filter: AppliedDunningFilter, limit: number, offset: number): DunningRow[] {
  const rows = scope.db
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
    // The charge id breaks ties between attempts in the same second, so a page
    // boundary never moves.
    .orderBy(desc(charges.attemptedAt), desc(charges.id))
    .limit(limit)
    .offset(offset)
    .all();
  guard(scope, 'charges', rows);
  return rows as DunningRow[];
}

/**
 * Open dunning: every `retrying` and `abandoned` charge of the tenant, newest
 * attempt first, one row per charge. The list a front desk works through: who
 * is behind, and what happens next.
 *
 * Called with a row limit it returns the newest rows, as the admin tenant page
 * uses it. Called with a query it returns the matching rows together with the
 * number of matching charges and members, counted over all of open dunning.
 */
export function openDunning(scope: TenantScope, limit?: number): DunningRow[];
export function openDunning(scope: TenantScope, query: DunningQuery): OpenDunning;
export function openDunning(scope: TenantScope, arg: number | DunningQuery = 200): DunningRow[] | OpenDunning {
  if (typeof arg === 'number') return openDunningRows(scope, {}, arg, 0);
  const filter = applicableDunningFilter(scope, arg);
  const rows = openDunningRows(scope, filter, arg.limit ?? 200, arg.offset ?? 0);
  const totals = scope.db
    .select({ chargeCount: count(), memberCount: countDistinct(charges.memberId) })
    .from(charges)
    .innerJoin(members, eq(members.id, charges.memberId))
    .where(and(...openDunningConditions(scope, filter)))
    .get();
  const { status: _status, ...withoutStatus } = filter;
  const { reason: _reason, ...withoutReason } = filter;
  return {
    filter,
    rows,
    chargeCount: totals?.chargeCount ?? 0,
    memberCount: totals?.memberCount ?? 0,
    statusCounts: chipCounts(scope, withoutStatus, charges.status, DUNNING_STATUSES),
    reasonCounts: chipCounts(scope, withoutReason, charges.failureCode, FAILURE_CODES),
  };
}

function isOneOf<T extends string>(values: readonly T[], value: string | undefined): value is T {
  return value !== undefined && (values as readonly string[]).includes(value);
}

/**
 * Keeps the values the report knows and drops the rest, so a mistyped or stale
 * link shows a wider list rather than an empty one. A site counts only if it is
 * one of this tenant's.
 */
function applicableDunningFilter(scope: TenantScope, filter: DunningFilter): AppliedDunningFilter {
  const q = filter.q?.trim() ?? '';
  const site =
    filter.site === undefined || filter.site === '' ? undefined : tenantsRepo.getSite(scope, filter.site)?.id;
  return {
    ...(q === '' ? {} : { q }),
    ...(isOneOf(DUNNING_STATUSES, filter.status) ? { status: filter.status } : {}),
    ...(isOneOf(FAILURE_CODES, filter.reason) ? { reason: filter.reason } : {}),
    ...(site === undefined ? {} : { site }),
  };
}

/** Matching charges per value of one column, with a 0 for every value that has none. */
function chipCounts<T extends string>(
  scope: TenantScope,
  filter: AppliedDunningFilter,
  column: typeof charges.status | typeof charges.failureCode,
  values: readonly T[],
): Record<T, number> {
  const groups = scope.db
    .select({ value: column, charges: count() })
    .from(charges)
    .innerJoin(members, eq(members.id, charges.memberId))
    .where(and(...openDunningConditions(scope, filter)))
    .groupBy(column)
    .all();
  return Object.fromEntries(
    values.map((value) => [value, groups.find((group) => group.value === value)?.charges ?? 0]),
  ) as Record<T, number>;
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

export type ClassFillRow = SiteClassFill;

/**
 * Class fill per site over a window of days, as it stands at `now`. A class
 * counts on its site-local day, in its own site's timezone. A class has
 * started when it starts at or before `now`; bookings on a class that has not
 * started are upcoming, and bookings on one that has but were never marked are
 * unmarked. Callers pass `now` from the application clock.
 */
export function classFillBySite(scope: TenantScope, window: ReportWindow, now: Date): ClassFillRow[] {
  // Fetch from the earliest start of the first day to the latest end of the
  // last day across the Nordic timezones; the domain function keeps the classes
  // whose site-local day, in their own site's timezone, is in the window.
  const starts = TIMEZONES.map((timezone) => startOfDay(window.from, timezone).getTime());
  const ends = TIMEZONES.map((timezone) => endOfDayExclusive(window.to, timezone).getTime());
  const rows = classesRepo.classFillRows(scope, {
    from: new Date(Math.min(...starts)).toISOString(),
    to: new Date(Math.max(...ends)).toISOString(),
  });
  return tallyClassFill(rows.classes, rows.bookings, window, now);
}

/**
 * The class fill report as CSV columns and cells. Owners' spreadsheets refer to
 * the columns by position, so new columns go at the end and existing ones never
 * move. A site with no no-show rate gets an empty cell, never 0.
 */
export function classFillCsv(rows: readonly ClassFillRow[]): {
  header: string[];
  rows: (string | number | null)[][];
} {
  return {
    header: [
      'site_id',
      'site_name',
      'classes',
      'capacity',
      'booked',
      'attended',
      'waitlisted',
      'fill_rate',
      'no_show_rate',
      'no_show',
      'unmarked',
      'upcoming',
    ],
    rows: rows.map((row) => [
      row.siteId,
      row.siteName,
      row.classes,
      row.capacity,
      row.booked,
      row.attended,
      row.waitlisted,
      row.fillRate.toFixed(4),
      row.noShowRate === null ? null : row.noShowRate.toFixed(4),
      row.noShow,
      row.unmarked,
      row.upcoming,
    ]),
  };
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
 *
 * Health is for the tenant's report day `today`, as it stands at `now`. Callers
 * pass both from the application clock (`time.today(timezone)` and `time.now`)
 * or the export's `--today`: the windows come from `today`, never from `now`,
 * because a pinned clock or an explicit `--today` can put `now` on the next
 * local day near Nordic midnight. `now` only splits upcoming from unmarked
 * bookings. Class fill is the class fill report's total over the same 30 days.
 */
export function tenantHealth(scope: TenantScope, today: PlainDate, now: Date): HealthReport {
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
  const fill = classFillBySite(scope, thirtyDays, now);
  const totalCapacity = fill.reduce((acc, row) => acc + row.capacity, 0);
  const totalBooked = fill.reduce((acc, row) => acc + row.booked, 0);

  const errorRows = scope.db
    .select({ n: count() })
    .from(sql`errors`)
    // eslint-disable-next-line no-restricted-syntax -- BCPLA-26: tenant health UTC window, BCPLA-20
    .where(sql`tenant_id = ${scope.tenantId} and at >= ${`${thirtyDays.from}T00:00:00.000Z`}`)
    .get();

  const requestProxy = Math.max(
    1000,
    scope.db
      .select({ n: count() })
      .from(sql`events`)
      // eslint-disable-next-line no-restricted-syntax -- BCPLA-26: tenant health UTC window, BCPLA-20
      .where(sql`tenant_id = ${scope.tenantId} and at >= ${`${thirtyDays.from}T00:00:00.000Z`}`)
      .get()?.n ?? 1000,
  );

  const appSessions =
    scope.db
      .select({ n: sql<number>`count(distinct actor_id)` })
      .from(sql`events`)
      .where(
        // eslint-disable-next-line no-restricted-syntax -- BCPLA-26: tenant health UTC window, BCPLA-20
        sql`tenant_id = ${scope.tenantId} and action = 'member_app.session' and at >= ${`${thirtyDays.from}T00:00:00.000Z`}`,
      )
      .get()?.n ?? 0;

  const lag = syncLagBySite(scope);
  const worstLagHours = lag.reduce((worst, row) => {
    if (row.lastSuccessAt === null) return Math.max(worst, 168);
    // eslint-disable-next-line no-restricted-syntax -- BCPLA-26: access sync lag measured from UTC end of day
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
