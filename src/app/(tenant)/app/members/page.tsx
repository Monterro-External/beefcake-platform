/**
 * The member list.
 *
 * The screen front desk lives in. Search has to match on whatever they have to
 * hand: a name half remembered, an email, a phone number, or the number printed
 * on the card. Paged, because a key account has 22,000 of these.
 */

import Link from 'next/link';
import {
  Badge,
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  Pagination,
  StatTile,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@/components/ui';
import { MemberFilters } from './filters';
import { activeTenant, getSession, tenantScopeFor } from '@/lib/session';
import { clock } from '@/lib/clock';
import { date as formatDate, humanise, integer } from '@/lib/format';
import * as membersRepo from '@/db/repositories/members';
import * as subscriptionsRepo from '@/db/repositories/subscriptions';
import * as tenantsRepo from '@/db/repositories/tenants';
import * as reports from '@/export/reports';
import { effectiveStatus } from '@/domain/subscriptions';
import type { PlainDate } from '@/domain/dates';
import { timezoneForCountry } from '@/jobs/runner';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 40;

const STATUS_TONE = {
  active: 'good',
  frozen: 'info',
  cancelling: 'warn',
  ended: 'neutral',
  pending: 'neutral',
} as const;

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; site?: string; status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const session = await getSession();
  const tenant = activeTenant(session);
  if (tenant === null) return null;

  const scope = tenantScopeFor(session);
  const time = clock();
  const today = time.today(timezoneForCountry(tenant.country));
  const locale = tenant.locale;

  const page = Math.max(1, Number.parseInt(params.page ?? '1', 10) || 1);
  const search = params.q ?? '';
  const siteId = params.site === '' ? undefined : params.site;
  const status: 'active' | 'blocked' | 'former' | undefined =
    params.status === 'active' || params.status === 'blocked' || params.status === 'former'
      ? params.status
      : undefined;

  const sites = tenantsRepo.listSites(scope);
  const filter = { search, siteId, status, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
  const rows = membersRepo.listMembersWithSite(scope, filter);
  const total = membersRepo.countMembers(scope, { search, siteId, status });
  const summary = reports.membershipSummary(scope, reports.windowOfDays(today, 30));

  const subscriptions = subscriptionsRepo.listSubscriptionsForMembers(
    scope,
    rows.map((row) => row.member.id),
  );
  const freezes = subscriptionsRepo.freezesFor(scope, [...subscriptions.values()].map((s) => s.id));
  const plans = new Map(subscriptionsRepo.listPlans(scope).map((plan) => [plan.id, plan]));

  return (
    <>
      <PageHeader
        title="Members"
        subtitle={`${integer(total, locale)} matching, ${integer(summary.active, locale)} active in total`}
        actions={
          <LinkButton href="/app/members/new" variant="primary">
            New member
          </LinkButton>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Active" value={integer(summary.active, locale)} />
        <StatTile label="Frozen" value={integer(summary.frozen, locale)} tone="info" />
        <StatTile
          label="Notice given"
          value={integer(summary.cancelling, locale)}
          tone={summary.cancelling > 0 ? 'warn' : 'neutral'}
        />
        <StatTile
          label="Joined in 30 days"
          value={integer(summary.joinedInWindow, locale)}
          hint={`${integer(summary.leftInWindow, locale)} left`}
        />
      </div>

      <Card>
        <MemberFilters
          sites={sites.map((site) => ({ id: site.id, name: site.name }))}
          search={search}
          siteId={siteId ?? ''}
          status={status ?? ''}
        />

        {rows.length === 0 ? (
          <EmptyState
            title="Nobody matches that"
            hint="Try a shorter search, or clear the site and status filters."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Site</TH>
                <TH>Plan</TH>
                <TH>Membership</TH>
                <TH>Card</TH>
                <TH align="right">Member since</TH>
              </TR>
            </THead>
            <tbody>
              {rows.map(({ member, siteName }) => {
                const subscription = subscriptions.get(member.id);
                const plan = subscription === undefined ? undefined : plans.get(subscription.planId);
                const state =
                  subscription === undefined
                    ? 'pending'
                    : effectiveStatus(
                        subscriptionsRepo.toRecord(subscription),
                        freezes.get(subscription.id) ?? [],
                        today,
                      );
                return (
                  <TR key={member.id}>
                    <TD>
                      <Link href={`/app/members/${member.id}`} className="font-medium text-accent">
                        {member.name}
                      </Link>
                      <div className="text-ink-muted">{member.email}</div>
                    </TD>
                    <TD>{siteName}</TD>
                    <TD>{plan?.name ?? '-'}</TD>
                    <TD>
                      <Badge tone={STATUS_TONE[state]}>{humanise(state)}</Badge>
                      {member.status === 'blocked' && (
                        <>
                          {' '}
                          <Badge tone="bad">Blocked</Badge>
                        </>
                      )}
                    </TD>
                    <TD mono className="text-ink-muted">
                      {member.cardId ?? 'none'}
                    </TD>
                    <TD align="right" className="whitespace-nowrap">
                      {formatDate(member.joinedOn as PlainDate, locale)}
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        )}

        <div className="mt-3">
          <Pagination
            basePath="/app/members"
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            query={{ q: search, site: siteId, status }}
          />
        </div>
      </Card>
    </>
  );
}
