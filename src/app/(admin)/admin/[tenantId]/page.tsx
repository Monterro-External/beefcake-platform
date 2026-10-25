/**
 * One tenant, as our own support and CS team see them.
 *
 * The screen somebody opens with the operator on the phone. Configuration,
 * because half of support is "what is your notice period set to". Integration
 * state, because the other half is "the doors are not working". Errors, because
 * the third half is "is it just us".
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Card, DefinitionList, EmptyState, Meter, PageHeader, StatTile, TD, TH, THead, TR, Table } from '@/components/ui';
import { ImpersonateButton } from './impersonate-button';
import { AdminFlagToggles } from './admin-flags';
import { getDb } from '@/db/client';
import { adminScope, tenantScope } from '@/db/repositories/scope';
import * as paymentsRepo from '@/db/repositories/payments';
import * as tenantsRepo from '@/db/repositories/tenants';
import { listErrors } from '@/db/repositories/observability';
import * as reports from '@/export/reports';
import { clock } from '@/lib/clock';
import { ago, amount, amountCompact, date as formatDate, humanise, instant, integer, percent, period as formatPeriod } from '@/lib/format';
import { getSession } from '@/lib/session';
import { DEFAULT_SETTINGS, FEATURE_FLAGS } from '@/domain/tenant-settings';
import { tenantSettings, tenants } from '@/db/schema';
import { eq } from 'drizzle-orm';
import type { PlainDate } from '@/domain/dates';
import { timezoneForCountry } from '@/jobs/runner';

export const dynamic = 'force-dynamic';

export default async function AdminTenantPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const session = await getSession();
  if (!session.isBeefcakeStaff) return null;

  const db = getDb();
  const admin = adminScope({ db, actorId: session.user.id });
  const tenant = db.select().from(tenants).where(eq(tenants.id, tenantId)).get();
  if (tenant === undefined) notFound();

  const scope = tenantScope(tenant.id, { db });
  const time = clock();
  const timezone = timezoneForCountry(tenant.country);
  const today = time.today(timezone);
  const locale = tenant.locale;

  const settings = tenantsRepo.getSettings(scope);
  const overrides = new Set(
    db.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenant.id)).all().map((row) => row.key),
  );
  const sites = tenantsRepo.listSites(scope);
  const health = reports.tenantHealth(scope, today, time.now);
  const revenue = reports.revenueByPeriod(scope, 6);
  const lag = reports.syncLagBySite(scope);
  const churn = reports.churnByWeek(scope, reports.windowOfDays(today, 84));
  const dunning = paymentsRepo.listOpenDunning(scope, { limit: 25 });
  // eslint-disable-next-line no-restricted-syntax -- BCPLA-26: 30-day error window starts at UTC midnight
  const errors = listErrors(scope, { since: `${reports.windowOfDays(today, 30).from}T00:00:00.000Z`, limit: 20 });

  const lastRun = revenue[revenue.length - 1] ?? null;
  const recentChurn = churn.slice(-4).reduce((acc, row) => acc + row.cancellations, 0);
  const paymentChurn = churn.slice(-4).reduce((acc, row) => acc + row.paymentDriven, 0);
  void admin;

  return (
    <>
      <PageHeader
        title={tenant.name}
        subtitle={
          <>
            {humanise(tenant.segment)} · {humanise(tenant.planTier)} · {tenant.country} ·{' '}
            {tenant.currency} · org {tenant.orgNumber} · customer since{' '}
            {formatDate(tenant.createdAt.slice(0, 10) as PlainDate, locale)}
          </>
        }
        actions={
          <>
            <Badge
              tone={
                health.score.band === 'green' ? 'good' : health.score.band === 'amber' ? 'warn' : 'bad'
              }
            >
              Health {health.score.score}
            </Badge>
            <ImpersonateButton tenantId={tenant.id} tenantName={tenant.name} />
            <Link href="/admin" className="text-accent">
              All tenants
            </Link>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Active members" value={integer(health.activeMembers, locale)} hint={`${sites.length} sites`} />
        <StatTile
          label="Failed payments"
          value={percent(health.inputs.failedPaymentRate, 1, locale)}
          tone={health.inputs.failedPaymentRate > 0.08 ? 'bad' : health.inputs.failedPaymentRate > 0.05 ? 'warn' : 'good'}
          hint={lastRun === null ? undefined : `on ${formatPeriod(lastRun.period, locale)}`}
        />
        <StatTile
          label="Cancellations, 4 weeks"
          value={integer(recentChurn, locale)}
          tone={recentChurn > 0 && paymentChurn / Math.max(1, recentChurn) > 0.3 ? 'bad' : 'neutral'}
          hint={`${integer(paymentChurn, locale)} after a failed payment`}
        />
        <StatTile
          label="Collected last run"
          value={lastRun === null ? '-' : amountCompact(lastRun.succeededMinor, lastRun.currency, locale)}
          hint={lastRun === null ? undefined : `${integer(lastRun.charges, locale)} charges`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Configuration">
          <DefinitionList
            items={[
              { label: 'Retry attempts', value: <SettingValue value={settings.retryAttempts} fallback={DEFAULT_SETTINGS.retryAttempts} overridden={overrides.has('retry_attempts')} /> },
              { label: 'Retry interval, days', value: <SettingValue value={settings.retryIntervalDays} fallback={DEFAULT_SETTINGS.retryIntervalDays} overridden={overrides.has('retry_interval_days')} /> },
              { label: 'Notice period, days', value: <SettingValue value={settings.noticePeriodDays} fallback={DEFAULT_SETTINGS.noticePeriodDays} overridden={overrides.has('notice_period_days')} /> },
              { label: 'Access grace, hours', value: <SettingValue value={settings.accessGraceHours} fallback={DEFAULT_SETTINGS.accessGraceHours} overridden={overrides.has('access_grace_hours')} /> },
              { label: 'Max freeze, months', value: <SettingValue value={settings.maxFreezeMonths} fallback={DEFAULT_SETTINGS.maxFreezeMonths} overridden={overrides.has('max_freeze_months')} /> },
              { label: 'Bills to period end', value: settings.billToEndOfPeriod ? 'Yes' : 'No' },
              { label: 'Invoice currency', value: settings.invoiceCurrency ?? `${tenant.currency} (own)` },
            ]}
          />
          <p className="mt-3 text-ink-muted">
            Values marked default are not stored for this tenant. A change to the platform default
            reaches them immediately.
          </p>
        </Card>

        <Card title="Feature flags">
          <AdminFlagToggles
            tenantId={tenant.id}
            flags={FEATURE_FLAGS.map((flag) => ({
              key: flag,
              label: humanise(flag),
              enabled: settings.flags[flag],
              overridden: overrides.has(`flag_${flag}`),
            }))}
          />
        </Card>

        <Card title="Health inputs">
          <ul className="space-y-2.5">
            {health.score.components.map((component) => (
              <li key={component.key}>
                <div className="flex items-baseline justify-between gap-2">
                  <span>{component.label}</span>
                  <span className="tabular-nums text-ink-muted">{percent(component.score, 0, locale)}</span>
                </div>
                <div className="mt-1">
                  <Meter
                    value={component.score}
                    tone={component.score > 0.7 ? 'good' : component.score < 0.4 ? 'bad' : 'warn'}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Integration state">
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
                const stale =
                  site.lastSuccessAt === null ||
                  Date.parse(site.lastSuccessAt) < time.now.getTime() - 48 * 3_600_000;
                return (
                  <TR key={site.siteId}>
                    <TD>{site.siteName}</TD>
                    <TD className="text-ink-muted">{humanise(site.accessProvider)}</TD>
                    <TD>
                      <Badge tone={stale ? 'bad' : 'good'}>{ago(site.lastSuccessAt, time.now)}</Badge>
                    </TD>
                    <TD align="right">{integer(site.pendingChanges, locale)}</TD>
                    <TD className="text-ink-muted">{site.lastError ?? '-'}</TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        </Card>

        <Card title="Errors, last 30 days">
          {errors.length === 0 ? (
            <EmptyState title="Nothing logged" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Module</TH>
                  <TH>Message</TH>
                </TR>
              </THead>
              <tbody>
                {errors.map((error) => (
                  <TR key={error.id}>
                    <TD className="whitespace-nowrap text-ink-muted">
                      {instant(error.at, timezone, locale)}
                    </TD>
                    <TD mono>{error.where}</TD>
                    <TD className="max-w-md truncate" title={error.message}>
                      {error.message}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card title={`Open dunning (${dunning.length})`}>
          {dunning.length === 0 ? (
            <EmptyState title="Everyone is paid up" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Member</TH>
                  <TH align="right">Amount</TH>
                  <TH>Reason</TH>
                  <TH align="right">Attempt</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <tbody>
                {dunning.map((row) => (
                  <TR key={row.chargeId}>
                    <TD>{row.memberName}</TD>
                    <TD align="right" mono>
                      {amount(row.amountMinor, row.currency, locale)}
                    </TD>
                    <TD>{humanise(row.failureCode)}</TD>
                    <TD align="right">{row.attempt}</TD>
                    <TD>
                      <Badge tone={row.status === 'abandoned' ? 'bad' : 'warn'}>
                        {humanise(row.status)}
                      </Badge>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}

function SettingValue({
  value,
  fallback,
  overridden,
}: {
  value: number;
  fallback: number;
  overridden: boolean;
}) {
  return (
    <>
      <span className="tabular-nums">{value}</span>{' '}
      {overridden ? (
        <Badge tone="info">set</Badge>
      ) : (
        <Badge tone="neutral">default {fallback}</Badge>
      )}
    </>
  );
}
