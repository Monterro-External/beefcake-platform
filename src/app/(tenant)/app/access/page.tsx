/**
 * Access.
 *
 * Two audiences on one screen. Front desk wants "why did this card not work",
 * which is the event log at the bottom. The owner wants "is the hardware
 * working", which is the sync table at the top, because a controller running on
 * a stale allow-list is both a revenue problem and a security one.
 */

import Link from 'next/link';
import {
  Badge,
  Callout,
  Card,
  EmptyState,
  PageHeader,
  Select,
  StatTile,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@/components/ui';
import { activeTenant, getSession, tenantScopeFor } from '@/lib/session';
import { clock } from '@/lib/clock';
import { ago, humanise, instant, integer, percent } from '@/lib/format';
import * as accessRepo from '@/db/repositories/access';
import * as tenantsRepo from '@/db/repositories/tenants';
import * as reports from '@/export/reports';
import { SYNC_WINDOW_DAYS } from '@/jobs/access-sync';
import { timezoneForCountry } from '@/jobs/runner';

export const dynamic = 'force-dynamic';

export default async function AccessPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string; result?: string }>;
}) {
  const params = await searchParams;
  const session = await getSession();
  const tenant = activeTenant(session);
  if (tenant === null) return null;

  const scope = tenantScopeFor(session);
  const time = clock();
  const tenantTimezone = timezoneForCountry(tenant.country);
  const today = time.today(tenantTimezone);
  const locale = tenant.locale;

  const sites = tenantsRepo.listSites(scope);
  const siteFilter = params.site !== undefined && params.site !== '' ? params.site : undefined;
  const settings = tenantsRepo.getSettings(scope);

  const lag = reports.syncLagBySite(scope);
  const byLocation = reports.accessBySite(scope, reports.windowOfDays(today, 30));
  const events = accessRepo.listAccessEvents(scope, { siteId: siteFilter, limit: 120 });
  const denials = accessRepo.denialsByReason(scope, reports.windowOfDays(today, 30));

  const siteNames = new Map(sites.map((site) => [site.id, site]));
  const granted = byLocation.reduce((acc, row) => acc + row.granted, 0);
  const denied = byLocation.reduce((acc, row) => acc + row.denied, 0);
  const stale = lag.filter(
    (site) =>
      site.lastSuccessAt === null || Date.parse(site.lastSuccessAt) < time.now.getTime() - 48 * 3_600_000,
  );
  const pending = lag.reduce((acc, site) => acc + site.pendingChanges, 0);

  const filtered =
    params.result === 'denied'
      ? events.filter((event) => event.result === 'denied')
      : params.result === 'granted'
        ? events.filter((event) => event.result === 'granted')
        : events;

  return (
    <>
      <PageHeader
        title="Access"
        subtitle={`${integer(sites.length, locale)} ${sites.length === 1 ? 'site' : 'sites'} · grace after a freeze starts: ${settings.accessGraceHours}h`}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Check-ins, 30 days" value={integer(granted, locale)} />
        <StatTile
          label="Denied"
          value={`${integer(denied, locale)} (${percent(granted + denied === 0 ? 0 : denied / (granted + denied), 1, locale)})`}
          tone={denied > 0 ? 'warn' : 'good'}
        />
        <StatTile
          label="Sites behind"
          value={integer(stale.length, locale)}
          tone={stale.length > 0 ? 'bad' : 'good'}
          hint="No successful sync in 48 hours"
        />
        <StatTile
          label="Changes not pushed"
          value={integer(pending, locale)}
          tone={pending > 0 ? 'warn' : 'good'}
          hint="Waiting on the next successful sync"
        />
      </div>

      {stale.length > 0 && (
        <div className="mb-4">
          <Callout tone="bad" title="A controller is running on a stale allow-list">
            Until it syncs, the door keeps honouring whoever was on the list when it last succeeded.
            That includes members who have since cancelled. The runbook is
            <code> docs/runbooks/access-sync-stuck.md</code>.
          </Callout>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Sync state" className="lg:col-span-2">
          <Table>
            <THead>
              <TR>
                <TH>Site</TH>
                <TH>Vendor</TH>
                <TH>Last success</TH>
                <TH align="right">Pending</TH>
                <TH>Last error</TH>
              </TR>
            </THead>
            <tbody>
              {lag.map((site) => {
                const isStale =
                  site.lastSuccessAt === null ||
                  Date.parse(site.lastSuccessAt) < time.now.getTime() - 48 * 3_600_000;
                return (
                  <TR key={site.siteId}>
                    <TD>{site.siteName}</TD>
                    <TD className="text-ink-muted">{humanise(site.accessProvider)}</TD>
                    <TD>
                      <Badge tone={isStale ? 'bad' : 'good'}>{ago(site.lastSuccessAt, time.now)}</Badge>
                    </TD>
                    <TD align="right">
                      {site.pendingChanges === 0 ? (
                        <span className="text-ink-muted">0</span>
                      ) : (
                        <Badge tone="warn">{integer(site.pendingChanges, locale)}</Badge>
                      )}
                    </TD>
                    <TD className="text-ink-muted">{site.lastError ?? '-'}</TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
          <p className="mt-3 text-ink-muted">
            The nightly job pushes a list covering today plus {SYNC_WINDOW_DAYS} days, so one missed
            night is invisible and a change takes up to a day to reach the door.
          </p>
        </Card>

        <Card title="Why people are turned away, 30 days">
          {denials.length === 0 ? (
            <EmptyState title="Nobody was denied" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Reason</TH>
                  <TH align="right">Events</TH>
                </TR>
              </THead>
              <tbody>
                {denials.map((row) => (
                  <TR key={row.reason}>
                    <TD>{humanise(row.reason)}</TD>
                    <TD align="right">{integer(row.n, locale)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
          <p className="mt-3 text-ink-muted">
            A cancelled membership is refused from the day after it ends. Grace applies to a freeze
            starting, never to a cancellation.
          </p>
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Check-ins by site, 30 days">
          {byLocation.length === 0 ? (
            <EmptyState title="No check-ins in the window" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Site</TH>
                  <TH align="right">Granted</TH>
                  <TH align="right">Denied</TH>
                  <TH align="right">Frozen</TH>
                  <TH align="right">Membership ended</TH>
                  <TH align="right">Unknown card</TH>
                </TR>
              </THead>
              <tbody>
                {byLocation.map((row) => (
                  <TR key={row.siteId}>
                    <TD>{row.siteName}</TD>
                    <TD align="right">{integer(row.granted, locale)}</TD>
                    <TD align="right">{integer(row.denied, locale)}</TD>
                    <TD align="right">{integer(row.deniedFrozen, locale)}</TD>
                    <TD align="right">{integer(row.deniedEnded, locale)}</TD>
                    <TD align="right">{integer(row.deniedUnknownCard, locale)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card
          title="Recent events"
          actions={
            <form className="flex items-center gap-2">
              <Select name="site" defaultValue={siteFilter ?? ''} aria-label="Site">
                <option value="">All sites</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </Select>
              <Select name="result" defaultValue={params.result ?? ''} aria-label="Result">
                <option value="">Granted and denied</option>
                <option value="granted">Granted only</option>
                <option value="denied">Denied only</option>
              </Select>
              <button
                type="submit"
                className="rounded border border-line bg-surface-raised px-2.5 py-1.5 font-medium hover:bg-accent-soft"
              >
                Filter
              </button>
            </form>
          }
        >
          {filtered.length === 0 ? (
            <EmptyState title="Nothing matches" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Local day</TH>
                  <TH>Site</TH>
                  <TH>Member</TH>
                  <TH>Card</TH>
                  <TH>Result</TH>
                  <TH>Source</TH>
                </TR>
              </THead>
              <tbody>
                {filtered.map((event) => {
                  const site = siteNames.get(event.siteId);
                  return (
                    <TR key={event.id}>
                      <TD className="whitespace-nowrap">
                        {instant(event.at, site?.timezone ?? tenantTimezone, locale)}
                      </TD>
                      <TD mono className="text-ink-muted">
                        {event.localDay}
                      </TD>
                      <TD>{site?.name ?? event.siteId}</TD>
                      <TD>
                        {event.memberId === null ? (
                          <span className="text-ink-muted">unknown</span>
                        ) : (
                          <Link href={`/app/members/${event.memberId}`} className="text-accent">
                            View member
                          </Link>
                        )}
                      </TD>
                      <TD mono className="text-ink-muted">
                        {event.cardId ?? '-'}
                      </TD>
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
          <p className="mt-3 text-ink-muted">
            The local day column is the day the site files the event under, decided by the hardware
            adapter. It is what every access report groups by.
          </p>
        </Card>
      </div>
    </>
  );
}
