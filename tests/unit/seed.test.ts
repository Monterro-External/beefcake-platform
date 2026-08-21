/**
 * The seed is a fixture that everything else is measured against, so it gets
 * tested like production code: the same inputs must produce the same database,
 * the story anchors must land where the reports expect them, and the invariants
 * that make the data believable must actually hold.
 *
 * These run at the `tiny` scale. The distributions are checked as ratios rather
 * than absolute counts so they hold at any scale.
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type Connection } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { seedDatabase } from '@/db/seed';
import { SCALES } from '@/db/seed/blueprint';
import { anchorsFor, PINNED_TODAY, type SeedOptions } from '@/db/seed/options';
import type { SeedSummary } from '@/db/seed/model';
import { plainDate } from '@/domain/dates';

interface Seeded {
  connection: Connection;
  summary: SeedSummary;
  dir: string;
}

function seedInto(options: SeedOptions): Seeded {
  const dir = mkdtempSync(join(tmpdir(), 'beefcake-seed-'));
  const path = join(dir, 'seed.db');
  runMigrations(path);
  const connection = openDatabase(path);
  const summary = seedDatabase(connection, options);
  return { connection, summary, dir };
}

function cleanup(seeded: Seeded): void {
  seeded.connection.sqlite.close();
  rmSync(seeded.dir, { recursive: true, force: true });
}

const TABLES = [
  'tenants',
  'tenant_settings',
  'sites',
  'users',
  'plans',
  'members',
  'subscriptions',
  'freezes',
  'classes',
  'bookings',
  'payment_runs',
  'charges',
  'receipts',
  'access_events',
  'access_sync_state',
  'events',
  'errors',
  'outbox',
] as const;

function digest(seeded: Seeded): string {
  const hash = createHash('sha256');
  for (const table of TABLES) {
    const rows = seeded.connection.sqlite.prepare(`select * from ${table} order by rowid`).all();
    hash.update(table);
    hash.update(JSON.stringify(rows));
  }
  return hash.digest('hex');
}

const tinyOptions: SeedOptions = { today: PINNED_TODAY, seed: 'test-seed', scale: SCALES.tiny };

let seeded: Seeded;
let sql: <T = Record<string, unknown>>(query: string, ...params: unknown[]) => T[];
let row: <T = Record<string, unknown>>(query: string, ...params: unknown[]) => T;

beforeAll(() => {
  seeded = seedInto(tinyOptions);
  sql = (query, ...params) => seeded.connection.sqlite.prepare(query).all(...params) as never;
  row = (query, ...params) => seeded.connection.sqlite.prepare(query).get(...params) as never;
});

afterAll(() => {
  cleanup(seeded);
});

describe('determinism', () => {
  it('produces an identical database for the same seed and date', () => {
    const again = seedInto(tinyOptions);
    try {
      expect(digest(again)).toBe(digest(seeded));
    } finally {
      cleanup(again);
    }
  });

  it('produces a different database for a different seed', () => {
    const other = seedInto({ ...tinyOptions, seed: 'another-seed' });
    try {
      expect(digest(other)).not.toBe(digest(seeded));
    } finally {
      cleanup(other);
    }
  });

  it('records how it was built', () => {
    const meta = row<{ today: string; seed: string; scale: string }>('select * from seed_meta');
    expect(meta).toMatchObject({ today: PINNED_TODAY, seed: 'test-seed', scale: 'tiny' });
  });
});

describe('the story anchors', () => {
  it('has the last payment run completed and the next one still due', () => {
    const anchors = anchorsFor(tinyOptions);
    expect(anchors.lastCompletedRun.runOn <= PINNED_TODAY).toBe(true);
    expect(anchors.nextRun.runOn > PINNED_TODAY).toBe(true);
    expect(seeded.summary.lastCompletedRun).toBe(anchors.lastCompletedRun.period);

    const latest = row<{ period: string; status: string }>(
      'select period, status from payment_runs order by period desc limit 1',
    );
    expect(latest.period).toBe(anchors.lastCompletedRun.period);
    expect(latest.status).toBe('completed');
    expect(
      row<{ n: number }>('select count(*) n from payment_runs where period = ?', anchors.nextRun.period).n,
    ).toBe(0);
  });

  it('leaves some charges mid-retry, with the next attempt in the future', () => {
    const retrying = sql<{ nextAttemptAt: string }>(
      "select next_attempt_at as nextAttemptAt from charges where status = 'retrying'",
    );
    expect(retrying.length).toBeGreaterThan(0);
    for (const charge of retrying) {
      expect(charge.nextAttemptAt > `${PINNED_TODAY}T00:00:00.000Z`).toBe(true);
    }
  });

  it('has classes on the schedule for the coming fortnight', () => {
    const upcoming = row<{ n: number }>(
      'select count(*) n from classes where starts_at > ?',
      `${PINNED_TODAY}T23:59:59.000Z`,
    );
    expect(upcoming.n).toBeGreaterThan(0);
  });

  it('has no class or check-in dated after today', () => {
    const horizon = anchorsFor(tinyOptions).classesTo;
    expect(
      row<{ n: number }>('select count(*) n from classes where starts_at > ?', `${horizon}T23:59:59.999Z`).n,
    ).toBe(0);
    expect(
      row<{ n: number }>('select count(*) n from access_events where local_day > ?', PINNED_TODAY).n,
    ).toBe(0);
  });

  it('shifts the whole story when today moves, without changing its shape', () => {
    const shifted = seedInto({ ...tinyOptions, today: plainDate(2027, 3, 14) });
    try {
      expect(shifted.summary.lastCompletedRun).toBe('2027-02');
      expect(shifted.summary.nextRunDue).toBe('2027-03-25');
      // Same tenants, same sites, same plans: only the dates moved.
      expect(shifted.summary.counts.tenants).toBe(seeded.summary.counts.tenants);
      expect(shifted.summary.counts.sites).toBe(seeded.summary.counts.sites);
      expect(shifted.summary.counts.plans).toBe(seeded.summary.counts.plans);
      const latest = shifted.connection.sqlite
        .prepare('select max(local_day) as day from access_events')
        .get() as { day: string };
      expect(latest.day).toBe('2027-03-14');
    } finally {
      cleanup(shifted);
    }
  });
});

describe('the twelve tenants', () => {
  it('are the ones the company brief describes', () => {
    const tenants = sql<{ name: string; segment: string; sites: number }>(
      'select t.name, t.segment, (select count(*) from sites s where s.tenant_id = t.id) sites from tenants t order by t.name',
    );
    expect(tenants).toHaveLength(12);
    expect(tenants.filter((t) => t.segment === 'long_tail')).toHaveLength(6);
    expect(tenants.filter((t) => t.segment === 'mid')).toHaveLength(4);
    expect(tenants.filter((t) => t.segment === 'key_account')).toHaveLength(2);

    const byName = new Map(tenants.map((t) => [t.name, t]));
    expect(byName.get('Nordic Fitness Group')?.sites).toBe(15);
    expect(byName.get('Kraft Trening')?.sites).toBe(8);
  });

  it('covers all four markets and all four currencies', () => {
    expect(
      sql<{ country: string }>('select distinct country from tenants order by country').map((r) => r.country),
    ).toEqual(['DK', 'FI', 'NO', 'SE']);
    expect(
      sql<{ currency: string }>('select distinct currency from tenants order by currency').map(
        (r) => r.currency,
      ),
    ).toEqual(['DKK', 'EUR', 'NOK', 'SEK']);
  });

  it('uses both access hardware vendors', () => {
    const providers = sql<{ accessProvider: string; n: number }>(
      'select access_provider as accessProvider, count(*) n from sites group by access_provider',
    );
    expect(providers).toHaveLength(2);
    for (const provider of providers) expect(provider.n).toBeGreaterThan(3);
  });

  it('leaves the retry policy at its default for all but one tenant', () => {
    // Most operators never choose a retry policy, so the seed has to leave most
    // of them on whatever the platform default is.
    const explicit = sql("select tenant_id from tenant_settings where key = 'retry_attempts'");
    expect(explicit.length).toBe(1);
    const tenants = row<{ n: number }>('select count(*) n from tenants');
    expect(explicit.length).toBeLessThan(tenants.n);
  });
});

describe('every row belongs to exactly one tenant', () => {
  const scoped: readonly [string, string][] = [
    ['members', 'home_site_id'],
    ['subscriptions', 'member_id'],
    ['charges', 'member_id'],
    ['bookings', 'member_id'],
    ['access_events', 'site_id'],
  ];

  it.each(scoped)('%s never points at another tenant', (table, column) => {
    const parent = column === 'home_site_id' || column === 'site_id' ? 'sites' : column === 'member_id' ? 'members' : 'sites';
    const mismatched = row<{ n: number }>(
      `select count(*) n from ${table} x join ${parent} p on p.id = x.${column} where p.tenant_id != x.tenant_id`,
    );
    expect(mismatched.n).toBe(0);
  });

  it('never puts a member at a site belonging to someone else', () => {
    expect(
      row<{ n: number }>(
        'select count(*) n from members m join sites s on s.id = m.home_site_id where s.tenant_id != m.tenant_id',
      ).n,
    ).toBe(0);
  });

  it('gives every card at most one holder', () => {
    expect(
      row<{ n: number }>(
        'select count(*) n from (select card_id from members where card_id is not null group by card_id having count(*) > 1)',
      ).n,
    ).toBe(0);
  });

  it('leaves no dangling references', () => {
    expect(sql('pragma foreign_key_check')).toEqual([]);
  });
});

describe('subscription history holds together', () => {
  it('never charges before the subscription started', () => {
    expect(
      row<{ n: number }>(
        `select count(*) n from charges c
           join subscriptions s on s.id = c.subscription_id
          where substr(c.attempted_at, 1, 10) < s.started_on`,
      ).n,
    ).toBe(0);
  });

  it('never ends a subscription before it started', () => {
    expect(
      row<{ n: number }>('select count(*) n from subscriptions where ends_on is not null and ends_on < started_on')
        .n,
    ).toBe(0);
  });

  it('always sets notice and end dates together with a cancellation date', () => {
    expect(
      row<{ n: number }>(
        'select count(*) n from subscriptions where cancelled_on is not null and (ends_on is null or notice_ends_on is null)',
      ).n,
    ).toBe(0);
  });

  it('never ends a subscription before the notice period runs out', () => {
    expect(
      row<{ n: number }>(
        'select count(*) n from subscriptions where notice_ends_on is not null and ends_on < notice_ends_on',
      ).n,
    ).toBe(0);
  });

  it('keeps freezes inside the subscription and non-overlapping', () => {
    expect(
      row<{ n: number }>(
        'select count(*) n from freezes f join subscriptions s on s.id = f.subscription_id where f.starts_on < s.started_on',
      ).n,
    ).toBe(0);
    expect(
      row<{ n: number }>(
        `select count(*) n from freezes a
           join freezes b on b.subscription_id = a.subscription_id and b.id != a.id
          where a.starts_on <= b.ends_on and b.starts_on <= a.ends_on`,
      ).n,
    ).toBe(0);
    expect(row<{ n: number }>('select count(*) n from freezes where ends_on < starts_on').n).toBe(0);
  });

});

describe('money is always paired with a currency', () => {
  it('charges are in the tenant currency', () => {
    expect(
      row<{ n: number }>(
        'select count(*) n from charges c join tenants t on t.id = c.tenant_id where c.currency != t.currency',
      ).n,
    ).toBe(0);
  });

  it('receipts are in the tenant currency', () => {
    expect(
      row<{ n: number }>(
        'select count(*) n from receipts r join tenants t on t.id = r.tenant_id where r.currency != t.currency',
      ).n,
    ).toBe(0);
  });

  it('never stores a zero or negative charge', () => {
    expect(row<{ n: number }>('select count(*) n from charges where amount_minor <= 0').n).toBe(0);
  });

  it('never charges more than the two most expensive plans together', () => {
    // A period containing a plan change bills both plans for their own stretch,
    // so the ceiling is the two dearest plans rather than the single dearest.
    expect(
      row<{ n: number }>(
        `select count(*) n from charges c
          where c.amount_minor > (
            select coalesce(sum(price_minor), 0) from (
              select price_minor from plans p where p.tenant_id = c.tenant_id
               order by price_minor desc limit 2))`,
      ).n,
    ).toBe(0);
  });
});

describe('payment runs and retries', () => {
  it('run once per tenant per period', () => {
    expect(
      row<{ n: number }>(
        'select count(*) n from (select tenant_id, period from payment_runs group by tenant_id, period having count(*) > 1)',
      ).n,
    ).toBe(0);
  });

  it('fail somewhere in the low single digits on the first attempt', () => {
    const stats = row<{ attempted: number; failed: number }>(
      "select count(*) attempted, sum(case when status != 'succeeded' then 1 else 0 end) failed from charges where attempt = 1",
    );
    const rate = stats.failed / stats.attempted;
    expect(rate).toBeGreaterThan(0.02);
    expect(rate).toBeLessThan(0.1);
  });

  it('never schedules another attempt after a terminal failure', () => {
    // A mandate can be cancelled between attempt one and attempt two, so a
    // terminal code on a later attempt is legitimate. What must never happen is
    // another attempt *after* one, or a terminal code left in a retryable state.
    expect(
      row<{ n: number }>(
        "select count(*) n from charges where failure_code in ('mandate_cancelled','account_closed') and status != 'abandoned'",
      ).n,
    ).toBe(0);
    expect(
      row<{ n: number }>(
        `select count(*) n from charges later
           join charges terminal
             on terminal.member_id = later.member_id
            and terminal.payment_run_id = later.payment_run_id
            and terminal.attempt < later.attempt
          where terminal.failure_code in ('mandate_cancelled','account_closed')`,
      ).n,
    ).toBe(0);
  });

  it('never exceeds a cap the tenant has actually set', () => {
    expect(
      row<{ n: number }>(
        `select count(*) n from charges c
           join tenant_settings s on s.tenant_id = c.tenant_id and s.key = 'retry_attempts'
          where c.attempt > cast(s.value as integer)`,
      ).n,
    ).toBe(0);
  });

  it('lets a retry succeed most of the time, so dunning is not a formality', () => {
    const retried = row<{ total: number; succeeded: number }>(
      "select count(*) total, sum(case when status = 'succeeded' then 1 else 0 end) succeeded from charges where attempt = 2",
    );
    expect(retried.total).toBeGreaterThan(0);
    expect(retried.succeeded / retried.total).toBeGreaterThan(0.4);
  });

  it('only leaves a next attempt date on charges that are still going', () => {
    expect(
      row<{ n: number }>(
        "select count(*) n from charges where status in ('succeeded','abandoned') and next_attempt_at is not null",
      ).n,
    ).toBe(0);
  });

  it('issues one receipt per successful charge in the retained window', () => {
    expect(
      row<{ n: number }>(
        "select count(*) n from receipts r join charges c on c.id = r.charge_id where c.status != 'succeeded'",
      ).n,
    ).toBe(0);
    expect(
      row<{ n: number }>('select count(*) n from (select charge_id from receipts group by charge_id having count(*) > 1)')
        .n,
    ).toBe(0);
  });
});

describe('churn follows failed payments', () => {
  it('attributes a meaningful share of cancellations to payment failure', () => {
    const stats = row<{ total: number; payment: number }>(
      "select count(*) total, sum(case when cancel_reason = 'payment_failure' then 1 else 0 end) payment from subscriptions where cancelled_on is not null",
    );
    const share = stats.payment / stats.total;
    expect(share).toBeGreaterThan(0.12);
    expect(share).toBeLessThan(0.45);
  });

  it('dates those cancellations two to three weeks after a run, not on run day', () => {
    // The run goes out on the 25th, so a cancellation driven by exhausted
    // dunning lands in the first three weeks of the following month.
    const byDay = sql<{ dom: number; n: number }>(
      "select cast(substr(cancelled_on, 9, 2) as integer) dom, count(*) n from subscriptions where cancel_reason = 'payment_failure' group by dom",
    );
    const inWindow = byDay.filter((r) => r.dom >= 8 && r.dom <= 22).reduce((a, r) => a + r.n, 0);
    const total = byDay.reduce((a, r) => a + r.n, 0);
    expect(total).toBeGreaterThan(0);
    expect(inWindow / total).toBeGreaterThan(0.7);
  });

  it('records every cancellation in the event stream', () => {
    const cancelled = row<{ n: number }>(
      'select count(*) n from subscriptions where cancelled_on is not null',
    );
    const events = row<{ n: number }>(
      "select count(*) n from events where action = 'subscription.cancelled'",
    );
    expect(events.n).toBe(cancelled.n);
  });
});

describe('classes, bookings and waitlists', () => {
  it('never books the same member onto the same class twice', () => {
    expect(
      row<{ n: number }>(
        'select count(*) n from (select class_id, member_id from bookings group by class_id, member_id having count(*) > 1)',
      ).n,
    ).toBe(0);
  });

  it('never books a member before they joined', () => {
    expect(
      row<{ n: number }>(
        `select count(*) n from bookings b
           join members m on m.id = b.member_id
           join classes c on c.id = b.class_id
          where substr(c.starts_at, 1, 10) < m.joined_on`,
      ).n,
    ).toBe(0);
  });

  it('never fills a class past capacity', () => {
    expect(
      row<{ n: number }>(
        `select count(*) n from (
           select c.id
             from classes c
             join bookings b on b.class_id = c.id and b.status in ('booked','attended','no_show')
            group by c.id, c.capacity
           having count(*) > c.capacity)`,
      ).n,
    ).toBe(0);
  });

  it('numbers each waitlist from one with no gaps', () => {
    const broken = sql(
      `select class_id from bookings
        where status = 'waitlisted'
        group by class_id
       having min(position) != 1 or max(position) != count(*)`,
    );
    expect(broken).toEqual([]);
  });

  it('has waitlists on the popular slots', () => {
    const waitlisted = row<{ n: number }>("select count(*) n from bookings where status = 'waitlisted'");
    const booked = row<{ n: number }>("select count(*) n from bookings where status != 'cancelled'");
    expect(waitlisted.n).toBeGreaterThan(0);
    expect(waitlisted.n / booked.n).toBeLessThan(0.2);
  });

  it('has waitlisted members holding a clashing fallback booking', () => {
    // This is the shape the promotion job has to handle: promoting someone off
    // one waitlist has to release the overlapping booking they already hold.
    const clashes = row<{ n: number }>(
      `select count(*) n
         from bookings w
         join classes wc on wc.id = w.class_id
         join bookings f on f.member_id = w.member_id and f.id != w.id
         join classes fc on fc.id = f.class_id
        where w.status = 'waitlisted'
          and f.status in ('booked','attended','no_show')
          and fc.site_id = wc.site_id
          and wc.starts_at < fc.ends_at
          and fc.starts_at < wc.ends_at`,
    );
    expect(clashes.n).toBeGreaterThan(0);
  });

  it('marks past classes attended or missed, and future ones only booked', () => {
    expect(
      row<{ n: number }>(
        `select count(*) n from bookings b join classes c on c.id = b.class_id
          where c.starts_at > ? and b.status in ('attended','no_show')`,
        `${PINNED_TODAY}T23:59:59.999Z`,
      ).n,
    ).toBe(0);
  });
});

describe('access events', () => {
  it('files every event under the site-local day', () => {
    // The adapter decides this, so a mismatch means an adapter regression.
    const offBy = row<{ n: number }>(
      'select count(*) n from access_events where local_day != substr(at, 1, 10) and abs(julianday(local_day) - julianday(substr(at, 1, 10))) > 1',
    );
    expect(offBy.n).toBe(0);
  });

  it('grants the overwhelming majority and denies a believable minority', () => {
    const stats = row<{ total: number; denied: number }>(
      "select count(*) total, sum(case when result = 'denied' then 1 else 0 end) denied from access_events",
    );
    const rate = stats.denied / stats.total;
    expect(rate).toBeGreaterThan(0.005);
    expect(rate).toBeLessThan(0.1);
  });

  it('denies for reasons that correlate with subscription state', () => {
    const reasons = new Set(
      sql<{ reason: string }>("select distinct reason from access_events where result = 'denied'").map(
        (r) => r.reason,
      ),
    );
    expect(reasons.has('frozen')).toBe(true);
    expect(reasons.has('subscription_ended')).toBe(true);
  });

  it('never denies with a reason the domain does not define', () => {
    const known = new Set([
      'active',
      'freeze_grace',
      'frozen',
      'subscription_ended',
      'not_started',
      'no_subscription',
      'unknown_card',
      'member_blocked',
      'site_not_included',
    ]);
    for (const reason of sql<{ reason: string }>('select distinct reason from access_events')) {
      expect(known.has(reason.reason)).toBe(true);
    }
  });

  it('has late-evening check-ins at the older hardware estate', () => {
    // Sites on the second vendor stay open later, which is where any
    // late-night timezone handling gets exercised.
    const late = row<{ n: number }>(
      `select count(*) n from access_events
        where provider = 'access-provider-b'
          and cast(strftime('%H', at) as integer) >= 19`,
    );
    expect(late.n).toBeGreaterThan(0);
  });

  it('has a sync state row for every site', () => {
    const sites = row<{ n: number }>('select count(*) n from sites');
    const state = row<{ n: number }>('select count(*) n from access_sync_state');
    expect(state.n).toBe(sites.n);
  });
});

describe('signals', () => {
  it('records an event for every failed charge', () => {
    const failed = row<{ n: number }>(
      "select count(*) n from charges where status in ('failed','abandoned','retrying')",
    );
    const events = row<{ n: number }>("select count(*) n from events where action = 'charge.failed'");
    expect(events.n).toBe(failed.n);
  });

  it('records a start and a completion for every payment run', () => {
    const runs = row<{ n: number }>('select count(*) n from payment_runs');
    for (const action of ['payment_run.started', 'payment_run.completed']) {
      expect(row<{ n: number }>('select count(*) n from events where action = ?', action).n).toBe(runs.n);
    }
  });

  it('has feature-adoption signal in the event stream', () => {
    expect(
      row<{ n: number }>("select count(*) n from events where action = 'member_app.session'").n,
    ).toBeGreaterThan(0);
    expect(
      row<{ n: number }>("select count(*) n from events where action = 'report.exported'").n,
    ).toBeGreaterThan(0);
  });

  it('attributes every error to a module and mostly to a tenant', () => {
    expect(row<{ n: number }>('select count(*) n from errors where "where" = \'\'').n).toBe(0);
    const errors = row<{ total: number; attributed: number }>(
      'select count(*) total, sum(case when tenant_id is not null then 1 else 0 end) attributed from errors',
    );
    expect(errors.total).toBeGreaterThan(0);
    expect(errors.attributed / errors.total).toBeGreaterThan(0.9);
  });

  it('queues a notification for every recent payment failure', () => {
    const recentFailures = row<{ n: number }>(
      `select count(*) n from charges
        where status in ('failed','abandoned','retrying')
          and attempted_at >= date(?, '-60 day')`,
      PINNED_TODAY,
    );
    const queued = row<{ n: number }>(
      "select count(*) n from outbox where template in ('payment_failed','payment_abandoned')",
    );
    expect(queued.n).toBe(recentFailures.n);
  });

  it('writes every outbox payload as valid JSON', () => {
    expect(row<{ n: number }>('select count(*) n from outbox where json_valid(payload_json) = 0').n).toBe(0);
    expect(row<{ n: number }>('select count(*) n from events where json_valid(payload_json) = 0').n).toBe(0);
  });
});
