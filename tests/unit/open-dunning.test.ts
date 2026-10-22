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
    expect(result).toEqual({ rows: [], chargeCount: 0, memberCount: 0 });
  });

  it("never returns another tenant's charges", () => {
    const other = tenantId('Puls Träning');
    const target = oldest();
    const result = reports.openDunning(scopeFor(other), { q: target.email });
    expect(result).toEqual({ rows: [], chargeCount: 0, memberCount: 0 });
  });
});
