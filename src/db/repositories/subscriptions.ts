import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { PlainDate } from '@/domain/dates';
import type { StoredFreeze } from '@/domain/freezes';
import type { SubscriptionRecord } from '@/domain/subscriptions';
import { type Freeze, type Plan, type Subscription, freezes, plans, subscriptions } from '../schema';
import { type TenantScope, guard, guardOne } from './scope';

export function getSubscription(scope: TenantScope, id: string): Subscription | null {
  return guardOne(
    scope,
    'subscriptions',
    scope.db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.tenantId, scope.tenantId), eq(subscriptions.id, id)))
      .get(),
  );
}

/** The subscription a member is currently on, newest first if there are several. */
export function currentSubscription(scope: TenantScope, memberId: string): Subscription | null {
  const rows = guard(
    scope,
    'subscriptions',
    scope.db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.tenantId, scope.tenantId), eq(subscriptions.memberId, memberId)))
      .orderBy(sql`${subscriptions.startedOn} desc`)
      .all(),
  );
  return rows.find((s) => s.status !== 'cancelled') ?? rows[0] ?? null;
}

export function listSubscriptionsForMembers(
  scope: TenantScope,
  memberIds: readonly string[],
): Map<string, Subscription> {
  if (memberIds.length === 0) return new Map();
  const rows = guard(
    scope,
    'subscriptions',
    scope.db
      .select()
      .from(subscriptions)
      .where(
        and(eq(subscriptions.tenantId, scope.tenantId), inArray(subscriptions.memberId, [...memberIds])),
      )
      .orderBy(asc(subscriptions.startedOn))
      .all(),
  );
  const out = new Map<string, Subscription>();
  for (const row of rows) out.set(row.memberId, row);
  return out;
}

export function listPlans(scope: TenantScope, options: { activeOnly?: boolean } = {}): Plan[] {
  const conditions = [eq(plans.tenantId, scope.tenantId)];
  if (options.activeOnly === true) conditions.push(eq(plans.active, true));
  return guard(
    scope,
    'plans',
    scope.db
      .select()
      .from(plans)
      .where(and(...conditions))
      .orderBy(asc(plans.priceMinor))
      .all(),
  );
}

export function getPlan(scope: TenantScope, planId: string): Plan | null {
  return guardOne(
    scope,
    'plans',
    scope.db
      .select()
      .from(plans)
      .where(and(eq(plans.tenantId, scope.tenantId), eq(plans.id, planId)))
      .get(),
  );
}

export function listFreezes(scope: TenantScope, subscriptionId: string): Freeze[] {
  return guard(
    scope,
    'freezes',
    scope.db
      .select()
      .from(freezes)
      .where(and(eq(freezes.tenantId, scope.tenantId), eq(freezes.subscriptionId, subscriptionId)))
      .orderBy(asc(freezes.startsOn))
      .all(),
  );
}

export function freezesFor(
  scope: TenantScope,
  subscriptionIds: readonly string[],
): Map<string, StoredFreeze[]> {
  const out = new Map<string, StoredFreeze[]>();
  if (subscriptionIds.length === 0) return out;
  const rows = guard(
    scope,
    'freezes',
    scope.db
      .select()
      .from(freezes)
      .where(
        and(eq(freezes.tenantId, scope.tenantId), inArray(freezes.subscriptionId, [...subscriptionIds])),
      )
      .all(),
  );
  for (const row of rows) {
    const list = out.get(row.subscriptionId) ?? [];
    list.push({ startsOn: row.startsOn as PlainDate, endsOn: row.endsOn as PlainDate });
    out.set(row.subscriptionId, list);
  }
  return out;
}

/** Subscriptions a payment run has to consider for a period. */
export function billableSubscriptions(scope: TenantScope, periodEnd: PlainDate): Subscription[] {
  const endsAfterPeriodStart = or(
    isNull(subscriptions.endsOn),
    sql`${subscriptions.endsOn} >= ${periodEnd}`,
  );
  const conditions = [
    eq(subscriptions.tenantId, scope.tenantId),
    lte(subscriptions.startedOn, periodEnd),
    inArray(subscriptions.status, ['active', 'cancelling']),
  ];
  if (endsAfterPeriodStart !== undefined) conditions.push(endsAfterPeriodStart);
  return guard(
    scope,
    'subscriptions',
    scope.db
      .select()
      .from(subscriptions)
      .where(and(...conditions))
      .orderBy(asc(subscriptions.memberId))
      .all(),
  );
}

export function toRecord(row: Subscription): SubscriptionRecord {
  return {
    id: row.id,
    memberId: row.memberId,
    planId: row.planId,
    status: row.status,
    startedOn: row.startedOn as PlainDate,
    endsOn: (row.endsOn as PlainDate | null) ?? null,
    bindingUntil: (row.bindingUntil as PlainDate | null) ?? null,
    cancelledOn: (row.cancelledOn as PlainDate | null) ?? null,
    noticeEndsOn: (row.noticeEndsOn as PlainDate | null) ?? null,
  };
}

export interface CancelPatch {
  readonly cancelledOn: PlainDate;
  readonly noticeEndsOn: PlainDate;
  readonly endsOn: PlainDate;
  readonly reason: string;
}

export function applyCancellation(scope: TenantScope, id: string, patch: CancelPatch): void {
  scope.db
    .update(subscriptions)
    .set({
      status: 'cancelling',
      cancelledOn: patch.cancelledOn,
      noticeEndsOn: patch.noticeEndsOn,
      endsOn: patch.endsOn,
      cancelReason: patch.reason,
    })
    .where(and(eq(subscriptions.tenantId, scope.tenantId), eq(subscriptions.id, id)))
    .run();
}

export function changePlan(scope: TenantScope, id: string, planId: string): void {
  scope.db
    .update(subscriptions)
    .set({ planId })
    .where(and(eq(subscriptions.tenantId, scope.tenantId), eq(subscriptions.id, id)))
    .run();
}

export function insertFreeze(
  scope: TenantScope,
  values: Omit<Freeze, 'tenantId'> & { tenantId?: string },
): void {
  scope.db
    .insert(freezes)
    .values({ ...values, tenantId: scope.tenantId })
    .run();
}
