/**
 * Nightly access sync.
 *
 * Door controllers hold an offline allow-list so the door keeps working when the
 * network does not. This job derives that list from the same rules the app uses
 * to answer "should this swipe open the door", pushes it per site, and records
 * how it went.
 *
 * The window pushed is today plus the next few days, so a controller that misses
 * one night still has a correct list in the morning. That window is also why a
 * change made today does not always reach the door today, and why sync lag is an
 * input to the tenant health score.
 */

import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { members, plans, sites, subscriptions } from '@/db/schema';
import * as accessRepo from '@/db/repositories/access';
import { freezesFor } from '@/db/repositories/subscriptions';
import { guard } from '@/db/repositories/scope';
import { recordError, recordEvent } from '@/db/repositories/observability';
import { type PlainDate, addDays } from '@/domain/dates';
import { allowedDays } from '@/domain/access-rules';
import type { AccessGrant, AccessProviderName } from '@/integrations/types';
import type { Job, TenantJobContext } from './runner';

/**
 * How many days ahead the allow-list covers. Long enough that one missed night
 * is invisible, short enough that a cancellation takes effect within the week.
 */
export const SYNC_WINDOW_DAYS = 3;

export interface AccessSyncSummary {
  sitesSynced: number;
  sitesFailed: number;
  grantsPushed: number;
  membersExcluded: number;
  [key: string]: number | string | boolean | null;
}

export interface SyncWindow {
  readonly from: PlainDate;
  readonly to: PlainDate;
}

export const accessSyncJob: Job<AccessSyncSummary> = {
  name: 'access-sync',
  describe: 'Push each site an allow-list covering today and the next few days',

  perTenant(context): AccessSyncSummary {
    const summary: AccessSyncSummary = {
      sitesSynced: 0,
      sitesFailed: 0,
      grantsPushed: 0,
      membersExcluded: 0,
    };

    const window: SyncWindow = { from: context.today, to: addDays(context.today, SYNC_WINDOW_DAYS) };
    const siteRows = guard(
      context.scope,
      'sites',
      context.scope.db
        .select()
        .from(sites)
        .where(eq(sites.tenantId, context.tenant.id))
        .orderBy(asc(sites.name))
        .all(),
    );

    // One query for the whole tenant rather than one per site: a fifteen-site
    // chain would otherwise do fifteen scans of a 22,000-row member table.
    const eligible = eligibleMembers(context, window);
    const freezes = freezesFor(
      context.scope,
      eligible.map((row) => row.subscriptionId),
    );

    for (const site of siteRows) {
      const grants: AccessGrant[] = [];
      for (const row of eligible) {
        if (row.sitesScope === 'home_site' && row.homeSiteId !== site.id) continue;
        const days = allowedDays(
          {
            id: row.subscriptionId,
            startsOn: row.startedOn,
            endsOn: row.endsOn,
            sitesScope: row.sitesScope,
            homeSiteId: row.homeSiteId,
          },
          freezes.get(row.subscriptionId) ?? [],
          window,
        );
        if (days.length === 0) {
          summary.membersExcluded += 1;
          continue;
        }
        grants.push({
          cardId: row.cardId,
          memberId: row.memberId,
          validFrom: days[0] as string,
          validTo: days[days.length - 1] as string,
        });
      }

      pushToSite(context, site.id, site.accessProvider, site.timezone, window, grants, summary);
    }

    return summary;
  },
};

interface EligibleMember {
  readonly memberId: string;
  readonly cardId: string;
  readonly homeSiteId: string;
  readonly subscriptionId: string;
  readonly startedOn: PlainDate;
  readonly endsOn: PlainDate | null;
  readonly sitesScope: 'home_site' | 'all_sites';
}

/**
 * Members who could plausibly be on a door over the window: a card on file, an
 * active record, and a subscription that overlaps the window. Whether any given
 * *day* is allowed is then decided by `allowedDays`, which is the same function
 * the app uses, so the controller and the screens cannot disagree.
 */
function eligibleMembers(context: TenantJobContext, window: SyncWindow): EligibleMember[] {
  const { scope } = context;
  const rows = scope.db
    .select({
      tenantId: members.tenantId,
      memberId: members.id,
      cardId: members.cardId,
      homeSiteId: members.homeSiteId,
      subscriptionId: subscriptions.id,
      startedOn: subscriptions.startedOn,
      endsOn: subscriptions.endsOn,
      sitesScope: plans.sitesScope,
    })
    .from(members)
    .innerJoin(subscriptions, eq(subscriptions.memberId, members.id))
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(
      and(
        eq(members.tenantId, scope.tenantId),
        eq(members.status, 'active'),
        isNotNull(members.cardId),
        inArray(subscriptions.status, ['active', 'cancelling']),
        lte(subscriptions.startedOn, window.to),
        or(isNull(subscriptions.endsOn), gte(subscriptions.endsOn, window.from)),
      ),
    )
    .all();

  guard(scope, 'members', rows);

  return rows.flatMap((row) =>
    row.cardId === null
      ? []
      : [
          {
            memberId: row.memberId,
            cardId: row.cardId,
            homeSiteId: row.homeSiteId,
            subscriptionId: row.subscriptionId,
            startedOn: row.startedOn as PlainDate,
            endsOn: (row.endsOn as PlainDate | null) ?? null,
            sitesScope: row.sitesScope,
          },
        ],
  );
}

function pushToSite(
  context: TenantJobContext,
  siteId: string,
  provider: AccessProviderName,
  timezone: string,
  window: SyncWindow,
  grants: readonly AccessGrant[],
  summary: AccessSyncSummary,
): void {
  const { scope, tenant, integrations, now } = context;

  if (context.dryRun) {
    context.log(`  ${tenant.name} / ${siteId}: would push ${grants.length} grant(s)`);
    return;
  }

  const outcome = integrations.access[provider].push({
    siteId,
    siteTimezone: timezone,
    grants,
    at: now,
  });

  if (outcome.status === 'ok') {
    accessRepo.upsertSyncState(scope, siteId, {
      lastSyncedAt: now.toISOString(),
      lastSuccessAt: now.toISOString(),
      pendingChanges: 0,
      lastError: null,
    });
    summary.sitesSynced += 1;
    summary.grantsPushed += outcome.accepted;
    recordEvent(scope, {
      action: 'access.sync_completed',
      subjectType: 'site',
      subjectId: siteId,
      payload: {
        grants: outcome.accepted,
        controller_version: outcome.controllerVersion,
        window_from: window.from,
        window_to: window.to,
      },
      at: now.toISOString(),
    });
    return;
  }

  // A failed push leaves the controller on its previous list. That is harmless
  // for people already on it and wrong for anyone whose access should have
  // changed, so the pending count is what the runbook watches.
  const previous = accessRepo.syncStateForTenant(scope).find((state) => state.siteId === siteId);
  accessRepo.upsertSyncState(scope, siteId, {
    lastSyncedAt: now.toISOString(),
    lastSuccessAt: previous?.lastSuccessAt ?? null,
    pendingChanges: (previous?.pendingChanges ?? 0) + grants.length,
    lastError: outcome.message,
  });

  summary.sitesFailed += 1;
  recordEvent(scope, {
    action: 'access.sync_failed',
    subjectType: 'site',
    subjectId: siteId,
    payload: { error: outcome.message, retryable: outcome.retryable },
    at: now.toISOString(),
  });
  recordError(scope, {
    where: 'jobs/access-sync',
    message: outcome.message,
    severity: outcome.retryable ? 'warn' : 'error',
    context: { site_id: siteId, provider, grants: grants.length },
    at: now.toISOString(),
  });
  context.log(`  ${tenant.name} / ${siteId}: push failed, ${outcome.message}`);
}

export { sql };
