/**
 * The job runner.
 *
 * There is no queue (see docs/adr/0006-job-runner-without-a-queue.md). A job is
 * a function that takes a context and returns a summary. This module gives every
 * job the same three things:
 *
 *  - a `now` that is passed in rather than read from the clock, so a job can be
 *    run against a seeded database as if it were any date
 *  - a `job_runs` row recording what happened, including the failure
 *  - per-tenant isolation: the job iterates tenants and gets a `TenantScope` for
 *    each, so a job cannot accidentally work across tenants
 *
 * Jobs must be idempotent per tenant and period. Running one twice is normal:
 * the scheduler retries, and support re-runs.
 */

import { asc, eq } from 'drizzle-orm';
import { type Db, connection } from '@/db/client';
import { newId } from '@/db/ids';
import { jobRuns, seedMeta, tenants } from '@/db/schema';
import { type TenantScope, tenantScope } from '@/db/repositories/scope';
import { getSettings } from '@/db/repositories/tenants';
import type { TenantSettings } from '@/domain/tenant-settings';
import { type PlainDate, type Timezone, assertPlainDate, localDay } from '@/domain/dates';
import { type Integrations, createIntegrations } from '@/integrations';
import type { Tenant } from '@/db/schema';

export interface JobContext {
  readonly db: Db;
  /** The instant the job is running at. Never `new Date()` inside a job. */
  readonly now: Date;
  readonly integrations: Integrations;
  readonly log: (message: string) => void;
  readonly dryRun: boolean;
}

export interface TenantJobContext extends JobContext {
  readonly tenant: Tenant;
  readonly scope: TenantScope;
  readonly settings: TenantSettings;
  readonly timezone: Timezone;
  /** Today, in the tenant's own timezone. */
  readonly today: PlainDate;
}

export type JobSummary = Record<string, number | string | boolean | null>;

export interface Job<S extends JobSummary = JobSummary> {
  readonly name: string;
  readonly describe: string;
  /** Run once per tenant. Most jobs are this shape. */
  readonly perTenant?: (context: TenantJobContext) => S;
  /** Run once for the whole fleet. */
  readonly once?: (context: JobContext) => S;
}

export interface RunOptions {
  readonly now?: Date;
  readonly tenantId?: string;
  readonly dryRun?: boolean;
  readonly quiet?: boolean;
  readonly db?: Db;
}

export interface RunResult {
  readonly job: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly tenants: number;
  readonly summary: JobSummary;
  readonly perTenant: { tenantId: string; tenantName: string; summary: JobSummary }[];
}

/**
 * The instant a job should treat as "now" when nothing is passed.
 *
 * In production this is the wall clock. Locally it is the date the database was
 * seeded for, because a payment run dated 2029 against a database whose history
 * ends in 2026 tells you nothing. Pass `--now` to override.
 */
export function defaultNow(db: Db): Date {
  const meta = db.select().from(seedMeta).get();
  if (meta === undefined) return new Date();
  const seededToday = assertPlainDate(meta.today);
  const real = new Date();
  const realToday = real.toISOString().slice(0, 10);
  if (realToday === seededToday) return real;
  // Keep the time of day, move the date to the seeded one.
  return new Date(`${seededToday}T${real.toISOString().slice(11)}`);
}

export function runJob<S extends JobSummary>(job: Job<S>, options: RunOptions = {}): RunResult {
  const db = options.db ?? connection().db;
  const now = options.now ?? defaultNow(db);
  const quiet = options.quiet ?? false;
  const log = (message: string): void => {
    if (!quiet) process.stdout.write(`${message}\n`);
  };

  const context: JobContext = {
    db,
    now,
    integrations: createIntegrations({ salt: 'beefcake' }),
    log,
    dryRun: options.dryRun ?? false,
  };

  // Resolve the tenant filter before recording anything: a typo in --tenant
  // should be an error message, not a foreign key violation half way in.
  const allTenants =
    job.perTenant === undefined ? [] : db.select().from(tenants).orderBy(asc(tenants.name)).all();
  const selectedTenants =
    options.tenantId === undefined ? allTenants : allTenants.filter((t) => t.id === options.tenantId);
  if (options.tenantId !== undefined && job.perTenant !== undefined && selectedTenants.length === 0) {
    throw new Error(`No such tenant: ${options.tenantId}`);
  }

  const startedAt = now.toISOString();
  const runId = newId('jobRun');
  db.insert(jobRuns)
    .values({
      id: runId,
      job: job.name,
      tenantId: selectedTenants.length === 1 ? (selectedTenants[0]?.id ?? null) : null,
      startedAt,
      finishedAt: null,
      status: 'running',
      summaryJson: '{}',
    })
    .run();

  const perTenant: RunResult['perTenant'] = [];
  const totals: JobSummary = {};

  const accumulate = (summary: JobSummary): void => {
    for (const [key, value] of Object.entries(summary)) {
      if (typeof value !== 'number') continue;
      totals[key] = ((totals[key] as number | undefined) ?? 0) + value;
    }
  };

  try {
    if (job.once !== undefined) {
      accumulate(job.once(context));
    }

    if (job.perTenant !== undefined) {
      for (const tenant of selectedTenants) {
        const scope = tenantScope(tenant.id, { db, actorId: null, actorRole: 'system' });
        const timezone = timezoneForCountry(tenant.country);
        const tenantContext: TenantJobContext = {
          ...context,
          tenant,
          scope,
          settings: getSettings(scope),
          timezone,
          today: localDay(now, timezone),
        };
        const summary = job.perTenant(tenantContext);
        perTenant.push({ tenantId: tenant.id, tenantName: tenant.name, summary });
        accumulate(summary);
      }
    }

    const finishedAt = new Date().toISOString();
    db.update(jobRuns)
      .set({ finishedAt, status: 'completed', summaryJson: JSON.stringify(totals) })
      .where(eq(jobRuns.id, runId))
      .run();

    return {
      job: job.name,
      startedAt,
      finishedAt,
      tenants: perTenant.length,
      summary: totals,
      perTenant,
    };
  } catch (error) {
    db.update(jobRuns)
      .set({
        finishedAt: new Date().toISOString(),
        status: 'failed',
        summaryJson: JSON.stringify({ ...totals, error: (error as Error).message }),
      })
      .where(eq(jobRuns.id, runId))
      .run();
    throw error;
  }
}

const TIMEZONE_BY_COUNTRY: Record<string, Timezone> = {
  SE: 'Europe/Stockholm',
  NO: 'Europe/Oslo',
  FI: 'Europe/Helsinki',
  DK: 'Europe/Copenhagen',
};

export function timezoneForCountry(country: string): Timezone {
  return TIMEZONE_BY_COUNTRY[country] ?? 'Europe/Stockholm';
}

export function formatRunResult(result: RunResult): string {
  const lines = [`${result.job}: ${result.tenants} tenant(s)`];
  for (const [key, value] of Object.entries(result.summary)) {
    lines.push(`  ${key.padEnd(24)} ${String(value).padStart(10)}`);
  }
  return lines.join('\n');
}
