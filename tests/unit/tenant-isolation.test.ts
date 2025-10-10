/**
 * Tenant isolation is the one property of this system that has to hold
 * unconditionally, so it gets its own test file rather than being implied by
 * the feature tests.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { members, plans, sites, subscriptions, tenants } from '@/db/schema';
import {
  TenantIsolationError,
  adminScope,
  guard,
  impersonate,
  tenantScope,
} from '@/db/repositories/scope';
import * as membersRepo from '@/db/repositories/members';
import * as subscriptionsRepo from '@/db/repositories/subscriptions';
import * as tenantsRepo from '@/db/repositories/tenants';
import { createTestDb, type TestDb } from '../helpers/test-db';

let testDb: TestDb;

const NOW = '2026-08-26T08:00:00.000Z';

beforeAll(() => {
  testDb = createTestDb();
  const db = testDb.db;

  db.insert(tenants)
    .values([
      {
        id: 'ten_a',
        name: 'Alfa Gym',
        orgNumber: '556000-0001',
        country: 'SE',
        currency: 'SEK',
        locale: 'sv-SE',
        segment: 'long_tail',
        planTier: 'starter',
        status: 'active',
        createdAt: NOW,
      },
      {
        id: 'ten_b',
        name: 'Beta Trening',
        orgNumber: '996000-0002',
        country: 'NO',
        currency: 'NOK',
        locale: 'nb-NO',
        segment: 'mid',
        planTier: 'growth',
        status: 'active',
        createdAt: NOW,
      },
    ])
    .run();

  db.insert(sites)
    .values([
      {
        id: 'sit_a',
        tenantId: 'ten_a',
        name: 'Alfa Centrum',
        timezone: 'Europe/Stockholm',
        addressLine: 'Kungsgatan 1',
        city: 'Stockholm',
        accessProvider: 'access-provider-a',
        openedOn: '2020-01-01',
      },
      {
        id: 'sit_b',
        tenantId: 'ten_b',
        name: 'Beta Sentrum',
        timezone: 'Europe/Oslo',
        addressLine: 'Karl Johans gate 1',
        city: 'Oslo',
        accessProvider: 'access-provider-b',
        openedOn: '2021-01-01',
      },
    ])
    .run();

  db.insert(plans)
    .values([
      {
        id: 'pln_a',
        tenantId: 'ten_a',
        name: 'Bas',
        priceMinor: 39900,
        currency: 'SEK',
        interval: 'month',
        bindingMonths: 0,
        sitesScope: 'home_site',
        active: true,
        createdAt: NOW,
      },
      {
        id: 'pln_b',
        tenantId: 'ten_b',
        name: 'Standard',
        priceMinor: 44900,
        currency: 'NOK',
        interval: 'month',
        bindingMonths: 12,
        sitesScope: 'all_sites',
        active: true,
        createdAt: NOW,
      },
    ])
    .run();

  db.insert(members)
    .values([
      {
        id: 'mem_a1',
        tenantId: 'ten_a',
        homeSiteId: 'sit_a',
        name: 'Anna Andersson',
        email: 'anna@example.se',
        phone: '+46701000001',
        status: 'active',
        cardId: 'card_a1',
        birthYear: 1988,
        joinedOn: '2024-03-01',
        createdAt: NOW,
      },
      {
        id: 'mem_b1',
        tenantId: 'ten_b',
        homeSiteId: 'sit_b',
        name: 'Bjørn Berg',
        email: 'bjorn@example.no',
        phone: '+4790000001',
        status: 'active',
        cardId: 'card_b1',
        birthYear: 1990,
        joinedOn: '2024-05-01',
        createdAt: NOW,
      },
    ])
    .run();

  db.insert(subscriptions)
    .values([
      {
        id: 'sub_a1',
        tenantId: 'ten_a',
        memberId: 'mem_a1',
        planId: 'pln_a',
        status: 'active',
        startedOn: '2024-03-01',
        createdAt: NOW,
      },
      {
        id: 'sub_b1',
        tenantId: 'ten_b',
        memberId: 'mem_b1',
        planId: 'pln_b',
        status: 'active',
        startedOn: '2024-05-01',
        createdAt: NOW,
      },
    ])
    .run();
});

afterAll(() => {
  testDb.cleanup();
});

function scopeA() {
  return tenantScope('ten_a', { db: testDb.db });
}

function scopeB() {
  return tenantScope('ten_b', { db: testDb.db });
}

describe('reads are scoped', () => {
  it('lists only its own members', () => {
    expect(membersRepo.listMembers(scopeA()).map((m) => m.id)).toEqual(['mem_a1']);
    expect(membersRepo.listMembers(scopeB()).map((m) => m.id)).toEqual(['mem_b1']);
  });

  it('counts only its own members', () => {
    expect(membersRepo.countMembers(scopeA())).toBe(1);
  });

  it('returns null rather than another tenant’s member', () => {
    expect(membersRepo.getMember(scopeA(), 'mem_b1')).toBeNull();
    expect(membersRepo.getMember(scopeA(), 'mem_a1')?.name).toBe('Anna Andersson');
  });

  it('does not resolve another tenant’s card, even though card ids are globally unique', () => {
    expect(membersRepo.findByCard(scopeA(), 'card_b1')).toBeNull();
    expect(membersRepo.findByCard(scopeB(), 'card_b1')?.id).toBe('mem_b1');
  });

  it('lists only its own sites and plans', () => {
    expect(tenantsRepo.listSites(scopeA()).map((s) => s.id)).toEqual(['sit_a']);
    expect(subscriptionsRepo.listPlans(scopeB()).map((p) => p.id)).toEqual(['pln_b']);
  });

  it('does not resolve another tenant’s plan or subscription', () => {
    expect(subscriptionsRepo.getPlan(scopeA(), 'pln_b')).toBeNull();
    expect(subscriptionsRepo.getSubscription(scopeA(), 'sub_b1')).toBeNull();
  });

  it('does not join through to another tenant when given a foreign member id', () => {
    expect(subscriptionsRepo.currentSubscription(scopeA(), 'mem_b1')).toBeNull();
    expect(subscriptionsRepo.listSubscriptionsForMembers(scopeA(), ['mem_b1']).size).toBe(0);
  });

  it('joins site names without leaking sites from elsewhere', () => {
    const rows = membersRepo.listMembersWithSite(scopeA());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.siteName).toBe('Alfa Centrum');
  });
});

describe('writes are scoped', () => {
  it('a status update aimed at another tenant’s member does nothing', () => {
    membersRepo.updateMemberStatus(scopeA(), 'mem_b1', 'blocked');
    expect(membersRepo.getMember(scopeB(), 'mem_b1')?.status).toBe('active');
  });

  it('settings are written and read per tenant', () => {
    tenantsRepo.setSetting(scopeA(), 'retry_attempts', '5', NOW);
    expect(tenantsRepo.getSettings(scopeA()).retryAttempts).toBe(5);
    expect(tenantsRepo.getSettings(scopeB()).retryAttempts).toBe(3);
    tenantsRepo.clearSetting(scopeA(), 'retry_attempts');
    expect(tenantsRepo.getSettings(scopeA()).retryAttempts).toBe(3);
  });
});

describe('the guard is a real backstop', () => {
  it('throws when a row from another tenant reaches it', () => {
    expect(() =>
      guard(scopeA(), 'members', [{ tenantId: 'ten_b' }]),
    ).toThrow(TenantIsolationError);
  });

  it('names the tenant and the table it caught', () => {
    try {
      guard(scopeA(), 'charges', [{ tenantId: 'ten_b' }]);
      throw new Error('expected the guard to throw');
    } catch (error) {
      expect((error as Error).message).toContain('charges');
      expect((error as Error).message).toContain('ten_a');
      expect((error as Error).message).toContain('ten_b');
    }
  });

  it('lets matching rows through unchanged', () => {
    const rows = [{ tenantId: 'ten_a', id: 1 }];
    expect(guard(scopeA(), 'members', rows)).toBe(rows);
  });
});

describe('cross-tenant access is explicit', () => {
  it('an admin scope sees every tenant', () => {
    expect(tenantsRepo.listTenants(adminScope({ db: testDb.db })).map((t) => t.id)).toEqual([
      'ten_a',
      'ten_b',
    ]);
  });

  it('impersonation narrows an admin down to one tenant', () => {
    const scope = impersonate(adminScope({ db: testDb.db }), 'ten_b');
    expect(scope.actorRole).toBe('beefcake_admin');
    expect(membersRepo.listMembers(scope).map((m) => m.id)).toEqual(['mem_b1']);
  });

  it('refuses to build a tenant scope with no tenant', () => {
    expect(() => tenantScope('', { db: testDb.db })).toThrow();
  });
});
