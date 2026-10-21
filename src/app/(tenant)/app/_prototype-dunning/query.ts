/**
 * PROTOTYPE (BCPLA-34), throwaway. Not production code.
 *
 * The open-dunning list with the search and filters settled on the map
 * (BCPLA-33, BCPLA-35): matched server-side over the full set, one row per
 * charge, counted in charges and distinct members.
 */

import { and, count, desc, eq, inArray, like, or, sql, countDistinct } from 'drizzle-orm';
import { charges, members } from '@/db/schema';
import { type TenantScope, guard } from '@/db/repositories/scope';
import type { DunningRow } from '@/export/reports';

export interface DunningFilter {
  readonly q: string;
  readonly status: '' | 'retrying' | 'abandoned';
  readonly reason: string;
  readonly site: string;
}

export function readFilter(params: Record<string, string | undefined>): DunningFilter {
  const status = params.status === 'retrying' || params.status === 'abandoned' ? params.status : '';
  return { q: (params.q ?? '').trim(), status, reason: params.reason ?? '', site: params.site ?? '' };
}

export function isFiltered(filter: DunningFilter): boolean {
  return filter.q !== '' || filter.status !== '' || filter.reason !== '' || filter.site !== '';
}

function conditions(scope: TenantScope, filter: DunningFilter) {
  const where = [
    eq(charges.tenantId, scope.tenantId),
    filter.status === '' ? inArray(charges.status, ['retrying', 'abandoned']) : eq(charges.status, filter.status),
  ];
  if (filter.reason !== '') where.push(eq(charges.failureCode, filter.reason));
  if (filter.site !== '') where.push(eq(members.homeSiteId, filter.site));
  if (filter.q !== '') {
    const term = `%${filter.q.toLowerCase()}%`;
    const match = or(
      like(sql`lower(${members.name})`, term),
      like(sql`lower(${members.email})`, term),
      like(members.phone, term),
      like(sql`lower(coalesce(${members.cardId}, ''))`, term),
    );
    if (match !== undefined) where.push(match);
  }
  return and(...where);
}

export interface DunningPage {
  readonly rows: (DunningRow & { email: string; cardId: string | null })[];
  readonly charges: number;
  readonly members: number;
}

export function filteredDunning(scope: TenantScope, filter: DunningFilter, limit: number): DunningPage {
  const rows = scope.db
    .select({
      tenantId: charges.tenantId,
      memberId: charges.memberId,
      memberName: members.name,
      email: members.email,
      cardId: members.cardId,
      amountMinor: charges.amountMinor,
      currency: charges.currency,
      failureCode: charges.failureCode,
      attempt: charges.attempt,
      attemptedAt: charges.attemptedAt,
      nextAttemptAt: charges.nextAttemptAt,
      status: charges.status,
    })
    .from(charges)
    .innerJoin(members, eq(members.id, charges.memberId))
    .where(conditions(scope, filter))
    .orderBy(desc(charges.attemptedAt))
    .limit(limit)
    .all();
  guard(scope, 'charges', rows);
  const totals = scope.db
    .select({ charges: count(), members: countDistinct(charges.memberId) })
    .from(charges)
    .innerJoin(members, eq(members.id, charges.memberId))
    .where(conditions(scope, filter))
    .get();
  return {
    rows: rows as DunningPage['rows'],
    charges: totals?.charges ?? 0,
    members: totals?.members ?? 0,
  };
}

/** Facet counts for variant C's chips: how many charges each choice would leave. */
export function facetCounts(scope: TenantScope, filter: DunningFilter) {
  const byStatus = scope.db
    .select({ key: charges.status, n: count() })
    .from(charges)
    .innerJoin(members, eq(members.id, charges.memberId))
    .where(conditions(scope, { ...filter, status: '' }))
    .groupBy(charges.status)
    .all();
  const byReason = scope.db
    .select({ key: charges.failureCode, n: count() })
    .from(charges)
    .innerJoin(members, eq(members.id, charges.memberId))
    .where(conditions(scope, { ...filter, reason: '' }))
    .groupBy(charges.failureCode)
    .all();
  return { byStatus, byReason };
}
