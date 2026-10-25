/**
 * The jobs, run against a real seeded database.
 *
 * These are the closest thing the repo has to integration tests. They matter
 * because the jobs are where the domain, the repositories and the integrations
 * have to agree, and because the operational properties (idempotence, recovery
 * from a killed run) are only visible when something actually writes rows.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Connection } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { seedDatabase } from '@/db/seed';
import { SCALES } from '@/db/seed/blueprint';
import { PINNED_TODAY } from '@/db/seed/options';
import { bookings, charges, classes, paymentRuns, receipts, accessSyncState } from '@/db/schema';
import * as paymentsRepo from '@/db/repositories/payments';
import { tenantScope } from '@/db/repositories/scope';
import { runJob } from '@/jobs/runner';
import { paymentRunJob, periodForRunDay, runDayFor } from '@/jobs/payment-run';
import { accessSyncJob } from '@/jobs/access-sync';
import { waitlistPromoteJob } from '@/jobs/waitlist-promote';
import { plainDate } from '@/domain/dates';

let dir: string;
let connection: Connection;

const NEXT_RUN = new Date('2026-09-25T03:00:00.000Z');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'beefcake-jobs-'));
  const path = join(dir, 'jobs.db');
  runMigrations(path);
  connection = openDatabase(path);
  seedDatabase(connection, { today: PINNED_TODAY, seed: 'jobs-test', scale: SCALES.tiny });
});

afterEach(() => {
  connection.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

function run(job: Parameters<typeof runJob>[0], now: Date, options: { dryRun?: boolean } = {}) {
  return runJob(job, { now, quiet: true, db: connection.db, dryRun: options.dryRun ?? false });
}

const countRows = (table: 'charges' | 'payment_runs' | 'bookings' | 'receipts'): number =>
  (connection.sqlite.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;

/**
 * Simulate a killed process: a run row for 2026-09 still marked running, with
 * one of its charges and that charge's receipt written. `nth` picks the tenant.
 */
function leaveRunHalfFinished(nth = 0): { tenantId: string; runId: string } {
  const tenant = connection.sqlite
    .prepare('select id, currency from tenants order by id limit 1 offset ?')
    .get(nth) as { id: string; currency: 'SEK' };
  const suffix = nth === 0 ? '' : `_${nth}`;
  connection.db
    .insert(paymentRuns)
    .values({
      id: `run_partial${suffix}`,
      tenantId: tenant.id,
      period: '2026-09',
      startedAt: '2026-09-25T03:00:00.000Z',
      finishedAt: null,
      status: 'running',
      currency: tenant.currency,
      chargesAttempted: 3,
      chargesFailed: 0,
      totalMinor: 1,
      triggeredBy: 'schedule',
    })
    .run();
  const victim = connection.sqlite
    .prepare('select id, member_id as memberId, subscription_id as subscriptionId from charges where tenant_id = ? limit 1')
    .get(tenant.id) as { id: string; memberId: string; subscriptionId: string };
  connection.db
    .insert(charges)
    .values({
      id: `chg_partial${suffix}`,
      tenantId: tenant.id,
      paymentRunId: `run_partial${suffix}`,
      memberId: victim.memberId,
      subscriptionId: victim.subscriptionId,
      amountMinor: 1,
      currency: tenant.currency,
      status: 'succeeded',
      method: 'autogiro',
      attempt: 1,
      attemptedAt: '2026-09-25T03:00:00.000Z',
    })
    .run();
  connection.db
    .insert(receipts)
    .values({
      id: `rcp_partial${suffix}`,
      tenantId: tenant.id,
      chargeId: `chg_partial${suffix}`,
      memberId: victim.memberId,
      number: `202609-99999${nth}`,
      issuedAt: '2026-09-25T03:00:00.000Z',
      currency: tenant.currency,
      totalMinor: 1,
      linesJson: '[]',
    })
    .run();
  return { tenantId: tenant.id, runId: `run_partial${suffix}` };
}

describe('which period a run bills', () => {
  it('bills the current month once the run day has arrived', () => {
    expect(periodForRunDay(plainDate(2026, 8, 25))).toBe('2026-08');
    expect(periodForRunDay(plainDate(2026, 8, 31))).toBe('2026-08');
  });

  it('bills the previous month before the run day', () => {
    expect(periodForRunDay(plainDate(2026, 8, 24))).toBe('2026-07');
    expect(periodForRunDay(plainDate(2026, 1, 1))).toBe('2025-12');
  });

  it('puts the run day on the 25th of the period it bills', () => {
    expect(runDayFor('2026-08')).toBe('2026-08-25');
    expect(runDayFor('2027-02')).toBe('2027-02-25');
  });
});

describe('payment run', () => {
  it('does nothing new on a day when the current run has already gone out', () => {
    const before = countRows('payment_runs');
    const result = run(paymentRunJob, new Date(`${PINNED_TODAY}T09:00:00.000Z`));
    expect(result.summary.runsCreated).toBe(0);
    expect(countRows('payment_runs')).toBe(before);
  });

  it('creates one run per tenant on the next run day', () => {
    const before = countRows('payment_runs');
    const result = run(paymentRunJob, NEXT_RUN);
    expect(result.summary.runsCreated).toBe(12);
    expect(countRows('payment_runs')).toBe(before + 12);
    expect(result.summary.charged as number).toBeGreaterThan(0);
  });

  it('is idempotent: running it twice does not charge anyone twice', () => {
    const runsBefore = countRows('payment_runs');
    const first = run(paymentRunJob, NEXT_RUN);
    expect(first.summary.charged as number).toBeGreaterThan(0);
    const chargesAfterFirst = countRows('charges');

    const second = run(paymentRunJob, NEXT_RUN);
    expect(second.summary.runsCreated).toBe(0);
    expect(second.summary.charged).toBe(0);
    expect(second.summary.partialRunsDiscarded).toBe(0);
    // Exactly one run per tenant for the period, no matter how often it is run.
    expect(countRows('payment_runs')).toBe(runsBefore + 12);
    // The second pass may still work through retries that came due, so charges
    // can grow. What it must not do is bill the period again.
    expect(countRows('charges')).toBeGreaterThanOrEqual(chargesAfterFirst);
    const duplicates = connection.sqlite
      .prepare(
        `select count(*) as n from (
           select c.member_id from charges c join payment_runs r on r.id = c.payment_run_id
            where r.period = '2026-09' and c.attempt = 1
            group by c.member_id having count(*) > 1)`,
      )
      .get() as { n: number };
    expect(duplicates.n).toBe(0);
  });

  it('changes nothing on a dry run', () => {
    const before = { runs: countRows('payment_runs'), charges: countRows('charges') };
    const result = run(paymentRunJob, NEXT_RUN, { dryRun: true });
    expect(countRows('payment_runs')).toBe(before.runs);
    expect(countRows('charges')).toBe(before.charges);
    expect(result.summary.charged).toBe(0);
  });

  it('discards and redoes a run that a previous invocation left half finished', () => {
    const { tenantId } = leaveRunHalfFinished();

    const result = run(paymentRunJob, NEXT_RUN);
    expect(result.summary.partialRunsDiscarded).toBe(1);
    expect(result.summary.chargesDiscarded).toBe(1);
    expect(result.summary.runsCreated).toBe(12);
    // The partial attempt is gone, replaced by a completed run for that period.
    expect(
      connection.sqlite.prepare("select count(*) as n from charges where id = 'chg_partial'").get(),
    ).toEqual({ n: 0 });
    expect(
      connection.sqlite.prepare("select count(*) as n from receipts where id = 'rcp_partial'").get(),
    ).toEqual({ n: 0 });
    const replacement = connection.db
      .select()
      .from(paymentRuns)
      .where(and(eq(paymentRuns.tenantId, tenantId), eq(paymentRuns.period, '2026-09')))
      .get();
    expect(replacement?.status).toBe('completed');
    expect(replacement?.id).not.toBe('run_partial');
  });

  it('keeps a half-finished run on a dry run and reports what it would discard', () => {
    leaveRunHalfFinished();
    const before = {
      runs: countRows('payment_runs'),
      charges: countRows('charges'),
      receipts: countRows('receipts'),
    };

    const result = run(paymentRunJob, NEXT_RUN, { dryRun: true });

    expect(result.summary.partialRunsDiscarded).toBe(1);
    expect(result.summary.chargesDiscarded).toBe(1);
    expect(countRows('payment_runs')).toBe(before.runs);
    expect(countRows('charges')).toBe(before.charges);
    expect(countRows('receipts')).toBe(before.receipts);
    expect(
      connection.sqlite.prepare("select status from payment_runs where id = 'run_partial'").get(),
    ).toEqual({ status: 'running' });
  });

  it('records the run in job_runs, including the summary', () => {
    run(paymentRunJob, NEXT_RUN);
    const jobRun = connection.sqlite
      .prepare("select * from job_runs where job = 'payment-run' order by started_at desc limit 1")
      .get() as { status: string; summary_json: string; finished_at: string };
    expect(jobRun.status).toBe('completed');
    expect(jobRun.finished_at).not.toBeNull();
    expect(JSON.parse(jobRun.summary_json).charged).toBeGreaterThan(0);
  });

  it('issues exactly one receipt per successful charge', () => {
    run(paymentRunJob, NEXT_RUN);
    const orphans = connection.sqlite
      .prepare(
        "select count(*) as n from receipts r join charges c on c.id = r.charge_id where c.status != 'succeeded'",
      )
      .get() as { n: number };
    expect(orphans.n).toBe(0);
    const duplicates = connection.sqlite
      .prepare('select count(*) as n from (select charge_id from receipts group by charge_id having count(*) > 1)')
      .get() as { n: number };
    expect(duplicates.n).toBe(0);
  });

  it('gives every receipt a number unique within its tenant', () => {
    run(paymentRunJob, NEXT_RUN);
    const clashes = connection.sqlite
      .prepare(
        'select count(*) as n from (select tenant_id, number from receipts group by tenant_id, number having count(*) > 1)',
      )
      .get() as { n: number };
    expect(clashes.n).toBe(0);
  });

  it('processes the retries that were pending as of today', () => {
    // The seed leaves charges mid-retry with a next attempt the day after today.
    const pending = connection.sqlite
      .prepare("select count(*) as n from charges where status = 'retrying'")
      .get() as { n: number };
    expect(pending.n).toBeGreaterThan(0);

    const result = run(paymentRunJob, new Date('2026-08-28T04:00:00.000Z'));
    expect(result.summary.retriesAttempted as number).toBeGreaterThan(0);
    expect(result.summary.retriesRecovered as number).toBeGreaterThan(0);
    // No charge is left claiming a retry that is already in the past.
    const stale = connection.sqlite
      .prepare("select count(*) as n from charges where status = 'retrying' and next_attempt_at < '2026-08-28T04:00:00.000Z'")
      .get() as { n: number };
    expect(stale.n).toBe(0);
  });

  it('never sends an attempt beyond a tenant that has set a cap', () => {
    run(paymentRunJob, new Date('2026-08-28T04:00:00.000Z'));
    run(paymentRunJob, new Date('2026-08-31T04:00:00.000Z'));
    run(paymentRunJob, new Date('2026-09-03T04:00:00.000Z'));
    const capped = connection.sqlite
      .prepare(
        `select c.tenant_id as tenantId, max(c.attempt) as highest, cast(s.value as integer) as cap
           from charges c
           join tenant_settings s
             on s.tenant_id = c.tenant_id and s.key = 'retry_attempts'
          group by c.tenant_id, s.value`,
      )
      .all() as { tenantId: string; highest: number; cap: number }[];
    expect(capped.length).toBeGreaterThan(0);
    for (const row of capped) expect(row.highest).toBeLessThanOrEqual(row.cap);
  });

  it('suspends the subscription when dunning gives up', () => {
    const at = '2026-08-28T04:00:00.000Z';
    run(paymentRunJob, new Date(at));
    // Only charges this invocation abandoned, not the ones the seed left behind.
    const abandoned = connection.sqlite
      .prepare(
        "select subscription_id as id from charges where status = 'abandoned' and attempt > 1 and attempted_at = ? limit 1",
      )
      .get(at) as { id: string } | undefined;
    expect(abandoned).toBeDefined();
    const subscription = connection.sqlite
      .prepare('select status, cancel_reason as reason from subscriptions where id = ?')
      .get(abandoned?.id) as { status: string; reason: string };
    expect(['cancelling', 'cancelled']).toContain(subscription.status);
    expect(subscription.reason).toBe('payment_failure');
  });

  it('can be scoped to a single tenant', () => {
    const tenant = connection.sqlite.prepare('select id from tenants limit 1').get() as { id: string };
    const result = runJob(paymentRunJob, {
      now: NEXT_RUN,
      tenantId: tenant.id,
      quiet: true,
      db: connection.db,
    });
    expect(result.tenants).toBe(1);
    expect(result.summary.runsCreated).toBe(1);
  });

  it('refuses an unknown tenant rather than silently doing nothing', () => {
    expect(() =>
      runJob(paymentRunJob, { now: NEXT_RUN, tenantId: 'ten_nope', quiet: true, db: connection.db }),
    ).toThrow(/No such tenant/);
  });
});

describe('a partial run footprint', () => {
  it("counts the charges and receipts of the run", () => {
    const { tenantId, runId } = leaveRunHalfFinished(0);
    leaveRunHalfFinished(1);

    const footprint = paymentsRepo.partialRunFootprint(
      tenantScope(tenantId, { db: connection.db }),
      runId,
    );

    expect(footprint).toEqual({ charges: 1, receipts: 1 });
  });

  it("counts nothing for another tenant's run", () => {
    const { tenantId } = leaveRunHalfFinished(0);
    const other = leaveRunHalfFinished(1);

    const footprint = paymentsRepo.partialRunFootprint(
      tenantScope(tenantId, { db: connection.db }),
      other.runId,
    );

    expect(footprint).toEqual({ charges: 0, receipts: 0 });
  });
});

describe('access sync', () => {
  it('pushes an allow-list to every site', () => {
    const sites = connection.sqlite.prepare('select count(*) as n from sites').get() as { n: number };
    const result = run(accessSyncJob, new Date(`${PINNED_TODAY}T02:15:00.000Z`));
    expect((result.summary.sitesSynced as number) + (result.summary.sitesFailed as number)).toBe(sites.n);
    expect(result.summary.grantsPushed as number).toBeGreaterThan(0);
  });

  it('leaves a sync state row per site, with a timestamp', () => {
    run(accessSyncJob, new Date(`${PINNED_TODAY}T02:15:00.000Z`));
    const states = connection.db.select().from(accessSyncState).all();
    const sites = connection.sqlite.prepare('select count(*) as n from sites').get() as { n: number };
    expect(states).toHaveLength(sites.n);
    for (const state of states) expect(state.lastSyncedAt).not.toBeNull();
  });

  it('leaves pending changes and an error message behind on a failed push', () => {
    run(accessSyncJob, new Date(`${PINNED_TODAY}T02:15:00.000Z`));
    const failed = connection.db
      .select()
      .from(accessSyncState)
      .all()
      .filter((state) => state.lastError !== null);
    for (const state of failed) {
      expect(state.pendingChanges).toBeGreaterThan(0);
      // The last successful sync is preserved, so lag is still measurable.
      expect(state.lastSyncedAt).not.toBeNull();
    }
  });

  it('drops a member who is frozen across the whole window', () => {
    const at = new Date(`${PINNED_TODAY}T02:15:00.000Z`);
    const before = run(accessSyncJob, at);

    // Freeze one active member for the entire sync window and re-run: their
    // grant has to disappear from every site they were on.
    const victim = connection.sqlite
      .prepare(
        `select s.id, s.tenant_id as tenantId from subscriptions s
           join members m on m.id = s.member_id
          where s.status = 'active' and m.status = 'active' and m.card_id is not null
            and s.id not in (select subscription_id from freezes)
          limit 1`,
      )
      .get() as { id: string; tenantId: string };
    connection.sqlite
      .prepare(
        'insert into freezes (id, tenant_id, subscription_id, starts_on, ends_on, months, reason, created_at)' +
          " values ('frz_test', ?, ?, ?, date(?, '+30 day'), 1, 'travel', ?)",
      )
      .run(victim.tenantId, victim.id, PINNED_TODAY, PINNED_TODAY, `${PINNED_TODAY}T00:00:00.000Z`);

    const after = run(accessSyncJob, at);
    expect(after.summary.grantsPushed as number).toBeLessThan(before.summary.grantsPushed as number);
    expect(after.summary.membersExcluded as number).toBeGreaterThan(
      before.summary.membersExcluded as number,
    );
  });

  it('changes nothing on a dry run', () => {
    connection.sqlite.prepare('delete from access_sync_state').run();
    run(accessSyncJob, new Date(`${PINNED_TODAY}T02:15:00.000Z`), { dryRun: true });
    expect(connection.db.select().from(accessSyncState).all()).toHaveLength(0);
  });
});

describe('waitlist promotion', () => {
  /** Free one spot on an upcoming class that has somebody waiting. */
  function freeASpot(): { classId: string; waitingBookingId: string; memberId: string } {
    const waiting = connection.sqlite
      .prepare(
        `select b.id, b.class_id as classId, b.member_id as memberId
           from bookings b join classes c on c.id = b.class_id
          where b.status = 'waitlisted' and c.starts_at > ? and c.cancelled = 0
          order by c.starts_at limit 1`,
      )
      .get(`${PINNED_TODAY}T23:59:59.000Z`) as { id: string; classId: string; memberId: string };
    const booked = connection.sqlite
      .prepare("select id from bookings where class_id = ? and status = 'booked' limit 1")
      .get(waiting.classId) as { id: string };
    connection.db
      .update(bookings)
      .set({ status: 'cancelled', position: null, updatedAt: `${PINNED_TODAY}T10:00:00.000Z` })
      .where(eq(bookings.id, booked.id))
      .run();
    return { classId: waiting.classId, waitingBookingId: waiting.id, memberId: waiting.memberId };
  }

  it('promotes nobody when every class is full', () => {
    const result = run(waitlistPromoteJob, new Date(`${PINNED_TODAY}T12:00:00.000Z`));
    expect(result.summary.classesConsidered as number).toBeGreaterThan(0);
    expect(result.summary.promoted).toBe(0);
  });

  it('promotes the member at position one into a freed spot', () => {
    const { waitingBookingId } = freeASpot();
    const result = run(waitlistPromoteJob, new Date(`${PINNED_TODAY}T12:00:00.000Z`));
    expect(result.summary.promoted).toBe(1);
    const promoted = connection.sqlite
      .prepare('select status, position from bookings where id = ?')
      .get(waitingBookingId) as { status: string; position: number | null };
    expect(promoted.status).toBe('booked');
    expect(promoted.position).toBeNull();
  });

  it('notifies the promoted member', () => {
    freeASpot();
    run(waitlistPromoteJob, new Date(`${PINNED_TODAY}T12:00:00.000Z`));
    const queued = connection.sqlite
      .prepare("select count(*) as n from outbox where template = 'waitlist_promoted' and at >= ?")
      .get(`${PINNED_TODAY}T00:00:00.000Z`) as { n: number };
    expect(queued.n).toBeGreaterThan(0);
  });

  it('promotes a member who is holding a clashing fallback booking', () => {
    // Build the situation explicitly rather than hunting for it in the seed: a
    // member waitlisted on one class and booked onto an overlapping one.
    const klass = connection.sqlite
      .prepare(
        `select c.id, c.tenant_id as tenantId, c.site_id as siteId, c.starts_at as startsAt, c.ends_at as endsAt, c.capacity
           from classes c where c.starts_at > ? and c.cancelled = 0 order by c.starts_at limit 1`,
      )
      .get(`${PINNED_TODAY}T23:59:59.000Z`) as {
      id: string;
      tenantId: string;
      siteId: string;
      startsAt: string;
      endsAt: string;
      capacity: number;
    };

    // An overlapping class at the same site, and a member of that site.
    connection.db
      .insert(classes)
      .values({
        id: 'cls_overlap',
        tenantId: klass.tenantId,
        siteId: klass.siteId,
        name: 'Fallback',
        instructorId: null,
        startsAt: klass.startsAt,
        endsAt: klass.endsAt,
        capacity: 20,
        cancelled: false,
      })
      .run();

    const member = connection.sqlite
      .prepare("select id from members where tenant_id = ? and status = 'active' limit 1")
      .get(klass.tenantId) as { id: string };

    // Start from an empty class. Cancelling the existing bookings is not enough:
    // the row still occupies the unique (class, member) slot.
    connection.sqlite.prepare('delete from bookings where class_id = ?').run(klass.id);
    const filler = connection.sqlite
      .prepare("select id from members where tenant_id = ? and id != ? and status = 'active' limit ?")
      .all(klass.tenantId, member.id, klass.capacity) as { id: string }[];
    let seq = 0;
    for (const other of filler) {
      seq += 1;
      connection.db
        .insert(bookings)
        .values({
          id: `bkg_fill_${seq}`,
          tenantId: klass.tenantId,
          classId: klass.id,
          memberId: other.id,
          status: 'booked',
          position: null,
          createdAt: `${PINNED_TODAY}T08:00:00.000Z`,
          updatedAt: `${PINNED_TODAY}T08:00:00.000Z`,
        })
        .run();
    }
    connection.db
      .insert(bookings)
      .values([
        {
          id: 'bkg_waiting',
          tenantId: klass.tenantId,
          classId: klass.id,
          memberId: member.id,
          status: 'waitlisted',
          position: 1,
          createdAt: `${PINNED_TODAY}T08:05:00.000Z`,
          updatedAt: `${PINNED_TODAY}T08:05:00.000Z`,
        },
        {
          id: 'bkg_fallback',
          tenantId: klass.tenantId,
          classId: 'cls_overlap',
          memberId: member.id,
          status: 'booked',
          position: null,
          createdAt: `${PINNED_TODAY}T08:06:00.000Z`,
          updatedAt: `${PINNED_TODAY}T08:06:00.000Z`,
        },
      ])
      .run();

    // Free one spot on the target class.
    connection.db
      .update(bookings)
      .set({ status: 'cancelled' })
      .where(eq(bookings.id, 'bkg_fill_1'))
      .run();

    const result = runJob(waitlistPromoteJob, {
      now: new Date(`${PINNED_TODAY}T12:00:00.000Z`),
      tenantId: klass.tenantId,
      quiet: true,
      db: connection.db,
    });

    expect(result.summary.promoted).toBe(1);
    expect(result.summary.fallbacksReleased).toBe(1);

    const promoted = connection.sqlite
      .prepare('select status from bookings where id = ?')
      .get('bkg_waiting') as { status: string };
    const fallback = connection.sqlite
      .prepare('select status from bookings where id = ?')
      .get('bkg_fallback') as { status: string };
    expect(promoted.status).toBe('booked');
    expect(fallback.status).toBe('cancelled');
  });

  it('respects the tenant flag that turns auto-promotion off', () => {
    const { classId } = freeASpot();
    const tenant = connection.sqlite
      .prepare('select tenant_id as id from classes where id = ?')
      .get(classId) as { id: string };
    connection.sqlite
      .prepare(
        "insert into tenant_settings (tenant_id, key, value, updated_at) values (?, 'flag_waitlist_auto_promote', 'false', ?)" +
          ' on conflict(tenant_id, key) do update set value = excluded.value',
      )
      .run(tenant.id, `${PINNED_TODAY}T00:00:00.000Z`);

    const result = runJob(waitlistPromoteJob, {
      now: new Date(`${PINNED_TODAY}T12:00:00.000Z`),
      tenantId: tenant.id,
      quiet: true,
      db: connection.db,
    });
    expect(result.summary.promoted).toBe(0);
  });

  it('changes nothing on a dry run', () => {
    const { waitingBookingId } = freeASpot();
    run(waitlistPromoteJob, new Date(`${PINNED_TODAY}T12:00:00.000Z`), { dryRun: true });
    const still = connection.sqlite
      .prepare('select status from bookings where id = ?')
      .get(waitingBookingId) as { status: string };
    expect(still.status).toBe('waitlisted');
  });

  it('never leaves a class over capacity', () => {
    freeASpot();
    run(waitlistPromoteJob, new Date(`${PINNED_TODAY}T12:00:00.000Z`));
    const over = connection.sqlite
      .prepare(
        `select count(*) as n from (
           select c.id from classes c
             join bookings b on b.class_id = c.id and b.status in ('booked','attended','no_show')
            group by c.id, c.capacity having count(*) > c.capacity)`,
      )
      .get() as { n: number };
    expect(over.n).toBe(0);
  });

  it('renumbers the remaining waitlist from one', () => {
    freeASpot();
    run(waitlistPromoteJob, new Date(`${PINNED_TODAY}T12:00:00.000Z`));
    const broken = connection.sqlite
      .prepare(
        `select class_id from bookings where status = 'waitlisted'
          group by class_id having min(position) != 1 or max(position) != count(*)`,
      )
      .all();
    expect(broken).toEqual([]);
  });
});
