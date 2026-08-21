/**
 * The member profile.
 *
 * Where front desk answers "why did my card not work" and "why was I charged
 * that". Everything on one screen and in one order, because the conversation is
 * happening at the counter: who they are, what they are on, what they have paid,
 * and every door they have touched.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import {
  Badge,
  Callout,
  Card,
  DefinitionList,
  EmptyState,
  PageHeader,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@/components/ui';
import { MembershipActions } from './actions-panel';
import { activeTenant, can, getSession, tenantScopeFor } from '@/lib/session';
import { clock } from '@/lib/clock';
import { amount, ago, date as formatDate, humanise, instant, integer } from '@/lib/format';
import { renderReceipt } from '@/lib/receipt';
import * as membersRepo from '@/db/repositories/members';
import * as subscriptionsRepo from '@/db/repositories/subscriptions';
import * as paymentsRepo from '@/db/repositories/payments';
import * as accessRepo from '@/db/repositories/access';
import * as tenantsRepo from '@/db/repositories/tenants';
import { bookings, classes, paymentRuns } from '@/db/schema';
import { guard } from '@/db/repositories/scope';
import { type PlainDate, differenceInDays } from '@/domain/dates';
import { effectiveStatus } from '@/domain/subscriptions';
import { evaluateAccess } from '@/domain/access-rules';
import { timezoneForCountry } from '@/jobs/runner';

export const dynamic = 'force-dynamic';

const STATUS_TONE = {
  active: 'good',
  frozen: 'info',
  cancelling: 'warn',
  ended: 'neutral',
  pending: 'neutral',
} as const;

export default async function MemberPage({ params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params;
  const session = await getSession();
  const tenant = activeTenant(session);
  if (tenant === null) return null;

  const scope = tenantScopeFor(session);
  const time = clock();
  const timezone = timezoneForCountry(tenant.country);
  const today = time.today(timezone);
  const locale = tenant.locale;

  const member = membersRepo.getMember(scope, memberId);
  if (member === null) notFound();

  const subscription = subscriptionsRepo.currentSubscription(scope, member.id);
  const plans = subscriptionsRepo.listPlans(scope, { activeOnly: true });
  const currentPlan =
    subscription === null ? null : (plans.find((plan) => plan.id === subscription.planId) ?? null);
  const settings = tenantsRepo.getSettings(scope);
  const sites = tenantsRepo.listSites(scope);
  const homeSite = sites.find((site) => site.id === member.homeSiteId);
  const siteTimezone = homeSite?.timezone ?? timezone;

  const freezeRows = subscription === null ? [] : subscriptionsRepo.listFreezes(scope, subscription.id);
  const freezes = freezeRows.map((freeze) => ({
    startsOn: freeze.startsOn as PlainDate,
    endsOn: freeze.endsOn as PlainDate,
  }));

  const state =
    subscription === null
      ? 'pending'
      : effectiveStatus(subscriptionsRepo.toRecord(subscription), freezes, today);

  const charges = paymentsRepo.listCharges(scope, { memberId: member.id, limit: 18 });
  const receipts = paymentsRepo.receiptsForMember(scope, member.id, 8);
  const runPeriods = new Map(
    scope.db
      .select({ id: paymentRuns.id, period: paymentRuns.period, tenantId: paymentRuns.tenantId })
      .from(paymentRuns)
      .where(eq(paymentRuns.tenantId, scope.tenantId))
      .all()
      .map((run) => [run.id, run.period]),
  );

  const latestReceipt = receipts[0] === undefined ? null : renderReceipt(receipts[0], locale);

  const accessEvents = accessRepo.listAccessEvents(scope, { memberId: member.id, limit: 20 });
  const siteNames = new Map(sites.map((site) => [site.id, site.name]));

  const recentBookings = guard(
    scope,
    'bookings',
    scope.db
      .select({
        tenantId: bookings.tenantId,
        id: bookings.id,
        status: bookings.status,
        position: bookings.position,
        className: classes.name,
        startsAt: classes.startsAt,
        siteId: classes.siteId,
      })
      .from(bookings)
      .innerJoin(classes, eq(classes.id, bookings.classId))
      .where(and(eq(bookings.tenantId, scope.tenantId), eq(bookings.memberId, member.id)))
      .orderBy(desc(classes.startsAt))
      .limit(10)
      .all(),
  );

  // What the door would do right now, computed with the same function the
  // controller's allow-list is built from. This is the answer to the question
  // front desk is actually being asked.
  const doorNow = evaluateAccess({
    at: time.now,
    timezone: siteTimezone,
    siteId: member.homeSiteId,
    cardKnown: member.cardId !== null,
    memberStatus: member.status,
    subscription:
      subscription === null
        ? null
        : {
            id: subscription.id,
            startsOn: subscription.startedOn as PlainDate,
            endsOn: (subscription.endsOn as PlainDate | null) ?? null,
            sitesScope: currentPlan?.sitesScope ?? 'home_site',
            homeSiteId: member.homeSiteId,
          },
    freezes,
    rules: { accessGraceHours: settings.accessGraceHours },
  });

  const editable = can(session, 'subscriptions.write');
  const openDunning = charges.filter((charge) => charge.status === 'retrying' || charge.status === 'abandoned');

  return (
    <>
      <PageHeader
        title={member.name}
        subtitle={
          <>
            {member.email} · {member.phone} · member since{' '}
            {formatDate(member.joinedOn as PlainDate, locale)} (
            {integer(Math.round(differenceInDays(today, member.joinedOn as PlainDate) / 30), locale)}{' '}
            months)
          </>
        }
        actions={
          <>
            <Badge tone={STATUS_TONE[state]}>{humanise(state)}</Badge>
            {member.status === 'blocked' && <Badge tone="bad">Blocked</Badge>}
            <Badge tone={doorNow.result === 'granted' ? 'good' : 'bad'}>
              Door: {humanise(doorNow.reason)}
            </Badge>
          </>
        }
      />

      {openDunning.length > 0 && (
        <div className="mb-4">
          <Callout tone="warn" title="Payment outstanding">
            {openDunning[0]?.status === 'abandoned'
              ? 'Dunning has given up on this member. Take payment at the desk, or the membership will be suspended.'
              : `Retry ${(openDunning[0]?.attempt ?? 1) + 1} is scheduled for ${ago(openDunning[0]?.nextAttemptAt ?? null, time.now)}.`}
          </Callout>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Membership">
          <DefinitionList
            items={[
              { label: 'Plan', value: currentPlan?.name ?? '-' },
              {
                label: 'Price',
                value:
                  currentPlan === null
                    ? '-'
                    : `${amount(currentPlan.priceMinor, currentPlan.currency, locale)} / month`,
              },
              { label: 'Sites', value: humanise(currentPlan?.sitesScope) },
              { label: 'Home site', value: homeSite?.name ?? '-' },
              {
                label: 'Started',
                value:
                  subscription === null ? '-' : formatDate(subscription.startedOn as PlainDate, locale),
              },
              {
                label: 'Binding until',
                value:
                  subscription?.bindingUntil == null
                    ? 'No binding'
                    : formatDate(subscription.bindingUntil as PlainDate, locale),
              },
              {
                label: 'Notice given',
                value:
                  subscription?.cancelledOn == null
                    ? '-'
                    : formatDate(subscription.cancelledOn as PlainDate, locale),
              },
              {
                label: 'Ends',
                value:
                  subscription?.endsOn == null
                    ? '-'
                    : formatDate(subscription.endsOn as PlainDate, locale),
              },
              { label: 'Card', value: member.cardId ?? 'No card issued' },
            ]}
          />
        </Card>

        <Card title="Freezes" className="lg:col-span-2">
          {freezeRows.length === 0 ? (
            <EmptyState title="Never frozen" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>From</TH>
                  <TH>To</TH>
                  <TH align="right">Months</TH>
                  <TH>Reason</TH>
                  <TH>Back on</TH>
                </TR>
              </THead>
              <tbody>
                {freezeRows.map((freeze) => {
                  const startsOn = freeze.startsOn as PlainDate;
                  const endsOn = freeze.endsOn as PlainDate;
                  const isCurrent = startsOn <= today && endsOn >= today;
                  return (
                    <TR key={freeze.id}>
                      <TD>{formatDate(startsOn, locale)}</TD>
                      <TD>
                        {formatDate(endsOn, locale)}
                        {isCurrent && (
                          <>
                            {' '}
                            <Badge tone="info">Now</Badge>
                          </>
                        )}
                      </TD>
                      <TD align="right">{freeze.months}</TD>
                      <TD>{humanise(freeze.reason)}</TD>
                      <TD className="text-ink-muted">
                        {formatDate(
                          (new Date(Date.parse(`${endsOn}T00:00:00Z`) + 86_400_000)
                            .toISOString()
                            .slice(0, 10) as PlainDate),
                          locale,
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      {subscription !== null && editable && (
        <div className="mt-4">
          <MembershipActions
            subscriptionId={subscription.id}
            memberId={member.id}
            memberStatus={member.status}
            today={today}
            noticePeriodDays={settings.noticePeriodDays}
            maxFreezeMonths={settings.maxFreezeMonths}
            hasNotice={subscription.cancelledOn !== null}
            plans={plans.map((plan) => ({
              id: plan.id,
              name: plan.name,
              label: `${plan.name} · ${amount(plan.priceMinor, plan.currency, locale)}${plan.bindingMonths > 0 ? ` · ${plan.bindingMonths} months binding` : ''}`,
              current: plan.id === subscription.planId,
            }))}
            activeFreezeId={
              freezeRows.find(
                (freeze) => (freeze.startsOn as PlainDate) <= today && (freeze.endsOn as PlainDate) >= today,
              )?.id ?? null
            }
          />
        </div>
      )}

      {!editable && (
        <div className="mt-4">
          <Callout tone="neutral">
            Read-only. {session.isBeefcakeStaff ? 'Impersonation never writes.' : 'Your role cannot change memberships.'}
          </Callout>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Payment history">
          {charges.length === 0 ? (
            <EmptyState title="No charges yet" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Period</TH>
                  <TH align="right">Amount</TH>
                  <TH align="right">Attempt</TH>
                  <TH>Outcome</TH>
                  <TH>Attempted</TH>
                </TR>
              </THead>
              <tbody>
                {charges.map((charge) => (
                  <TR key={charge.id}>
                    <TD mono>{runPeriods.get(charge.paymentRunId) ?? '-'}</TD>
                    <TD align="right" mono>
                      {amount(charge.amountMinor, charge.currency, locale)}
                    </TD>
                    <TD align="right">{charge.attempt}</TD>
                    <TD>
                      <Badge
                        tone={
                          charge.status === 'succeeded'
                            ? 'good'
                            : charge.status === 'retrying'
                              ? 'warn'
                              : 'bad'
                        }
                      >
                        {humanise(charge.status)}
                      </Badge>
                      {charge.failureCode !== null && (
                        <span className="ml-1.5 text-ink-muted">{humanise(charge.failureCode)}</span>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap text-ink-muted">
                      {instant(charge.attemptedAt, timezone, locale)}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
          {latestReceipt !== null && (
            <p className="mt-3 text-ink-muted">
              Latest receipt {latestReceipt.number} for {latestReceipt.total}.
            </p>
          )}
        </Card>

        <Card title="Access log" actions={<Link href="/app/access" className="text-accent">All access</Link>}>
          {accessEvents.length === 0 ? (
            <EmptyState title="No check-ins" hint="Either new, or they never come in." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Site</TH>
                  <TH>Result</TH>
                  <TH>Source</TH>
                </TR>
              </THead>
              <tbody>
                {accessEvents.map((event) => {
                  const site = sites.find((candidate) => candidate.id === event.siteId);
                  return (
                    <TR key={event.id}>
                      <TD className="whitespace-nowrap">
                        {instant(event.at, site?.timezone ?? timezone, locale)}
                      </TD>
                      <TD>{siteNames.get(event.siteId) ?? event.siteId}</TD>
                      <TD>
                        <Badge tone={event.result === 'granted' ? 'good' : 'bad'}>
                          {humanise(event.reason)}
                        </Badge>
                      </TD>
                      <TD className="text-ink-muted">{humanise(event.source)}</TD>
                    </TR>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Recent bookings">
          {recentBookings.length === 0 ? (
            <EmptyState title="No bookings" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Class</TH>
                  <TH>When</TH>
                  <TH>Site</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <tbody>
                {recentBookings.map((booking) => {
                  const site = sites.find((candidate) => candidate.id === booking.siteId);
                  return (
                    <TR key={booking.id}>
                      <TD>{booking.className}</TD>
                      <TD className="whitespace-nowrap">
                        {instant(booking.startsAt, site?.timezone ?? timezone, locale)}
                      </TD>
                      <TD>{siteNames.get(booking.siteId) ?? booking.siteId}</TD>
                      <TD>
                        <Badge
                          tone={
                            booking.status === 'attended'
                              ? 'good'
                              : booking.status === 'no_show'
                                ? 'bad'
                                : booking.status === 'waitlisted'
                                  ? 'warn'
                                  : 'neutral'
                          }
                        >
                          {humanise(booking.status)}
                          {booking.status === 'waitlisted' && booking.position !== null
                            ? ` #${booking.position}`
                            : ''}
                        </Badge>
                      </TD>
                    </TR>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
