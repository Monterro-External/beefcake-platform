/**
 * Operator overview.
 *
 * What an owner wants when they open the tab: is money coming in, is anyone
 * leaving, are the classes full, is the hardware talking to us. Everything here
 * links to the screen where you would act on it.
 */

import Link from 'next/link';
import {
  BarSeries,
  Badge,
  Callout,
  Card,
  DefinitionList,
  LinkButton,
  Meter,
  PageHeader,
  StatTile,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@/components/ui';
import { activeTenant, can, getSession, tenantScopeFor } from '@/lib/session';
import { clock } from '@/lib/clock';
import { amountCompact, humanise, integer, optionalPercent, percent, period as formatPeriod, ago } from '@/lib/format';
import * as reports from '@/export/reports';
import * as paymentsRepo from '@/db/repositories/payments';
import { timezoneForCountry } from '@/jobs/runner';
import { periodForRunDay, runDayFor } from '@/jobs/payment-run';
import { addBillingPeriods } from '@/domain/dates';
import { date as formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function Overview() {
  const session = await getSession();
  const tenant = activeTenant(session);
  if (tenant === null) return null;

  const scope = tenantScopeFor(session);
  const time = clock();
  const timezone = timezoneForCountry(tenant.country);
  const today = time.today(timezone);
  const locale = tenant.locale;

  // Front desk sees the day job. Money and reports are the owner's and the site
  // manager's, and the tiles below follow the same permissions as the pages.
  const seesPayments = can(session, 'payments.read');
  const seesDunning = can(session, 'dunning.read');
  const seesReports = can(session, 'reports.read');

  const membership = reports.membershipSummary(scope, reports.windowOfDays(today, 30));
  const revenue = reports.revenueByPeriod(scope, 12);
  const lastRun = paymentsRepo.lastCompletedRun(scope);
  // The next run is the first period that has not gone out. Before the 25th
  // that is this month; on or after it, next month.
  const currentPeriod = periodForRunDay(today);
  const nextPeriod =
    paymentsRepo.getRunForPeriod(scope, currentPeriod) === null
      ? currentPeriod
      : addBillingPeriods(currentPeriod, 1);
  const nextRunOn = runDayFor(nextPeriod);
  const nextRunOverdue = nextRunOn <= today;
  const dunning = seesDunning ? reports.openDunning(scope, 8) : [];
  const churn = seesReports ? reports.churnByWeek(scope, reports.windowOfDays(today, 84)) : [];
  const fill = reports.classFillBySite(scope, reports.windowOfDays(today, 30), time.now);
  const lag = reports.syncLagBySite(scope);
  const health = reports.tenantHealth(scope, today, time.now);

  const totalCapacity = fill.reduce((acc, row) => acc + row.capacity, 0);
  const totalBooked = fill.reduce((acc, row) => acc + row.booked, 0);
  const overallFill = totalCapacity === 0 ? 0 : totalBooked / totalCapacity;
  const failedRate =
    lastRun === null || lastRun.chargesAttempted === 0
      ? 0
      : lastRun.chargesFailed / lastRun.chargesAttempted;
  const staleSites = lag.filter(
    (site) => site.lastSuccessAt === null || Date.parse(site.lastSuccessAt) < time.now.getTime() - 48 * 3_600_000,
  );
  const recentChurn = churn.slice(-4);
  const churnTotal = recentChurn.reduce((acc, row) => acc + row.cancellations, 0);
  const churnPayment = recentChurn.reduce((acc, row) => acc + row.paymentDriven, 0);

  return (
    <>
      <PageHeader
        title={tenant.name}
        subtitle={
          <>
            {integer(membership.active, locale)} active members across {lag.length}{' '}
            {lag.length === 1 ? 'site' : 'sites'} · {humanise(tenant.segment)} ·{' '}
            {tenant.currency}
          </>
        }
        actions={seesReports ? <LinkButton href="/app/reports">Reports</LinkButton> : undefined}
      />

      {time.pinned && (
        <Callout tone="neutral" title="Development clock">
          This environment treats <strong>{formatDate(today, locale)}</strong> as today, because that is
          the date the local database was seeded for. Pass <code>--today</code> to{' '}
          <code>npm run db:reset</code> to move it.
        </Callout>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Active members"
          value={integer(membership.active, locale)}
          hint={`${integer(membership.joinedInWindow, locale)} joined, ${integer(membership.leftInWindow, locale)} left in 30 days`}
        />
        {seesPayments && (
        <StatTile
          label="Failed on last run"
          value={percent(failedRate, 1, locale)}
          tone={failedRate > 0.08 ? 'bad' : failedRate > 0.05 ? 'warn' : 'good'}
          hint={
            lastRun === null
              ? 'No run yet'
              : `${integer(lastRun.chargesFailed, locale)} of ${integer(lastRun.chargesAttempted, locale)} in ${formatPeriod(lastRun.period, locale)}`
          }
        />
        )}
        <StatTile
          label="Class fill, 30 days"
          value={percent(overallFill, 0, locale)}
          tone={overallFill < 0.55 ? 'warn' : 'good'}
          hint={`${integer(totalBooked, locale)} of ${integer(totalCapacity, locale)} places`}
        />
        {seesReports && (
        <StatTile
          label="Health score"
          value={health.score.score}
          tone={health.score.band === 'green' ? 'good' : health.score.band === 'amber' ? 'warn' : 'bad'}
          hint={`${humanise(health.score.band)} · churn ${percent(health.inputs.churnRate90d, 1, locale)} in 90 days`}
        />
        )}
      </div>

      {staleSites.length > 0 && (
        <div className="mt-4">
          <Callout tone="warn" title={`${staleSites.length} site(s) have not synced in 48 hours`}>
            A door controller running on a stale allow-list will keep letting in members whose
            membership has ended.{' '}
            <Link href="/app/access" className="underline">
              Check access sync
            </Link>
            .
          </Callout>
        </div>
      )}

      {seesPayments && (
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card
          title="Collected per month"
          className="lg:col-span-2"
          actions={<Link href="/app/payments" className="text-accent">Payments</Link>}
        >
          {revenue.length === 0 ? (
            <p className="py-6 text-center text-ink-muted">No payment runs yet.</p>
          ) : (
            <BarSeries
              bars={revenue.map((row) => ({
                label: formatPeriod(row.period, locale).replace(` ${row.period.slice(0, 4)}`, ''),
                value: row.succeededMinor,
                secondary: row.failedMinor,
              }))}
              format={(value) => amountCompact(value, tenant.currency, locale)}
            />
          )}
          <p className="mt-2 text-ink-muted">
            Blue is collected, red is the value of first attempts that failed.
          </p>
        </Card>

        <Card title="Payment run">
          <DefinitionList
            items={[
              {
                label: 'Last completed',
                value:
                  lastRun === null ? (
                    '-'
                  ) : (
                    <Link href={`/app/payments/${lastRun.id}`} className="text-accent">
                      {formatPeriod(lastRun.period, locale)}
                    </Link>
                  ),
              },
              {
                label: 'Collected',
                value:
                  lastRun === null ? '-' : amountCompact(lastRun.totalMinor, tenant.currency, locale),
              },
              {
                label: 'Next due',
                value: (
                  <>
                    {formatDate(nextRunOn, locale)}
                    {nextRunOverdue && (
                      <>
                        {' '}
                        <Badge tone="warn">overdue</Badge>
                      </>
                    )}
                  </>
                ),
              },
              {
                label: 'In dunning',
                value: (
                  <Link href="/app/payments#dunning" className="text-accent">
                    {integer(dunning.length, locale)}
                    {dunning.length === 8 ? '+' : ''}
                  </Link>
                ),
              },
              { label: 'Notice given', value: integer(membership.cancelling, locale) },
              { label: 'Frozen', value: integer(membership.frozen, locale) },
            ]}
          />
        </Card>
      </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {seesReports && (
        <Card
          title="Cancellations, last four weeks"
          actions={<Link href="/app/reports" className="text-accent">Churn report</Link>}
        >
          {recentChurn.length === 0 ? (
            <p className="py-4 text-center text-ink-muted">Nobody cancelled. Enjoy it.</p>
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>Week</TH>
                    <TH align="right">Total</TH>
                    <TH align="right">After failed payment</TH>
                    <TH align="right">Voluntary</TH>
                  </TR>
                </THead>
                <tbody>
                  {recentChurn.map((row) => (
                    <TR key={row.week}>
                      <TD mono>{row.week}</TD>
                      <TD align="right">{integer(row.cancellations, locale)}</TD>
                      <TD align="right">
                        {row.paymentDriven > 0 ? (
                          <Badge tone="bad">{integer(row.paymentDriven, locale)}</Badge>
                        ) : (
                          '0'
                        )}
                      </TD>
                      <TD align="right">{integer(row.voluntary, locale)}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
              {churnTotal > 0 && churnPayment / churnTotal > 0.2 && (
                <p className="mt-3 text-ink-muted">
                  {percent(churnPayment / churnTotal, 0, locale)} of recent cancellations follow a
                  payment that ran out of retries.
                </p>
              )}
            </>
          )}
        </Card>
        )}

        <Card
          title="Class fill by site"
          actions={<Link href="/app/classes" className="text-accent">Schedule</Link>}
        >
          {fill.length === 0 ? (
            <p className="py-4 text-center text-ink-muted">No classes in the last 30 days.</p>
          ) : (
            <ul className="space-y-2.5">
              {fill.map((row) => (
                <li key={row.siteId}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span>{row.siteName}</span>
                    <span className="tabular-nums text-ink-muted">
                      {percent(row.fillRate, 0, locale)} · {integer(row.classes, locale)} classes ·{' '}
                      {optionalPercent(row.noShowRate, 0, locale)} no-show
                    </span>
                  </div>
                  <div className="mt-1">
                    <Meter
                      value={row.fillRate}
                      tone={row.fillRate > 0.85 ? 'good' : row.fillRate < 0.5 ? 'warn' : 'info'}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {seesDunning && (
      <div className="mt-4">
        <Card
          title="In dunning now"
          actions={
            seesPayments ? (
              <Link href="/app/payments" className="text-accent">All payments</Link>
            ) : undefined
          }
        >
          {dunning.length === 0 ? (
            <p className="py-4 text-center text-ink-muted">Nothing outstanding.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Member</TH>
                  <TH align="right">Amount</TH>
                  <TH>Reason</TH>
                  <TH align="right">Attempt</TH>
                  <TH>Next attempt</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <tbody>
                {dunning.map((row) => (
                  <TR key={`${row.memberId}-${row.attemptedAt}`}>
                    <TD>
                      <Link href={`/app/members/${row.memberId}`} className="text-accent">
                        {row.memberName}
                      </Link>
                    </TD>
                    <TD align="right" mono>
                      {amountCompact(row.amountMinor, row.currency, locale)}
                    </TD>
                    <TD>{humanise(row.failureCode)}</TD>
                    <TD align="right">{row.attempt}</TD>
                    <TD className="text-ink-muted">
                      {row.status === 'abandoned' ? 'no further attempts' : ago(row.nextAttemptAt, time.now)}
                    </TD>
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
      )}
    </>
  );
}
