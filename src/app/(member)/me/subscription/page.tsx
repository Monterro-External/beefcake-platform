/**
 * My membership.
 *
 * What the member is on, what it costs, and the two things they came here to do:
 * freeze it or leave. Both go through the same server actions the front desk
 * uses, and both are gated on the operator's self-serve flag, because plenty of
 * operators want that conversation to happen at the desk.
 */

import { Badge, Callout, Card, DefinitionList, EmptyState, PageHeader, Table, TD, TH, THead, TR } from '@/components/ui';
import { SelfServePanel } from './self-serve';
import { getSession, tenantScopeFor } from '@/lib/session';
import { clock } from '@/lib/clock';
import { amount, date as formatDate, humanise } from '@/lib/format';
import * as subscriptionsRepo from '@/db/repositories/subscriptions';
import * as tenantsRepo from '@/db/repositories/tenants';
import { type PlainDate, addDays } from '@/domain/dates';
import { effectiveStatus } from '@/domain/subscriptions';
import { timezoneForCountry } from '@/jobs/runner';

export const dynamic = 'force-dynamic';

export default async function MemberSubscription() {
  const session = await getSession();
  const member = session.member;
  const tenant = session.tenant;
  if (member === null || tenant === null) return null;

  const scope = tenantScopeFor(session);
  const time = clock();
  const locale = tenant.locale;
  const sites = tenantsRepo.listSites(scope);
  const homeSite = sites.find((site) => site.id === member.homeSiteId);
  const timezone = homeSite?.timezone ?? timezoneForCountry(tenant.country);
  const today = time.today(timezone);

  const settings = tenantsRepo.getSettings(scope);
  const subscription = subscriptionsRepo.currentSubscription(scope, member.id);
  if (subscription === null) {
    return (
      <>
        <PageHeader title="My membership" />
        <Card>
          <EmptyState title="No membership" hint="Talk to the front desk to sign up." />
        </Card>
      </>
    );
  }

  const plans = subscriptionsRepo.listPlans(scope, { activeOnly: true });
  const plan = plans.find((candidate) => candidate.id === subscription.planId) ?? null;
  const freezeRows = subscriptionsRepo.listFreezes(scope, subscription.id);
  const freezes = freezeRows.map((freeze) => ({
    startsOn: freeze.startsOn as PlainDate,
    endsOn: freeze.endsOn as PlainDate,
  }));
  const state = effectiveStatus(subscriptionsRepo.toRecord(subscription), freezes, today);
  const activeFreeze = freezeRows.find(
    (freeze) => (freeze.startsOn as PlainDate) <= today && (freeze.endsOn as PlainDate) >= today,
  );

  return (
    <>
      <PageHeader
        title="My membership"
        subtitle={`${plan?.name ?? '-'} at ${homeSite?.name ?? '-'}`}
        actions={<Badge tone={state === 'active' ? 'good' : state === 'ended' ? 'bad' : 'warn'}>{humanise(state)}</Badge>}
      />

      {state === 'cancelling' && subscription.endsOn != null && (
        <div className="mb-4">
          <Callout tone="warn" title="You have given notice">
            You can train until {formatDate(subscription.endsOn as PlainDate, locale)}. After that your
            card stops working.
          </Callout>
        </div>
      )}
      {activeFreeze !== undefined && (
        <div className="mb-4">
          <Callout tone="info" title="Your membership is frozen">
            Back on{' '}
            {formatDate(addDays(activeFreeze.endsOn as PlainDate, 1), locale)}. You are not billed
            while frozen.
          </Callout>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Details">
          <DefinitionList
            items={[
              { label: 'Plan', value: plan?.name ?? '-' },
              {
                label: 'Price',
                value: plan === null ? '-' : `${amount(plan.priceMinor, plan.currency, locale)} / month`,
              },
              { label: 'Where you can train', value: humanise(plan?.sitesScope) },
              { label: 'Member since', value: formatDate(member.joinedOn as PlainDate, locale) },
              {
                label: 'Binding until',
                value:
                  subscription.bindingUntil == null
                    ? 'No binding'
                    : formatDate(subscription.bindingUntil as PlainDate, locale),
              },
              { label: 'Notice period', value: `${settings.noticePeriodDays} days` },
              {
                label: 'Ends',
                value:
                  subscription.endsOn == null ? '-' : formatDate(subscription.endsOn as PlainDate, locale),
              },
            ]}
          />
        </Card>

        <Card title="Freeze history">
          {freezeRows.length === 0 ? (
            <EmptyState title="Never frozen" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>From</TH>
                  <TH>To</TH>
                  <TH>Back on</TH>
                  <TH>Reason</TH>
                </TR>
              </THead>
              <tbody>
                {freezeRows.map((freeze) => (
                  <TR key={freeze.id}>
                    <TD>{formatDate(freeze.startsOn as PlainDate, locale)}</TD>
                    <TD>{formatDate(freeze.endsOn as PlainDate, locale)}</TD>
                    <TD className="text-ink-muted">
                      {formatDate(addDays(freeze.endsOn as PlainDate, 1), locale)}
                    </TD>
                    <TD>{humanise(freeze.reason)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <div className="mt-4">
        {settings.flags.self_serve_freeze ? (
          <SelfServePanel
            subscriptionId={subscription.id}
            today={today}
            maxFreezeMonths={settings.maxFreezeMonths}
            noticePeriodDays={settings.noticePeriodDays}
            hasNotice={subscription.cancelledOn !== null}
            activeFreezeId={activeFreeze?.id ?? null}
            plans={plans.map((candidate) => ({
              id: candidate.id,
              label: `${candidate.name} · ${amount(candidate.priceMinor, candidate.currency, locale)}`,
              current: candidate.id === subscription.planId,
            }))}
          />
        ) : (
          <Card title="Changes">
            <p>
              This gym handles freezes, plan changes and cancellations at the front desk. Ask when you
              are next in, or call {homeSite?.name ?? 'your gym'}.
            </p>
          </Card>
        )}
      </div>
    </>
  );
}
