import { and, asc, count, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { PlainDate } from '@/domain/dates';
import { type AccessEvent, accessEvents, accessSyncState, sites } from '../schema';
import { type AdminScope, type TenantScope, guard } from './scope';

export function listAccessEvents(
  scope: TenantScope,
  filter: { memberId?: string; siteId?: string; from?: string; to?: string; limit?: number } = {},
): AccessEvent[] {
  const conditions = [eq(accessEvents.tenantId, scope.tenantId)];
  if (filter.memberId !== undefined) conditions.push(eq(accessEvents.memberId, filter.memberId));
  if (filter.siteId !== undefined) conditions.push(eq(accessEvents.siteId, filter.siteId));
  if (filter.from !== undefined) conditions.push(gte(accessEvents.at, filter.from));
  if (filter.to !== undefined) conditions.push(lt(accessEvents.at, filter.to));
  return guard(
    scope,
    'access_events',
    scope.db
      .select()
      .from(accessEvents)
      .where(and(...conditions))
      .orderBy(desc(accessEvents.at))
      .limit(filter.limit ?? 100)
      .all(),
  );
}

export interface DenialBreakdown {
  readonly reason: string;
  readonly n: number;
}

export function denialsByReason(
  scope: TenantScope,
  window: { from: PlainDate; to: PlainDate },
): DenialBreakdown[] {
  return scope.db
    .select({ reason: accessEvents.reason, n: count() })
    .from(accessEvents)
    .where(
      and(
        eq(accessEvents.tenantId, scope.tenantId),
        eq(accessEvents.result, 'denied'),
        gte(accessEvents.localDay, window.from),
        lt(accessEvents.localDay, window.to),
      ),
    )
    .groupBy(accessEvents.reason)
    .orderBy(desc(count()))
    .all();
}

/** Check-ins per local day and hour, for the "when is the gym busy" report. */
export function checkInsByHour(scope: TenantScope, siteId: string, window: { from: PlainDate; to: PlainDate }) {
  return scope.db
    .select({
      hour: sql<number>`cast(strftime('%H', ${accessEvents.at}) as integer)`,
      n: count(),
    })
    .from(accessEvents)
    .where(
      and(
        eq(accessEvents.tenantId, scope.tenantId),
        eq(accessEvents.siteId, siteId),
        eq(accessEvents.result, 'granted'),
        gte(accessEvents.localDay, window.from),
        lt(accessEvents.localDay, window.to),
      ),
    )
    .groupBy(sql`1`)
    .orderBy(asc(sql`1`))
    .all();
}

export function syncStateForTenant(scope: TenantScope) {
  return guard(
    scope,
    'access_sync_state',
    scope.db
      .select()
      .from(accessSyncState)
      .where(eq(accessSyncState.tenantId, scope.tenantId))
      .all(),
  );
}

export function upsertSyncState(
  scope: TenantScope,
  siteId: string,
  patch: { lastSyncedAt: string; lastSuccessAt?: string | null; pendingChanges: number; lastError?: string | null },
): void {
  scope.db
    .insert(accessSyncState)
    .values({
      siteId,
      tenantId: scope.tenantId,
      lastSyncedAt: patch.lastSyncedAt,
      lastSuccessAt: patch.lastSuccessAt ?? null,
      pendingChanges: patch.pendingChanges,
      lastError: patch.lastError ?? null,
    })
    .onConflictDoUpdate({
      target: accessSyncState.siteId,
      set: {
        lastSyncedAt: patch.lastSyncedAt,
        lastSuccessAt: patch.lastSuccessAt ?? null,
        pendingChanges: patch.pendingChanges,
        lastError: patch.lastError ?? null,
      },
    })
    .run();
}

export interface SyncLagRow {
  readonly tenantId: string;
  readonly siteId: string;
  readonly siteName: string;
  readonly accessProvider: string;
  readonly lastSyncedAt: string | null;
  readonly pendingChanges: number;
}

/** Cross-tenant, for the access-sync signal export and the admin dashboard. */
export function allSyncLag(scope: AdminScope): SyncLagRow[] {
  return scope.db
    .select({
      tenantId: sites.tenantId,
      siteId: sites.id,
      siteName: sites.name,
      accessProvider: sites.accessProvider,
      lastSyncedAt: accessSyncState.lastSyncedAt,
      pendingChanges: sql<number>`coalesce(${accessSyncState.pendingChanges}, 0)`,
    })
    .from(sites)
    .leftJoin(accessSyncState, eq(accessSyncState.siteId, sites.id))
    .orderBy(asc(sites.tenantId), asc(sites.name))
    .all();
}
