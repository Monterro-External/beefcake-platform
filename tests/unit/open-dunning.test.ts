/**
 * The open-dunning report: every `retrying` and `abandoned` charge of the
 * tenant, newest attempt first, one row per charge, with an optional search.
 *
 * Seam 1 of BCPLA-36. Front desk uses it to answer "is this person in open
 * dunning?", so a search has to cover all of open dunning, never just the rows
 * a card shows, and the counts have to agree with the rows.
 *
 * Expected values come from plain SQL against the seeded database, written
 * independently of the report's query.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type Connection } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import { seedDatabase } from '@/db/seed';
import { SCALES } from '@/db/seed/blueprint';
import { PINNED_TODAY } from '@/db/seed/options';
import { tenantScope } from '@/db/repositories/scope';
import * as reports from '@/export/reports';

let dir: string;
let connection: Connection;
let keyAccountId: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'beefcake-open-dunning-'));
  const path = join(dir, 'open-dunning.db');
  runMigrations(path);
  connection = openDatabase(path);
  seedDatabase(connection, { today: PINNED_TODAY, seed: 'export-test', scale: SCALES.tiny });
  keyAccountId = tenantId('Nordic Fitness Group');
});

afterAll(() => {
  connection.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

function tenantId(name: string): string {
  return (connection.sqlite.prepare('select id from tenants where name = ?').get(name) as { id: string }).id;
}

function scopeFor(id = keyAccountId) {
  return tenantScope(id, { db: connection.db });
}

interface OpenCharge {
  readonly chargeId: string;
  readonly memberId: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly cardId: string | null;
  readonly attemptedAt: string;
  readonly status: string;
}

/** All of a tenant's open dunning, newest attempt first, straight from SQL. */
function openCharges(id = keyAccountId): OpenCharge[] {
  return connection.sqlite
    .prepare(
      `select c.id as chargeId, c.member_id as memberId, m.name, m.email, m.phone, m.card_id as cardId,
              c.attempted_at as attemptedAt, c.status
         from charges c join members m on m.id = c.member_id
        where c.tenant_id = ? and c.status in ('retrying', 'abandoned')
        order by c.attempted_at desc, c.id desc`,
    )
    .all(id) as OpenCharge[];
}

/** No rows, and every count, chip counts included, at zero. */
const NOTHING_MATCHES = {
  rows: [],
  chargeCount: 0,
  memberCount: 0,
  statusCounts: { retrying: 0, abandoned: 0 },
  reasonCounts: { insufficient_funds: 0, mandate_cancelled: 0, account_closed: 0, technical: 0, rejected_by_bank: 0 },
};

function distinctMembers(rows: readonly { memberId: string }[]): number {
  return new Set(rows.map((row) => row.memberId)).size;
}

describe('the open-dunning report without a search', () => {
  it('returns the same rows as today for the card and the Payments caps, and counts all of open dunning', () => {
    const all = openCharges();
    expect(all.length).toBeGreaterThan(100);

    for (const limit of [8, 100]) {
      const result = reports.openDunning(scopeFor(), { limit });
      expect(result.rows).toEqual(reports.openDunning(scopeFor(), limit));
      expect(result.rows.map((row) => [row.memberId, row.attemptedAt])).toEqual(
        all.slice(0, limit).map((row) => [row.memberId, row.attemptedAt]),
      );
      expect(result.chargeCount).toBe(all.length);
      expect(result.memberCount).toBe(distinctMembers(all));
    }
  });

  it('treats a search of only spaces as no search', () => {
    const all = openCharges();
    const result = reports.openDunning(scopeFor(), { q: '   ', limit: 8 });
    expect(result.rows.map((row) => row.attemptedAt)).toEqual(all.slice(0, 8).map((row) => row.attemptedAt));
    expect(result.chargeCount).toBe(all.length);
  });
});

/** Part of a value in the middle, with its case flipped. */
function partOf(value: string): string {
  const middle = value.slice(1, Math.max(4, value.length - 2));
  const flipped = [...middle].map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).join('');
  return flipped;
}

describe('the open-dunning report with a search', () => {
  // The oldest charge in open dunning: beyond both the card's 8 and Payments' 100.
  const oldest = () => {
    const all = openCharges();
    const row = all.at(-1);
    if (row === undefined || all.length <= 100) throw new Error('need more than 100 charges in open dunning');
    return row;
  };

  it.each([
    ['name', (row: OpenCharge) => row.name],
    ['email', (row: OpenCharge) => row.email],
    ['phone', (row: OpenCharge) => row.phone],
  ] as const)('finds a member by part of their %s, ignoring case', (_key, valueOf) => {
    const target = oldest();
    const result = reports.openDunning(scopeFor(), { q: partOf(valueOf(target)), limit: 1000 });
    expect(result.rows.map((row) => row.memberId)).toContain(target.memberId);
    expect(result.rows.length).toBeLessThan(openCharges().length);
  });

  it('finds a member by part of their card number, ignoring case', () => {
    const target = [...openCharges()].reverse().find((row) => row.cardId !== null);
    if (target?.cardId == null) throw new Error('need a member in open dunning with a card');
    const result = reports.openDunning(scopeFor(), { q: `  ${target.cardId.toUpperCase().slice(2)} `, limit: 1000 });
    expect(new Set(result.rows.map((row) => row.memberId))).toEqual(new Set([target.memberId]));
  });

  it('finds a member whose name starts with a Nordic letter, by the lowercase and the uppercase form', () => {
    const target = openCharges().find((row) => /(^| )[ÅÄÖØÆ]/.test(row.name));
    const word = target?.name.split(' ').find((part) => /^[ÅÄÖØÆ]/.test(part));
    if (target === undefined || word === undefined) throw new Error('need a member in open dunning named with Å, Ä, Ö, Ø or Æ');
    const expected = openCharges().filter((row) => row.memberId === target.memberId);
    for (const q of [word.toLowerCase(), word.toUpperCase()]) {
      const result = reports.openDunning(scopeFor(), { q, limit: 1000 });
      expect(result.rows.map((row) => row.memberId), q).toContain(target.memberId);
      expect(result.rows.filter((row) => row.memberId === target.memberId).map((row) => row.chargeId), q).toEqual(
        expected.map((row) => row.chargeId),
      );
    }
  });

  it('finds charges older than the 8 and 100 newest, and returns every charge of the member it found', () => {
    const target = oldest();
    const expected = openCharges().filter((row) => row.memberId === target.memberId);
    const result = reports.openDunning(scopeFor(), { q: target.email, limit: 50 });
    expect(result.rows.map((row) => row.attemptedAt)).toEqual(expected.map((row) => row.attemptedAt));
    expect(result.chargeCount).toBe(expected.length);
    expect(result.memberCount).toBe(1);
  });

  it('counts every matching charge and the distinct members they belong to, beyond the rows returned', () => {
    // The most common plain-ASCII first name in open dunning, so several members share it.
    const firstNames = openCharges()
      .map((row) => (row.name.split(' ')[0] ?? '').toLowerCase())
      .filter((name) => /^[a-z]{3,}$/.test(name));
    const term = [...new Set(firstNames)].sort(
      (a, b) => firstNames.filter((n) => n === b).length - firstNames.filter((n) => n === a).length,
    )[0];
    if (term === undefined) throw new Error('need a first name in open dunning');
    const expected = openCharges().filter((row) =>
      [row.name, row.email, row.phone, row.cardId ?? ''].some((value) => value.toLowerCase().includes(term)),
    );
    expect(expected.length).toBeGreaterThan(distinctMembers(expected));
    const result = reports.openDunning(scopeFor(), { q: term, limit: 5 });
    expect(result.rows).toHaveLength(5);
    expect(result.chargeCount).toBe(expected.length);
    expect(result.memberCount).toBe(distinctMembers(expected));
  });

  it('returns no rows and zero counts when nobody in open dunning matches', () => {
    const result = reports.openDunning(scopeFor(), { q: 'zz-not-a-member' });
    expect(result).toEqual({ ...NOTHING_MATCHES, filter: { q: 'zz-not-a-member' } });
  });

  // Each term would match the oldest member's email if its character were a
  // wildcard; taken as itself it matches nobody.
  it.each([
    ['%', (email: string) => email.replace('@', '%')],
    ['_', (email: string) => email.replace('.', '_')],
    ['\\', () => '\\'],
  ] as const)('treats %s in a search as itself, not a wildcard', (_char, termOf) => {
    const term = termOf(oldest().email);
    const literal = openCharges().filter((row) =>
      [row.name, row.email, row.phone, row.cardId ?? ''].some((value) => value.toLowerCase().includes(term)),
    );
    expect(literal).toEqual([]);
    const result = reports.openDunning(scopeFor(), { q: term });
    expect(result).toEqual({ ...NOTHING_MATCHES, filter: { q: term } });
  });

  it("never returns or counts another tenant's charges", () => {
    const other = tenantId('Puls Träning');
    const target = oldest();
    const result = reports.openDunning(scopeFor(other), { q: target.email });
    expect(result).toEqual({ ...NOTHING_MATCHES, filter: { q: target.email } });
  });
});

interface FilterCharge extends OpenCharge {
  readonly failureCode: string | null;
  readonly siteId: string;
}

/** All of a tenant's open dunning with reason and home site, newest attempt first, straight from SQL. */
function openChargesWithFacets(id = keyAccountId): FilterCharge[] {
  return connection.sqlite
    .prepare(
      `select c.id as chargeId, c.member_id as memberId, m.name, m.email, m.phone, m.card_id as cardId,
              c.attempted_at as attemptedAt, c.status, c.failure_code as failureCode, m.home_site_id as siteId
         from charges c join members m on m.id = c.member_id
        where c.tenant_id = ? and c.status in ('retrying', 'abandoned')
        order by c.attempted_at desc, c.id desc`,
    )
    .all(id) as FilterCharge[];
}

describe('the open-dunning report with filters', () => {
  it.each(['retrying', 'abandoned'] as const)('keeps only %s charges when filtered by that status', (status) => {
    const expected = openChargesWithFacets().filter((row) => row.status === status);
    expect(expected.length).toBeGreaterThan(0);
    const result = reports.openDunning(scopeFor(), { status, limit: 1000 });
    expect(result.rows.map((row) => row.chargeId)).toEqual(expected.map((row) => row.chargeId));
    expect(result.chargeCount).toBe(expected.length);
    expect(result.memberCount).toBe(distinctMembers(expected));
  });

  it('keeps only charges that failed for the chosen reason', () => {
    const expected = openChargesWithFacets().filter((row) => row.failureCode === 'insufficient_funds');
    expect(expected.length).toBeGreaterThan(0);
    const result = reports.openDunning(scopeFor(), { reason: 'insufficient_funds', limit: 1000 });
    expect(result.rows.map((row) => row.chargeId)).toEqual(expected.map((row) => row.chargeId));
    expect(result.chargeCount).toBe(expected.length);
  });

  it('keeps only charges of members whose home site is the chosen site', () => {
    const all = openChargesWithFacets();
    const site = all.at(-1)?.siteId;
    if (site === undefined) throw new Error('need open dunning');
    const expected = all.filter((row) => row.siteId === site);
    expect(expected.length).toBeLessThan(all.length);
    const result = reports.openDunning(scopeFor(), { site, limit: 1000 });
    expect(result.rows.map((row) => row.chargeId)).toEqual(expected.map((row) => row.chargeId));
    expect(result.chargeCount).toBe(expected.length);
    expect(result.memberCount).toBe(distinctMembers(expected));
  });

  it('applies status, reason, site and search together', () => {
    const all = openChargesWithFacets();
    const target = all.find((row) => row.status === 'abandoned' && row.failureCode === 'mandate_cancelled');
    if (target === undefined) throw new Error('need an abandoned charge with a cancelled mandate');
    const q = target.name.split(' ')[0]?.toLowerCase() ?? '';
    const expected = all.filter(
      (row) =>
        row.status === 'abandoned' &&
        row.failureCode === 'mandate_cancelled' &&
        row.siteId === target.siteId &&
        [row.name, row.email, row.phone, row.cardId ?? ''].some((value) => value.toLowerCase().includes(q)),
    );
    const result = reports.openDunning(scopeFor(), {
      q,
      status: 'abandoned',
      reason: 'mandate_cancelled',
      site: target.siteId,
      limit: 1000,
    });
    expect(result.rows.map((row) => row.chargeId)).toEqual(expected.map((row) => row.chargeId));
    expect(result.chargeCount).toBe(expected.length);
    expect(result.memberCount).toBe(distinctMembers(expected));
  });
});

/** How many rows have each value, for every value listed. */
function tally<T extends string>(values: readonly (string | null)[], keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, values.filter((value) => value === key).length])) as Record<T, number>;
}

const STATUSES = ['retrying', 'abandoned'] as const;
const REASONS = ['insufficient_funds', 'mandate_cancelled', 'account_closed', 'technical', 'rejected_by_bank'] as const;

describe('the chip counts of the open-dunning report', () => {
  it('counts each status and each reason over all of open dunning when nothing is chosen', () => {
    const all = openChargesWithFacets();
    const result = reports.openDunning(scopeFor(), { limit: 8 });
    expect(result.statusCounts).toEqual(tally(all.map((row) => row.status), STATUSES));
    expect(result.reasonCounts).toEqual(tally(all.map((row) => row.failureCode), REASONS));
  });

  it('applies every other filter and the search to a chip count, but not its own dimension', () => {
    const all = openChargesWithFacets();
    const site = all.find((row) => row.status === 'abandoned' && row.failureCode === 'account_closed')?.siteId;
    if (site === undefined) throw new Error('need an abandoned charge with a closed account');
    const atSite = all.filter((row) => row.siteId === site);
    const result = reports.openDunning(scopeFor(), { status: 'abandoned', reason: 'account_closed', site });
    // Status chips: the site and the reason, any status.
    expect(result.statusCounts).toEqual(
      tally(atSite.filter((row) => row.failureCode === 'account_closed').map((row) => row.status), STATUSES),
    );
    // Reason chips: the site and the status, any reason.
    expect(result.reasonCounts).toEqual(
      tally(atSite.filter((row) => row.status === 'abandoned').map((row) => row.failureCode), REASONS),
    );
    expect(result.statusCounts.abandoned).toBe(result.chargeCount);
    expect(result.reasonCounts.account_closed).toBe(result.chargeCount);
  });

  it('applies the search to the chip counts', () => {
    const target = openChargesWithFacets().at(-1);
    if (target === undefined) throw new Error('need open dunning');
    const theirs = openChargesWithFacets().filter((row) => row.memberId === target.memberId);
    const result = reports.openDunning(scopeFor(), { q: target.email });
    expect(result.statusCounts).toEqual(tally(theirs.map((row) => row.status), STATUSES));
    expect(result.reasonCounts).toEqual(tally(theirs.map((row) => row.failureCode), REASONS));
  });

  it('counts 0 for a reason that ends retries when Retrying is chosen', () => {
    const result = reports.openDunning(scopeFor(), { status: 'retrying' });
    expect(result.chargeCount).toBeGreaterThan(0);
    expect(result.reasonCounts.account_closed).toBe(0);
    expect(result.reasonCounts.mandate_cancelled).toBe(0);
  });
});

describe('unknown filter values in the open-dunning report', () => {
  it('ignores a status, reason or site it does not know, and says which filter it applied', () => {
    const unfiltered = reports.openDunning(scopeFor(), { limit: 8 });
    for (const filter of [{ status: 'given_up' }, { reason: 'stolen_card' }, { site: 'sit_nowhere' }, { status: '' }]) {
      const result = reports.openDunning(scopeFor(), { ...filter, limit: 8 });
      expect(result).toEqual(unfiltered);
      expect(result.filter).toEqual({});
    }
  });

  it('keeps the filters it knows when another value is unknown', () => {
    const result = reports.openDunning(scopeFor(), { q: '  a ', status: 'abandoned', reason: 'stolen_card', limit: 8 });
    expect(result).toEqual(reports.openDunning(scopeFor(), { q: 'a', status: 'abandoned', limit: 8 }));
    expect(result.filter).toEqual({ q: 'a', status: 'abandoned' });
  });

  it("ignores another tenant's site, so its charges are neither listed nor counted", () => {
    const other = tenantId('Puls Träning');
    const nordicSite = openChargesWithFacets().at(0)?.siteId;
    if (nordicSite === undefined) throw new Error('need open dunning');
    const result = reports.openDunning(scopeFor(other), { site: nordicSite, limit: 1000 });
    const theirs = openChargesWithFacets(other);
    expect(result.filter).toEqual({});
    expect(result.rows.map((row) => row.chargeId)).toEqual(theirs.map((row) => row.chargeId));
    expect(result.chargeCount).toBe(theirs.length);
    expect(result.statusCounts).toEqual(tally(theirs.map((row) => row.status), STATUSES));
  });
});

describe('paging through the open-dunning report', () => {
  it('returns the next matching charges in order when skipping beyond the first page, with the same counts', () => {
    const expected = openChargesWithFacets().filter((row) => row.status === 'abandoned');
    expect(expected.length).toBeGreaterThan(50);
    const first = reports.openDunning(scopeFor(), { status: 'abandoned', limit: 50 });
    const second = reports.openDunning(scopeFor(), { status: 'abandoned', limit: 50, offset: 50 });
    expect(first.rows.map((row) => row.chargeId)).toEqual(expected.slice(0, 50).map((row) => row.chargeId));
    expect(second.rows.map((row) => row.chargeId)).toEqual(expected.slice(50, 100).map((row) => row.chargeId));
    expect(second.chargeCount).toBe(expected.length);
    expect(second.memberCount).toBe(first.memberCount);
  });

  it('returns no rows past the last match, but still counts every match', () => {
    const expected = openChargesWithFacets().filter((row) => row.status === 'abandoned');
    const result = reports.openDunning(scopeFor(), { status: 'abandoned', limit: 50, offset: expected.length });
    expect(result.rows).toEqual([]);
    expect(result.chargeCount).toBe(expected.length);
  });
});
