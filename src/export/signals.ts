/**
 * Signal exports.
 *
 * The commercial side (CS, sales, product) needs platform data, and giving them
 * database credentials would make every schema change their problem. So the
 * platform writes files on a stable contract instead:
 *
 *   events.jsonl        product usage per tenant: adoption, booking and sign-up funnels
 *   errors.jsonl        errors rolled up by tenant and module
 *   payment-runs.csv    per tenant per month: attempted, failed, failure codes
 *   churn.csv           cancellations per tenant per week, with days since the last failed payment
 *   tenant-health.csv   the inputs behind each tenant's health score
 *   access-sync.csv     sync lag per site
 *
 * The column and action names are the contract. Add a column at the end, add a
 * new action; never repurpose an existing one, because something downstream is
 * counting it.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { and, asc, count, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { errors, events, paymentRuns, seedMeta, tenants } from '@/db/schema';
import { type AdminScope, tenantScope } from '@/db/repositories/scope';
import { recordError } from '@/db/repositories/observability';
import { type PlainDate, assertPlainDate, billingPeriodOf } from '@/domain/dates';
import * as reports from './reports';

export interface ExportOptions {
  readonly since: PlainDate;
  readonly outDir: string;
  readonly today: PlainDate;
}

export interface ExportedFile {
  readonly name: string;
  readonly rows: number;
  readonly bytes: number;
}

export interface ExportResult {
  readonly outDir: string;
  readonly since: PlainDate;
  readonly today: PlainDate;
  readonly files: ExportedFile[];
  readonly durationMs: number;
}

/** Actions the commercial side counts. Anything else stays internal. */
export const EXPORTED_ACTIONS = [
  'member.created',
  'subscription.created',
  'subscription.plan_changed',
  'subscription.frozen',
  'subscription.cancelled',
  'booking.created',
  'booking.waitlisted',
  'booking.promoted',
  'member_app.session',
  'receipt.viewed',
  'report.viewed',
  'report.exported',
  'settings.changed',
  'payment_run.completed',
  'charge.failed',
  'charge.abandoned',
  'access.sync_failed',
] as const;

export function exportSignals(scope: AdminScope, options: ExportOptions): ExportResult {
  const startedAt = Date.now();
  const outDir = resolve(options.outDir);
  mkdirSync(outDir, { recursive: true });

  const files: ExportedFile[] = [
    writeJsonl(outDir, 'events.jsonl', eventRows(scope.db, options.since)),
    writeJsonl(outDir, 'errors.jsonl', errorRows(scope.db, options.since)),
    writeCsv(outDir, 'payment-runs.csv', paymentRunRows(scope.db, options.since)),
    writeCsv(outDir, 'churn.csv', churnRows(scope, options)),
    writeCsv(outDir, 'tenant-health.csv', tenantHealthRows(scope, options.today)),
    writeCsv(outDir, 'access-sync.csv', accessSyncRows(scope, options.today)),
  ];

  return {
    outDir,
    since: options.since,
    today: options.today,
    files,
    durationMs: Date.now() - startedAt,
  };
}

// ---------------------------------------------------------------------------
// events.jsonl
// ---------------------------------------------------------------------------

function eventRows(db: Db, since: PlainDate): Record<string, unknown>[] {
  const tenantNames = new Map(
    db.select({ id: tenants.id, name: tenants.name, segment: tenants.segment }).from(tenants).all()
      .map((t) => [t.id, t]),
  );

  const rows = db
    .select()
    .from(events)
    .where(
      and(
        gte(events.at, `${since}T00:00:00.000Z`),
        sql`${events.action} in (${sql.join(
          EXPORTED_ACTIONS.map((action) => sql`${action}`),
          sql`, `,
        )})`,
      ),
    )
    .orderBy(asc(events.at))
    .all();

  return rows.map((row) => {
    const tenant = row.tenantId === null ? undefined : tenantNames.get(row.tenantId);
    return {
      at: row.at,
      tenant_id: row.tenantId,
      tenant_name: tenant?.name ?? null,
      segment: tenant?.segment ?? null,
      action: row.action,
      actor_role: row.actorRole,
      subject_type: row.subjectType,
      subject_id: row.subjectId,
      payload: JSON.parse(row.payloadJson) as unknown,
    };
  });
}

// ---------------------------------------------------------------------------
// errors.jsonl
// ---------------------------------------------------------------------------

function errorRows(db: Db, since: PlainDate): Record<string, unknown>[] {
  const tenantNames = new Map(
    db.select({ id: tenants.id, name: tenants.name }).from(tenants).all().map((t) => [t.id, t.name]),
  );

  return db
    .select({
      tenantId: errors.tenantId,
      module: errors.where,
      severity: errors.severity,
      n: count(),
      firstAt: sql<string>`min(${errors.at})`,
      lastAt: sql<string>`max(${errors.at})`,
      sample: sql<string>`min(${errors.message})`,
    })
    .from(errors)
    .where(gte(errors.at, `${since}T00:00:00.000Z`))
    .groupBy(errors.tenantId, errors.where, errors.severity)
    .orderBy(sql`count(*) desc`)
    .all()
    .map((row) => ({
      tenant_id: row.tenantId,
      tenant_name: row.tenantId === null ? null : (tenantNames.get(row.tenantId) ?? null),
      module: row.module,
      severity: row.severity,
      count: row.n,
      first_at: row.firstAt,
      last_at: row.lastAt,
      sample_message: row.sample,
    }));
}

// ---------------------------------------------------------------------------
// payment-runs.csv
// ---------------------------------------------------------------------------

function paymentRunRows(db: Db, since: PlainDate): CsvTable {
  const sincePeriod = billingPeriodOf(since);
  const runs = db
    .select({
      tenantId: paymentRuns.tenantId,
      tenantName: tenants.name,
      segment: tenants.segment,
      period: paymentRuns.period,
      attempted: paymentRuns.chargesAttempted,
      failed: paymentRuns.chargesFailed,
      totalMinor: paymentRuns.totalMinor,
      currency: paymentRuns.currency,
      status: paymentRuns.status,
    })
    .from(paymentRuns)
    .innerJoin(tenants, eq(tenants.id, paymentRuns.tenantId))
    .where(gte(paymentRuns.period, sincePeriod))
    .orderBy(asc(tenants.name), asc(paymentRuns.period))
    .all();

  // Failure codes per tenant per period, in one query, then joined in memory.
  const codes = db
    .select({
      tenantId: paymentRuns.tenantId,
      period: paymentRuns.period,
      code: sql<string>`coalesce(charges.failure_code, 'unknown')`,
      n: sql<number>`count(*)`,
    })
    .from(paymentRuns)
    .innerJoin(sql`charges`, sql`charges.payment_run_id = ${paymentRuns.id}`)
    .where(
      and(gte(paymentRuns.period, sincePeriod), sql`charges.status in ('failed','abandoned','retrying')`),
    )
    .groupBy(paymentRuns.tenantId, paymentRuns.period, sql`charges.failure_code`)
    .all();

  const byRun = new Map<string, Record<string, number>>();
  for (const row of codes) {
    const key = `${row.tenantId}|${row.period}`;
    const entry = byRun.get(key) ?? {};
    entry[row.code] = row.n;
    byRun.set(key, entry);
  }

  const CODES = [
    'insufficient_funds',
    'mandate_cancelled',
    'account_closed',
    'technical',
    'rejected_by_bank',
  ] as const;

  return {
    header: [
      'tenant_id',
      'tenant_name',
      'segment',
      'period',
      'status',
      'charges_attempted',
      'charges_failed',
      'failure_rate',
      'total_minor',
      'currency',
      ...CODES.map((code) => `failed_${code}`),
    ],
    rows: runs.map((run) => {
      const breakdown = byRun.get(`${run.tenantId}|${run.period}`) ?? {};
      return [
        run.tenantId,
        run.tenantName,
        run.segment,
        run.period,
        run.status,
        run.attempted,
        run.failed,
        run.attempted === 0 ? '0.0000' : (run.failed / run.attempted).toFixed(4),
        run.totalMinor,
        run.currency,
        ...CODES.map((code) => breakdown[code] ?? 0),
      ];
    }),
  };
}

// ---------------------------------------------------------------------------
// churn.csv
// ---------------------------------------------------------------------------

function churnRows(scope: AdminScope, options: ExportOptions): CsvTable {
  const rows: CsvValue[][] = [];

  for (const tenant of scope.db.select().from(tenants).orderBy(asc(tenants.name)).all()) {
    const tenantView = tenantScope(tenant.id, { db: scope.db });
    const window = { from: options.since, to: options.today };

    // One tenant whose report does not finish must not take the whole export
    // with it. The failure is recorded and the run carries on, so the CS team
    // gets eleven tenants' worth of data and a visible gap rather than nothing.
    let detail: reports.ChurnDetailRow[];
    try {
      detail = reports.churnWithPaymentLag(tenantView, window);
    } catch (error) {
      if (!(error instanceof reports.ReportTimeoutError)) throw error;
      recordError(tenantView, {
        where: 'export/signals',
        message: error.message,
        severity: 'error',
        context: { report: 'churn', tenant: tenant.name, since: options.since },
        at: new Date().toISOString(),
      });
      rows.push([tenant.id, tenant.name, tenant.segment, '', '', '', '', '', '']);
      continue;
    }

    // Weekly, with the lag distribution, because the interesting question is
    // "how long after a failed payment do they leave", not just "how many left".
    const byWeek = new Map<string, { total: number; payment: number; lags: number[] }>();
    for (const row of detail) {
      const week = isoWeek(row.cancelledOn);
      const entry = byWeek.get(week) ?? { total: 0, payment: 0, lags: [] };
      entry.total += 1;
      if (row.reason === 'payment_failure') entry.payment += 1;
      if (row.daysSinceLastFailedPayment !== null) entry.lags.push(row.daysSinceLastFailedPayment);
      byWeek.set(week, entry);
    }

    for (const [week, entry] of [...byWeek].sort(([a], [b]) => a.localeCompare(b))) {
      rows.push([
        tenant.id,
        tenant.name,
        tenant.segment,
        week,
        entry.total,
        entry.payment,
        entry.total - entry.payment,
        entry.lags.length === 0 ? '' : median(entry.lags),
        entry.lags.length,
      ]);
    }
  }

  return {
    header: [
      'tenant_id',
      'tenant_name',
      'segment',
      'week',
      'cancellations',
      'payment_driven',
      'voluntary',
      'median_days_since_last_failed_payment',
      'with_prior_failed_payment',
    ],
    rows,
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] as number;
  return Math.round((((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2) * 10) / 10;
}

/** ISO-8601 week, matching what the CS team's spreadsheets expect. */
export function isoWeek(day: PlainDate): string {
  const [year, month, date] = day.split('-').map((v) => Number.parseInt(v, 10)) as [
    number,
    number,
    number,
  ];
  const at = new Date(Date.UTC(year, month - 1, date));
  // Thursday of the current ISO week determines the year and week number.
  const dayOfWeek = (at.getUTCDay() + 6) % 7;
  at.setUTCDate(at.getUTCDate() - dayOfWeek + 3);
  const isoYear = at.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayOfWeek = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayOfWeek + 3);
  const week = 1 + Math.round((at.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// tenant-health.csv
// ---------------------------------------------------------------------------

function tenantHealthRows(scope: AdminScope, today: PlainDate): CsvTable {
  const rows: CsvValue[][] = [];

  for (const tenant of scope.db.select().from(tenants).orderBy(asc(tenants.name)).all()) {
    const tenantView = tenantScope(tenant.id, { db: scope.db });
    const health = reports.tenantHealth(tenantView, today);
    const sites = reports.syncLagBySite(tenantView).length;
    rows.push([
      tenant.id,
      tenant.name,
      tenant.segment,
      tenant.country,
      tenant.currency,
      sites,
      health.activeMembers,
      health.score.score,
      health.score.band,
      health.inputs.failedPaymentRate.toFixed(4),
      health.inputs.churnRate90d.toFixed(4),
      health.inputs.classFillRate.toFixed(4),
      health.inputs.errorRatePerThousand.toFixed(3),
      Math.round(health.inputs.accessSyncLagHours),
      health.inputs.memberAppAdoption.toFixed(4),
    ]);
  }

  return {
    header: [
      'tenant_id',
      'tenant_name',
      'segment',
      'country',
      'currency',
      'sites',
      'active_members',
      'health_score',
      'health_band',
      'failed_payment_rate',
      'churn_rate_90d',
      'class_fill_rate',
      'error_rate_per_thousand',
      'access_sync_lag_hours',
      'member_app_adoption',
    ],
    rows,
  };
}

// ---------------------------------------------------------------------------
// access-sync.csv
// ---------------------------------------------------------------------------

function accessSyncRows(scope: AdminScope, today: PlainDate): CsvTable {
  const rows: CsvValue[][] = [];
  const endOfToday = Date.parse(`${today}T23:59:59.999Z`);

  for (const tenant of scope.db.select().from(tenants).orderBy(asc(tenants.name)).all()) {
    const tenantView = tenantScope(tenant.id, { db: scope.db });
    for (const site of reports.syncLagBySite(tenantView)) {
      const lagHours =
        site.lastSuccessAt === null
          ? ''
          : Math.max(0, Math.round((endOfToday - Date.parse(site.lastSuccessAt)) / 3_600_000));
      rows.push([
        tenant.id,
        tenant.name,
        site.siteId,
        site.siteName,
        site.accessProvider,
        site.lastSyncedAt ?? '',
        site.lastSuccessAt ?? '',
        lagHours,
        site.pendingChanges,
        site.lastError ?? '',
      ]);
    }
  }

  return {
    header: [
      'tenant_id',
      'tenant_name',
      'site_id',
      'site_name',
      'access_provider',
      'last_synced_at',
      'last_success_at',
      'lag_hours',
      'pending_changes',
      'last_error',
    ],
    rows,
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

type CsvValue = string | number | null;

interface CsvTable {
  readonly header: readonly string[];
  readonly rows: readonly CsvValue[][];
}

function writeJsonl(outDir: string, name: string, rows: readonly Record<string, unknown>[]): ExportedFile {
  const body = rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length > 0 ? '\n' : '');
  const path = join(outDir, name);
  writeFileSync(path, body, 'utf8');
  return { name, rows: rows.length, bytes: Buffer.byteLength(body) };
}

export function csvCell(value: CsvValue): string {
  if (value === null) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(outDir: string, name: string, table: CsvTable): ExportedFile {
  const lines = [table.header.join(','), ...table.rows.map((row) => row.map(csvCell).join(','))];
  const body = `${lines.join('\n')}\n`;
  const path = join(outDir, name);
  writeFileSync(path, body, 'utf8');
  return { name, rows: table.rows.length, bytes: Buffer.byteLength(body) };
}

/** The date the local database was seeded for, used when `--today` is omitted. */
export function seededToday(db: Db): PlainDate {
  const meta = db.select().from(seedMeta).get();
  if (meta === undefined) return assertPlainDate(new Date().toISOString().slice(0, 10));
  return assertPlainDate(meta.today);
}
