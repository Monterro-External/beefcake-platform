/**
 * Digital access.
 *
 * The QR the member holds up at the reader, and the honest answer to "will this
 * work right now". That answer is computed with the same function the door
 * controller's allow-list is built from, so the screen cannot promise something
 * the door will refuse.
 */

import { Badge, Callout, Card, DefinitionList, EmptyState, PageHeader, TD, TH, THead, TR, Table } from '@/components/ui';
import { getSession, tenantScopeFor } from '@/lib/session';
import { clock } from '@/lib/clock';
import { date as formatDate, humanise, instant } from '@/lib/format';
import * as accessRepo from '@/db/repositories/access';
import * as subscriptionsRepo from '@/db/repositories/subscriptions';
import * as tenantsRepo from '@/db/repositories/tenants';
import { type PlainDate } from '@/domain/dates';
import { evaluateAccess } from '@/domain/access-rules';
import { timezoneForCountry } from '@/jobs/runner';

export const dynamic = 'force-dynamic';

/**
 * A QR rendered as an SVG grid.
 *
 * Not a real QR code: the reader in this environment is a fake. It is
 * deterministic from the card id so it at least looks like the same code every
 * time the member opens the app.
 */
function QrPlaceholder({ value }: { value: string }) {
  const size = 21;
  let hash = 2166136261;
  const bits: boolean[] = [];
  for (let i = 0; i < size * size; i += 1) {
    hash ^= value.charCodeAt(i % value.length);
    hash = Math.imul(hash, 16777619) >>> 0;
    bits.push(((hash >>> (i % 24)) & 1) === 1);
  }
  const isFinder = (x: number, y: number): boolean =>
    (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7);

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="h-56 w-56"
      role="img"
      aria-label={`Access code for card ${value}`}
    >
      <rect width={size} height={size} fill="white" />
      {Array.from({ length: size * size }, (_, i) => {
        const x = i % size;
        const y = Math.floor(i / size);
        const on = isFinder(x, y)
          ? (x % 6 === 0 || y % 6 === 0 || (x % 6 >= 2 && x % 6 <= 4 && y % 6 >= 2 && y % 6 <= 4))
          : (bits[i] ?? false);
        return on ? <rect key={i} x={x} y={y} width={1} height={1} fill="black" /> : null;
      })}
    </svg>
  );
}

export default async function MemberCard() {
  const session = await getSession();
  const member = session.member;
  const tenant = session.tenant;
  if (member === null || tenant === null) return null;

  const scope = tenantScopeFor(session);
  const time = clock();
  const locale = tenant.locale;
  const settings = tenantsRepo.getSettings(scope);
  const sites = tenantsRepo.listSites(scope);
  const homeSite = sites.find((site) => site.id === member.homeSiteId);
  const timezone = homeSite?.timezone ?? timezoneForCountry(tenant.country);

  const subscription = subscriptionsRepo.currentSubscription(scope, member.id);
  const plan = subscription === null ? null : subscriptionsRepo.getPlan(scope, subscription.planId);
  const freezes =
    subscription === null
      ? []
      : subscriptionsRepo.listFreezes(scope, subscription.id).map((freeze) => ({
          startsOn: freeze.startsOn as PlainDate,
          endsOn: freeze.endsOn as PlainDate,
        }));

  const decision = evaluateAccess({
    at: time.now,
    timezone,
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
            sitesScope: plan?.sitesScope ?? 'home_site',
            homeSiteId: member.homeSiteId,
          },
    freezes,
    rules: { accessGraceHours: settings.accessGraceHours },
  });

  const events = accessRepo.listAccessEvents(scope, { memberId: member.id, limit: 15 });
  const siteNames = new Map(sites.map((site) => [site.id, site]));

  return (
    <>
      <PageHeader
        title="Access"
        subtitle={
          plan?.sitesScope === 'all_sites'
            ? `Any ${tenant.name} gym`
            : (homeSite?.name ?? 'Your gym')
        }
        actions={
          <Badge tone={decision.result === 'granted' ? 'good' : 'bad'}>
            {decision.result === 'granted' ? 'Will open the door' : humanise(decision.reason)}
          </Badge>
        }
      />

      {decision.result === 'denied' && (
        <div className="mb-4">
          <Callout tone="bad" title="This will not open the door right now">
            {decision.reason === 'frozen' &&
              'Your membership is frozen. It works again the day the freeze ends.'}
            {decision.reason === 'subscription_ended' &&
              'Your membership has ended. Talk to the front desk to start again.'}
            {decision.reason === 'member_blocked' &&
              'Your card has been blocked. The front desk can tell you why.'}
            {decision.reason === 'unknown_card' && 'No card is registered to you yet.'}
            {decision.reason === 'no_subscription' && 'You do not have a membership.'}
            {decision.reason === 'not_started' && 'Your membership has not started yet.'}
            {decision.reason === 'site_not_included' &&
              'Your plan only covers your own gym. Ask about upgrading.'}
          </Callout>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Your code">
          {member.cardId === null ? (
            <EmptyState title="No card yet" hint="Ask at the desk on your next visit." />
          ) : (
            <div className="flex flex-col items-center gap-3 py-2">
              <QrPlaceholder value={member.cardId} />
              <p className="font-mono text-ink-muted">{member.cardId}</p>
              <p className="text-center text-ink-muted">
                Hold this against the reader. It refreshes every time you open this screen.
              </p>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="What the door knows">
            <DefinitionList
              items={[
                { label: 'Card', value: member.cardId ?? 'None' },
                { label: 'Home gym', value: homeSite?.name ?? '-' },
                { label: 'Plan covers', value: humanise(plan?.sitesScope) },
                { label: 'Hardware', value: humanise(homeSite?.accessProvider) },
                { label: 'Right now', value: humanise(decision.reason) },
                {
                  label: 'Valid until',
                  value:
                    subscription?.endsOn == null
                      ? 'Open ended'
                      : formatDate(subscription.endsOn as PlainDate, locale),
                },
              ]}
            />
          </Card>

          <Card title="Recent visits">
            {events.length === 0 ? (
              <EmptyState title="No visits recorded" />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>When</TH>
                    <TH>Gym</TH>
                    <TH>Result</TH>
                  </TR>
                </THead>
                <tbody>
                  {events.map((event) => {
                    const site = siteNames.get(event.siteId);
                    return (
                      <TR key={event.id}>
                        <TD className="whitespace-nowrap">
                          {instant(event.at, site?.timezone ?? timezone, locale)}
                        </TD>
                        <TD>{site?.name ?? event.siteId}</TD>
                        <TD>
                          <Badge tone={event.result === 'granted' ? 'good' : 'bad'}>
                            {humanise(event.reason)}
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
      </div>
    </>
  );
}
