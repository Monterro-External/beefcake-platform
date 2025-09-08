/**
 * Tenant isolation.
 *
 * Beefcake is one process and one database serving 340 gym operators. A query
 * that forgets `tenant_id` shows Nordic Fitness Group's members to a single-site
 * gym in Umeå. That is the one bug we cannot ship, so it is not left to
 * discipline at the call site:
 *
 *  - Every read and write of a tenant-scoped table goes through a repository.
 *  - Every repository function takes a `TenantScope` as its first argument and
 *    filters on `scope.tenantId`.
 *  - Reads assert on the way out that nothing from another tenant came back.
 *    The assertion has caught mistakes during refactors and costs nothing
 *    measurable next to the query itself.
 *
 * Cross-tenant reads exist (Beefcake admin, the signal exports). They take an
 * `AdminScope`, which is a separate type on purpose: you cannot pass one where a
 * `TenantScope` is expected, so every cross-tenant query is visible in review.
 *
 * See docs/adr/0001-tenant-id-on-every-table.md.
 */

import { type Db, getDb } from '../client';

export class TenantIsolationError extends Error {
  constructor(
    readonly expected: string,
    readonly found: string | null,
    readonly table: string,
  ) {
    super(`Tenant isolation violated reading ${table}: expected ${expected}, found ${found ?? 'null'}`);
    this.name = 'TenantIsolationError';
  }
}

export interface TenantScope {
  readonly kind: 'tenant';
  readonly tenantId: string;
  readonly db: Db;
  /** Who is acting, for the events log. */
  readonly actorId: string | null;
  readonly actorRole: string | null;
}

export interface AdminScope {
  readonly kind: 'admin';
  readonly db: Db;
  readonly actorId: string | null;
}

export type Scope = TenantScope | AdminScope;

export interface ScopeOptions {
  db?: Db;
  actorId?: string | null;
  actorRole?: string | null;
}

export function tenantScope(tenantId: string, options: ScopeOptions = {}): TenantScope {
  if (tenantId.length === 0) throw new Error('tenantScope requires a tenant id');
  return {
    kind: 'tenant',
    tenantId,
    db: options.db ?? getDb(),
    actorId: options.actorId ?? null,
    actorRole: options.actorRole ?? null,
  };
}

/** Cross-tenant access. Only Beefcake staff and the export scripts get one. */
export function adminScope(options: ScopeOptions = {}): AdminScope {
  return { kind: 'admin', db: options.db ?? getDb(), actorId: options.actorId ?? null };
}

/** Narrow an admin scope to one tenant, e.g. for read-only impersonation. */
export function impersonate(admin: AdminScope, tenantId: string): TenantScope {
  return {
    kind: 'tenant',
    tenantId,
    db: admin.db,
    actorId: admin.actorId,
    actorRole: 'beefcake_admin',
  };
}

/** Assert that every row belongs to the scope. Returns the rows for chaining. */
export function guard<T extends { tenantId: string | null }>(
  scope: TenantScope,
  table: string,
  rows: readonly T[],
): T[] {
  for (const row of rows) {
    if (row.tenantId !== scope.tenantId) {
      throw new TenantIsolationError(scope.tenantId, row.tenantId, table);
    }
  }
  return rows as T[];
}

export function guardOne<T extends { tenantId: string | null }>(
  scope: TenantScope,
  table: string,
  row: T | undefined,
): T | null {
  if (row === undefined) return null;
  return guard(scope, table, [row])[0] as T;
}
