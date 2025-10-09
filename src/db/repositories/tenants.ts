import { and, asc, eq, inArray } from 'drizzle-orm';
import { type Tenant, sites, tenantSettings, tenants } from '../schema';
import { type TenantSettings, readSettings } from '@/domain/tenant-settings';
import { type AdminScope, type TenantScope, guard, guardOne } from './scope';

export function getTenant(scope: TenantScope): Tenant | null {
  const row = scope.db.select().from(tenants).where(eq(tenants.id, scope.tenantId)).get();
  return row === undefined ? null : row;
}

export function requireTenant(scope: TenantScope): Tenant {
  const tenant = getTenant(scope);
  if (tenant === null) throw new Error(`Unknown tenant ${scope.tenantId}`);
  return tenant;
}

export function listTenants(scope: AdminScope): Tenant[] {
  return scope.db.select().from(tenants).orderBy(asc(tenants.name)).all();
}

export function listSites(scope: TenantScope) {
  return guard(
    scope,
    'sites',
    scope.db.select().from(sites).where(eq(sites.tenantId, scope.tenantId)).orderBy(asc(sites.name)).all(),
  );
}

export function getSite(scope: TenantScope, siteId: string) {
  return guardOne(
    scope,
    'sites',
    scope.db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, scope.tenantId), eq(sites.id, siteId)))
      .get(),
  );
}

export function getSettings(scope: TenantScope): TenantSettings {
  const rows = scope.db
    .select({ key: tenantSettings.key, value: tenantSettings.value })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, scope.tenantId))
    .all();
  return readSettings(rows);
}

export function setSetting(scope: TenantScope, key: string, value: string, at: string): void {
  scope.db
    .insert(tenantSettings)
    .values({ tenantId: scope.tenantId, key, value, updatedAt: at })
    .onConflictDoUpdate({
      target: [tenantSettings.tenantId, tenantSettings.key],
      set: { value, updatedAt: at },
    })
    .run();
}

export function clearSetting(scope: TenantScope, key: string): void {
  scope.db
    .delete(tenantSettings)
    .where(and(eq(tenantSettings.tenantId, scope.tenantId), eq(tenantSettings.key, key)))
    .run();
}

/** Settings for many tenants at once, for the admin list and the exports. */
export function settingsFor(scope: AdminScope, tenantIds: readonly string[]): Map<string, TenantSettings> {
  if (tenantIds.length === 0) return new Map();
  const rows = scope.db
    .select()
    .from(tenantSettings)
    .where(inArray(tenantSettings.tenantId, [...tenantIds]))
    .all();
  const byTenant = new Map<string, { key: string; value: string }[]>();
  for (const id of tenantIds) byTenant.set(id, []);
  for (const row of rows) byTenant.get(row.tenantId)?.push({ key: row.key, value: row.value });
  return new Map([...byTenant].map(([id, r]) => [id, readSettings(r)]));
}
