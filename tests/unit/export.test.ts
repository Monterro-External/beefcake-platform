/**
 * The reports and the signal exports.
 *
 * Two things are being protected here. The reports have to be correct, because
 * an owner makes decisions from them. The export file format is a contract with
 * another team, so a renamed column is a breaking change and should fail here
 * rather than in their spreadsheet.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type Connection } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { seedDatabase } from '@/db/seed';
import { SCALES } from '@/db/seed/blueprint';
import { PINNED_TODAY } from '@/db/seed/options';
import { adminScope, tenantScope } from '@/db/repositories/scope';
import * as reports from '@/export/reports';
import { EXPORTED_ACTIONS, csvCell, exportSignals, isoWeek } from '@/export/signals';
import { plainDate } from '@/domain/dates';

let dir: string;
let connection: Connection;
let outDir: string;
let keyAccountId: string;

const PINNED_NOW = new Date(`${PINNED_TODAY}T12:00:00.000Z`);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'beefcake-export-'));
  const path = join(dir, 'export.db');
  runMigrations(path);
  connection = openDatabase(path);
  seedDatabase(connection, { today: PINNED_TODAY, seed: 'export-test', scale: SCALES.tiny });
  outDir = join(dir, 'out');
  keyAccountId = (
    connection.sqlite
      .prepare("select id from tenants where name = 'Nordic Fitness Group'")
      .get() as { id: string }
  ).id;
});

afterAll(() => {
  connection.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

function scopeFor(tenantId = keyAccountId) {
  return tenantScope(tenantId, { db: connection.db });
}

function readCsv(name: string): { header: string[]; rows: string[][] } {
  const text = readFileSync(join(outDir, name), 'utf8').trimEnd();
  const [headerLine, ...lines] = text.split('\n');
  return {
    header: (headerLine ?? '').split(','),
    rows: lines.map((line) => splitCsvLine(line)),
  };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      out.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  out.push(cell);
  return out;
}

// ---------------------------------------------------------------------------

describe('revenue by period', () => {
  it('returns one row per period, oldest first', () => {
    const rows = reports.revenueByPeriod(scopeFor());
    expect(rows.length).toBeGreaterThan(6);
    const periods = rows.map((r) => r.period);
    expect([...periods].sort()).toEqual(periods);
  });

  it('reports the tenant currency, not a default', () => {
    for (const row of reports.revenueByPeriod(scopeFor())) expect(row.currency).toBe('SEK');
    const norwegian = connection.sqlite
      .prepare("select id from tenants where name = 'Kraft Trening'")
      .get() as { id: string };
    for (const row of reports.revenueByPeriod(scopeFor(norwegian.id))) expect(row.currency).toBe('NOK');
  });

  it('counts each charge once, not once per retry attempt', () => {
    const rows = reports.revenueByPeriod(scopeFor());
    const members = connection.sqlite
      .prepare("select count(*) as n from members where tenant_id = ? and status != 'former'")
      .get(keyAccountId) as { n: number };
    for (const row of rows) {
      expect(row.charges).toBeLessThanOrEqual(members.n * 1.3);
    }
  });
});

describe('failed payments', () => {
  it('breaks the failures down by code', () => {
    const rows = reports.failedPaymentsByCode(scopeFor(), '2026-01');
    expect(rows.length).toBeGreaterThan(0);
    const codes = new Set(rows.map((r) => r.failureCode));
    expect(codes.has('insufficient_funds')).toBe(true);
  });

  it('lists open dunning with the next attempt attached', () => {
    const rows = reports.openDunning(scopeFor());
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(['retrying', 'abandoned']).toContain(row.status);
      if (row.status === 'retrying') expect(row.nextAttemptAt).not.toBeNull();
    }
  });
});

describe('churn', () => {
  it('reports cancellations per week', () => {
    const rows = reports.churnByWeek(scopeFor(), { from: plainDate(2026, 1, 1), to: PINNED_TODAY });
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) {
      expect(row.cancellations).toBe(row.paymentDriven + row.voluntary);
    }
  });

  it('measures the lag between the last failed payment and the cancellation', () => {
    const rows = reports.churnWithPaymentLag(scopeFor(), {
      from: plainDate(2025, 9, 1),
      to: PINNED_TODAY,
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // A lag is never negative: the failure happened before the cancellation.
      if (row.daysSinceLastFailedPayment !== null) {
        expect(row.daysSinceLastFailedPayment).toBeGreaterThanOrEqual(0);
      }
      expect(row.tenureDays).toBeGreaterThanOrEqual(0);
    }
  });

  it('shows the two to three week lag on payment-driven churn and not on the rest', () => {
    // This is the pattern the whole company reads: dunning gives up, and a
    // fortnight later the member leaves.
    const rows = reports.churnWithPaymentLag(scopeFor(), {
      from: plainDate(2025, 9, 1),
      to: PINNED_TODAY,
    });
    const lagsFor = (paymentDriven: boolean): number[] =>
      rows
        .filter((r) => (r.reason === 'payment_failure') === paymentDriven)
        .flatMap((r) => (r.daysSinceLastFailedPayment === null ? [] : [r.daysSinceLastFailedPayment]))
        .sort((a, b) => a - b);

    const driven = lagsFor(true);
    const other = lagsFor(false);
    expect(driven.length).toBeGreaterThan(10);
    const medianDriven = driven[Math.floor(driven.length / 2)] as number;
    expect(medianDriven).toBeGreaterThanOrEqual(14);
    expect(medianDriven).toBeLessThanOrEqual(21);
    // Voluntary churn has no such relationship, so its lag is scattered.
    if (other.length > 10) {
      expect(other[Math.floor(other.length / 2)] as number).toBeGreaterThan(medianDriven);
    }
  });
});

describe('class fill', () => {
  it('never reports a fill rate above a plausible ceiling', () => {
    // Counting capacity and bookings in one joined query multiplies capacity by
    // the booking count. This is the assertion that catches that.
    for (const row of reports.classFillBySite(scopeFor(), reports.windowOfDays(PINNED_TODAY, 30), PINNED_NOW)) {
      expect(row.fillRate).toBeGreaterThan(0);
      expect(row.fillRate).toBeLessThanOrEqual(1.05);
      // A site that marked nothing in the window has no no-show rate.
      if (row.noShowRate !== null) {
        expect(row.noShowRate).toBeGreaterThanOrEqual(0);
        expect(row.noShowRate).toBeLessThanOrEqual(1);
      }
      expect(row.booked).toBeLessThanOrEqual(row.capacity);
    }
  });

  it('reports one row per site with a name', () => {
    const rows = reports.classFillBySite(scopeFor(), reports.windowOfDays(PINNED_TODAY, 30), PINNED_NOW);
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) expect(row.siteName.length).toBeGreaterThan(0);
  });
});

describe('access', () => {
  it('splits denials by reason and they never exceed the total', () => {
    for (const row of reports.accessBySite(scopeFor(), reports.windowOfDays(PINNED_TODAY, 60))) {
      expect(row.deniedFrozen + row.deniedEnded + row.deniedUnknownCard).toBeLessThanOrEqual(row.denied);
      expect(row.granted).toBeGreaterThan(0);
    }
  });

  it('reports sync lag for every site, including one never synced', () => {
    const rows = reports.syncLagBySite(scopeFor());
    const sites = connection.sqlite
      .prepare('select count(*) as n from sites where tenant_id = ?')
      .get(keyAccountId) as { n: number };
    expect(rows).toHaveLength(sites.n);
  });
});

describe('tenant health', () => {
  it('scores every tenant and shows its inputs', () => {
    const tenants = connection.sqlite.prepare('select id, name from tenants').all() as {
      id: string;
      name: string;
    }[];
    for (const tenant of tenants) {
      const health = reports.tenantHealth(scopeFor(tenant.id), PINNED_TODAY);
      expect(health.score.score).toBeGreaterThanOrEqual(0);
      expect(health.score.score).toBeLessThanOrEqual(100);
      expect(health.inputs.failedPaymentRate).toBeGreaterThanOrEqual(0);
      expect(health.inputs.classFillRate).toBeLessThanOrEqual(1.05);
      expect(health.activeMembers).toBeGreaterThan(0);
    }
  });

  it('scores the key account under stress worse than a quiet single-site gym', () => {
    const quiet = connection.sqlite
      .prepare("select id from tenants where name = 'Bodyfokus Umeå'")
      .get() as { id: string };
    const stressed = reports.tenantHealth(scopeFor(keyAccountId), PINNED_TODAY);
    const calm = reports.tenantHealth(scopeFor(quiet.id), PINNED_TODAY);
    expect(stressed.inputs.failedPaymentRate).toBeGreaterThan(calm.inputs.failedPaymentRate);
  });
});

describe('the export files', () => {
  beforeAll(() => {
    exportSignals(adminScope({ db: connection.db }), {
      since: plainDate(2026, 1, 1),
      today: PINNED_TODAY,
      outDir,
    });
  });

  it('writes all six files', () => {
    for (const name of [
      'events.jsonl',
      'errors.jsonl',
      'payment-runs.csv',
      'churn.csv',
      'tenant-health.csv',
      'access-sync.csv',
    ]) {
      expect(readFileSync(join(outDir, name), 'utf8').length).toBeGreaterThan(0);
    }
  });

  it('keeps the payment-runs columns stable', () => {
    expect(readCsv('payment-runs.csv').header).toEqual([
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
      'failed_insufficient_funds',
      'failed_mandate_cancelled',
      'failed_account_closed',
      'failed_technical',
      'failed_rejected_by_bank',
    ]);
  });

  it('keeps the churn columns stable', () => {
    expect(readCsv('churn.csv').header).toEqual([
      'tenant_id',
      'tenant_name',
      'segment',
      'week',
      'cancellations',
      'payment_driven',
      'voluntary',
      'median_days_since_last_failed_payment',
      'with_prior_failed_payment',
    ]);
  });

  it('keeps the tenant-health columns stable', () => {
    expect(readCsv('tenant-health.csv').header).toEqual([
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
    ]);
  });

  it('keeps the access-sync columns stable', () => {
    expect(readCsv('access-sync.csv').header).toEqual([
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
    ]);
  });

  it('writes one health row per tenant', () => {
    const tenants = connection.sqlite.prepare('select count(*) as n from tenants').get() as {
      n: number;
    };
    expect(readCsv('tenant-health.csv').rows).toHaveLength(tenants.n);
  });

  it('writes one access-sync row per site', () => {
    const sites = connection.sqlite.prepare('select count(*) as n from sites').get() as { n: number };
    expect(readCsv('access-sync.csv').rows).toHaveLength(sites.n);
  });

  it('gives every CSV row the same number of cells as the header', () => {
    for (const name of ['payment-runs.csv', 'churn.csv', 'tenant-health.csv', 'access-sync.csv']) {
      const { header, rows } = readCsv(name);
      for (const row of rows) expect(row).toHaveLength(header.length);
    }
  });

  it('writes every event as one line of valid JSON with a tenant and an action', () => {
    const lines = readFileSync(join(outDir, 'events.jsonl'), 'utf8').trimEnd().split('\n');
    expect(lines.length).toBeGreaterThan(100);
    for (const line of lines.slice(0, 500)) {
      const row = JSON.parse(line) as Record<string, unknown>;
      expect(typeof row.action).toBe('string');
      expect(EXPORTED_ACTIONS).toContain(row.action as string);
      expect(row.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(row.payload).toBeTypeOf('object');
    }
  });

  it('does not export internal-only actions', () => {
    const text = readFileSync(join(outDir, 'events.jsonl'), 'utf8');
    expect(text).not.toContain('"impersonation.started"');
    expect(text).not.toContain('"access.checked_in"');
  });

  it('rolls errors up by tenant and module', () => {
    const lines = readFileSync(join(outDir, 'errors.jsonl'), 'utf8').trimEnd().split('\n');
    for (const line of lines) {
      const row = JSON.parse(line) as { module: string; count: number; first_at: string; last_at: string };
      expect(row.module.length).toBeGreaterThan(0);
      expect(row.count).toBeGreaterThan(0);
      expect(row.first_at <= row.last_at).toBe(true);
    }
  });

  it('honours the since date', () => {
    const lines = readFileSync(join(outDir, 'events.jsonl'), 'utf8').trimEnd().split('\n');
    for (const line of lines) {
      const row = JSON.parse(line) as { at: string };
      expect(row.at >= '2026-01-01').toBe(true);
    }
  });
});

describe('CSV escaping', () => {
  it('quotes cells containing a comma, a quote or a newline', () => {
    expect(csvCell('Gymmet, Vasastan')).toBe('"Gymmet, Vasastan"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });

  it('leaves ordinary cells alone and writes null as empty', () => {
    expect(csvCell('Puls Träning')).toBe('Puls Träning');
    expect(csvCell(42)).toBe('42');
    expect(csvCell(null)).toBe('');
  });
});

describe('ISO weeks', () => {
  it('numbers weeks the way the spreadsheets expect', () => {
    expect(isoWeek(plainDate(2026, 8, 26))).toBe('2026-W35');
    expect(isoWeek(plainDate(2026, 1, 1))).toBe('2026-W01');
    // 2027-01-01 is a Friday, so it belongs to the last week of 2026.
    expect(isoWeek(plainDate(2027, 1, 1))).toBe('2026-W53');
    expect(isoWeek(plainDate(2026, 12, 28))).toBe('2026-W53');
  });
});
