/**
 * Settings.
 *
 * Everything an operator configures, on one page, with the value that applies
 * shown next to whether it is theirs or the default. That distinction is the
 * whole point: most operators have overridden nothing, so "the default" is a
 * live setting for them, not a fallback.
 */

import {
  Badge,
  Callout,
  Card,
  EmptyState,
  PageHeader,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@/components/ui';
import { SettingsForm } from './settings-form';
import { FlagToggles } from './flag-toggles';
import { NotAllowed } from '@/components/layout/not-allowed';
import { activeTenant, can, getSession, tenantScopeFor } from '@/lib/session';
import { clock } from '@/lib/clock';
import { amount, ago, date as formatDate, humanise, instant, integer } from '@/lib/format';
import * as tenantsRepo from '@/db/repositories/tenants';
import * as subscriptionsRepo from '@/db/repositories/subscriptions';
import { listOutbox } from '@/db/repositories/observability';
import { tenantSettings, users } from '@/db/schema';
import { and, asc, eq } from 'drizzle-orm';
import { DEFAULT_SETTINGS, FEATURE_FLAGS } from '@/domain/tenant-settings';
import { retrySchedule } from '@/domain/retry-policy';
import type { PlainDate } from '@/domain/dates';
import { timezoneForCountry } from '@/jobs/runner';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await getSession();
  const tenant = activeTenant(session);
  if (tenant === null) return null;
  if (!can(session, 'settings.read')) {
    return <NotAllowed title="Settings" role={session.user.role} what="see settings" />;
  }

  const scope = tenantScopeFor(session);
  const time = clock();
  const timezone = timezoneForCountry(tenant.country);
  const today = time.today(timezone);
  const locale = tenant.locale;

  const settings = tenantsRepo.getSettings(scope);
  const sites = tenantsRepo.listSites(scope);
  const plans = subscriptionsRepo.listPlans(scope);
  const staff = scope.db
    .select()
    .from(users)
    .where(and(eq(users.tenantId, scope.tenantId), eq(users.role, 'owner')))
    .all()
    .concat(
      scope.db
        .select()
        .from(users)
        .where(and(eq(users.tenantId, scope.tenantId), eq(users.role, 'site_manager')))
        .all(),
    )
    .concat(
      scope.db
        .select()
        .from(users)
        .where(and(eq(users.tenantId, scope.tenantId), eq(users.role, 'front_desk')))
        .all(),
    );

  const overrides = new Map(
    scope.db
      .select()
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, scope.tenantId))
      .orderBy(asc(tenantSettings.key))
      .all()
      .map((row) => [row.key, row]),
  );

  const outbox = listOutbox(scope, { limit: 25 });
  const editable = can(session, 'settings.write');
  const siteNames = new Map(sites.map((site) => [site.id, site.name]));

  const numeric = [
    {
      key: 'retry_attempts',
      label: 'Retry attempts',
      value: settings.retryAttempts,
      fallback: DEFAULT_SETTINGS.retryAttempts,
      hint: 'Total attempts per charge, including the first.',
    },
    {
      key: 'retry_interval_days',
      label: 'Days between retries',
      value: settings.retryIntervalDays,
      fallback: DEFAULT_SETTINGS.retryIntervalDays,
      hint: 'Most failures are a salary that lands on the 25th.',
    },
    {
      key: 'notice_period_days',
      label: 'Notice period, days',
      value: settings.noticePeriodDays,
      fallback: DEFAULT_SETTINGS.noticePeriodDays,
      hint: 'From the day the member gives notice.',
    },
    {
      key: 'access_grace_hours',
      label: 'Access grace, hours',
      value: settings.accessGraceHours,
      fallback: DEFAULT_SETTINGS.accessGraceHours,
      hint: 'Applies when a freeze starts. Never to a cancellation.',
    },
    {
      key: 'max_freeze_months',
      label: 'Longest single freeze, months',
      value: settings.maxFreezeMonths,
      fallback: DEFAULT_SETTINGS.maxFreezeMonths,
    },
    {
      key: 'max_freeze_months_per_year',
      label: 'Frozen months allowed per year',
      value: settings.maxFreezeMonthsPerYear,
      fallback: DEFAULT_SETTINGS.maxFreezeMonthsPerYear,
    },
  ];

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle={`${tenant.name} · ${tenant.country} · ${tenant.currency} · ${tenant.locale}`}
        actions={<Badge tone="info">{humanise(tenant.planTier)}</Badge>}
      />

      {!editable && (
        <div className="mb-4">
          <Callout tone="neutral">
            Read-only.{' '}
            {session.isBeefcakeStaff
              ? 'Impersonation never writes.'
              : 'Only the owner can change settings.'}
          </Callout>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Payments and memberships">
          <SettingsForm settings={numeric} editable={editable} overridden={[...overrides.keys()]} />
          <hr className="my-4 border-line" />
          <p className="text-ink-muted">
            With the current policy, a charge that fails on the {today.slice(8)}th is retried on{' '}
            {retrySchedule(today as PlainDate, {
              retryAttempts: settings.retryAttempts,
              retryIntervalDays: settings.retryIntervalDays,
            })
              .slice(1)
              .map((day) => formatDate(day, locale))
              .join(', ') || 'never'}
            , then given up on.
          </p>
        </Card>

        <Card title="Feature flags">
          <FlagToggles
            flags={FEATURE_FLAGS.map((flag) => ({
              key: flag,
              label: humanise(flag),
              enabled: settings.flags[flag],
              overridden: overrides.has(`flag_${flag}`),
            }))}
            editable={editable}
          />
          <p className="mt-3 text-ink-muted">
            Flags are per tenant. Beefcake staff can also change these from admin.
          </p>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title={`Sites (${sites.length})`}>
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>City</TH>
                <TH>Timezone</TH>
                <TH>Hardware</TH>
                <TH align="right">Opened</TH>
              </TR>
            </THead>
            <tbody>
              {sites.map((site) => (
                <TR key={site.id}>
                  <TD>{site.name}</TD>
                  <TD className="text-ink-muted">{site.city}</TD>
                  <TD mono className="text-ink-muted">
                    {site.timezone}
                  </TD>
                  <TD>{humanise(site.accessProvider)}</TD>
                  <TD align="right" className="whitespace-nowrap">
                    {formatDate(site.openedOn as PlainDate, locale)}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
          <p className="mt-3 text-ink-muted">
            Every site carries its own timezone. It is what every calendar decision about events at
            that site uses.
          </p>
        </Card>

        <Card title={`Plans (${plans.length})`}>
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH align="right">Price</TH>
                <TH align="right">Binding</TH>
                <TH>Sites</TH>
                <TH>Active</TH>
              </TR>
            </THead>
            <tbody>
              {plans.map((plan) => (
                <TR key={plan.id}>
                  <TD>{plan.name}</TD>
                  <TD align="right" mono>
                    {amount(plan.priceMinor, plan.currency, locale)}
                  </TD>
                  <TD align="right">
                    {plan.bindingMonths === 0 ? (
                      <span className="text-ink-muted">none</span>
                    ) : (
                      `${plan.bindingMonths} months`
                    )}
                  </TD>
                  <TD>{humanise(plan.sitesScope)}</TD>
                  <TD>
                    <Badge tone={plan.active ? 'good' : 'neutral'}>{plan.active ? 'Yes' : 'No'}</Badge>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title={`Staff (${staff.length})`}>
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Role</TH>
                <TH>Site</TH>
                <TH>Email</TH>
              </TR>
            </THead>
            <tbody>
              {staff.map((person) => (
                <TR key={person.id}>
                  <TD>{person.name}</TD>
                  <TD>{humanise(person.role)}</TD>
                  <TD className="text-ink-muted">
                    {person.siteId === null ? 'All sites' : (siteNames.get(person.siteId) ?? '-')}
                  </TD>
                  <TD className="text-ink-muted">{person.email}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card title="Integrations">
          <Table>
            <THead>
              <TR>
                <TH>System</TH>
                <TH>Used for</TH>
                <TH>State</TH>
              </TR>
            </THead>
            <tbody>
              <TR>
                <TD>Beefcake Pay</TD>
                <TD className="text-ink-muted">
                  {tenant.country === 'SE'
                    ? 'Autogiro'
                    : tenant.country === 'NO'
                      ? 'AvtaleGiro'
                      : 'Card'}
                </TD>
                <TD>
                  <Badge tone="good">Connected</Badge>
                </TD>
              </TR>
              {[...new Set(sites.map((site) => site.accessProvider))].map((provider) => (
                <TR key={provider}>
                  <TD>{humanise(provider)}</TD>
                  <TD className="text-ink-muted">
                    Door controllers at{' '}
                    {integer(sites.filter((site) => site.accessProvider === provider).length, locale)}{' '}
                    site(s)
                  </TD>
                  <TD>
                    <Badge tone="good">Connected</Badge>
                  </TD>
                </TR>
              ))}
              <TR>
                <TD>Email and SMS</TD>
                <TD className="text-ink-muted">Receipts, failures, freezes, waitlists</TD>
                <TD>
                  <Badge tone="good">Connected</Badge>
                </TD>
              </TR>
              <TR>
                <TD>MobilePay</TD>
                <TD className="text-ink-muted">Denmark</TD>
                <TD>
                  <Badge tone="neutral">Not available</Badge>
                </TD>
              </TR>
              <TR>
                <TD>Vipps</TD>
                <TD className="text-ink-muted">Norway</TD>
                <TD>
                  <Badge tone="neutral">Not available</Badge>
                </TD>
              </TR>
            </tbody>
          </Table>
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Notification log">
          {outbox.length === 0 ? (
            <EmptyState title="Nothing sent recently" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Channel</TH>
                  <TH>Template</TH>
                  <TH>To</TH>
                  <TH>State</TH>
                </TR>
              </THead>
              <tbody>
                {outbox.map((row) => (
                  <TR key={row.id}>
                    <TD className="whitespace-nowrap">{instant(row.at, timezone, locale)}</TD>
                    <TD>{humanise(row.channel)}</TD>
                    <TD>{humanise(row.template)}</TD>
                    <TD className="text-ink-muted">{row.recipient ?? '-'}</TD>
                    <TD>
                      <Badge tone={row.status === 'sent' ? 'good' : row.status === 'failed' ? 'bad' : 'warn'}>
                        {humanise(row.status)}
                      </Badge>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
          <p className="mt-3 text-ink-muted">
            Last updated {ago(outbox[0]?.at ?? null, time.now)}. Nothing actually leaves this
            environment: the gateways write here instead.
          </p>
        </Card>
      </div>
    </>
  );
}
