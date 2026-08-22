/**
 * Reports.
 *
 * The reports an operator actually uses, in the order they matter: churn, then
 * revenue, then failed payments, then classes. Each one exports to CSV, because
 * the first thing a finance team does with a number is put it in a spreadsheet.
 *
 * The churn table has one column nobody asks for and everybody needs: how long
 * after a failed payment the member left. Reading churn without it produces the
 * wrong conclusion every time.
 */

import Link from 'next/link';
import {
  BarSeries,
  Badge,
  Callout,
  Card,
  EmptyState,
  LinkButton,
  Meter,
  PageHeader,
  Select,
  StatTile,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@/components/ui';
import { NotAllowed } from '@/components/layout/not-allowed';
import { activeTenant, can, getSession, tenantScopeFor } from '@/lib/session';
import { clock } from '@/lib/clock';
import {
  amount,
  amountCompact,
  humanise,
  integer,
  percent,
  period as formatPeriod,
} from '@/lib/format';
import * as reports from '@/export/reports';
import { recordError } from '@/db/repositories/observability';
import { addBillingPeriods } from '@/domain/dates';
import { periodForRunDay } from '@/jobs/payment-run';
import { timezoneForCountry } from '@/jobs/runner';

export const dynamic = 'force-dynamic';

const WINDOWS = [30, 90, 180, 365] as const;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const params = await searchParams;
  const session = await getSession();
  const tenant = activeTenant(session);
  if (tenant === null) return null;
  if (!can(session, 'reports.read')) {
    return <NotAllowed title="Reports" role={session.user.role} what="see reports" />;
  }

  const scope = tenantScopeFor(session);
  const time = clock();
  const today = time.today(timezoneForCountry(tenant.country));
  const locale = tenant.locale;

  const requested = Number.parseInt(params.days ?? '90', 10);
  const days = (WINDOWS as readonly number[]).includes(requested) ? requested : 90;
  const window = reports.windowOfDays(today, days);

  const membership = reports.membershipSummary(scope, window);
  const churn = reports.churnByWeek(scope, window);

  // The detail view is heavier than the weekly roll-up. If it does not finish,
  // show the roll-up rather than an empty page, and record it so somebody looks.
  let churnDetail: reports.ChurnDetailRow[] = [];
  let churnDetailFailed: string | null = null;
  try {
    churnDetail = reports.churnWithPaymentLag(scope, window);
  } catch (error) {
    if (!(error instanceof reports.ReportTimeoutError)) throw error;
    churnDetailFailed = error.message;
    recordError(scope, {
      where: 'export/reports',
      message: error.message,
      severity: 'error',
      context: { report: 'churn', members: membership.active, days },
      at: time.now.toISOString(),
    });
  }
  const revenue = reports.revenueByPeriod(scope, 18);
  const codes = reports.failedPaymentsByCode(scope, addBillingPeriods(periodForRunDay(today), -5));
  const fill = reports.classFillBySite(scope, window);
  const health = reports.tenantHealth(scope, today);

  const paymentDrivenLags = churnDetail
    .filter((row) => row.reason === 'payment_failure' && row.daysSinceLastFailedPayment !== null)
    .map((row) => row.daysSinceLastFailedPayment as number)
    .sort((a, b) => a - b);
  const otherLags = churnDetail
    .filter((row) => row.reason !== 'payment_failure' && row.daysSinceLastFailedPayment !== null)
    .map((row) => row.daysSinceLastFailedPayment as number)
    .sort((a, b) => a - b);
  const medianOf = (values: number[]): number | null =>
    values.length === 0 ? null : (values[Math.floor(values.length / 2)] as number);

  const totalCancellations = churnDetail.length;
  const paymentDriven = churnDetail.filter((row) => row.reason === 'payment_failure').length;
  const churnRate = membership.active === 0 ? 0 : totalCancellations / membership.active;

  const byCode = new Map<string, number>();
  for (const row of codes) byCode.set(row.failureCode, (byCode.get(row.failureCode) ?? 0) + row.charges);

  const exportable = can(session, 'reports.export');

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle={`${window.from} to ${window.to}`}
        actions={
          <form className="flex items-center gap-2">
            <Select name="days" defaultValue={String(days)} aria-label="Window">
              {WINDOWS.map((option) => (
                <option key={option} value={option}>
                  Last {option} days
                </option>
              ))}
            </Select>
            <button
              type="submit"
              className="rounded border border-line bg-surface-raised px-2.5 py-1.5 font-medium hover:bg-accent-soft"
            >
              Apply
            </button>
          </form>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Cancellations"
          value={integer(totalCancellations, locale)}
          tone={churnRate > 0.1 ? 'bad' : churnRate > 0.05 ? 'warn' : 'good'}
          hint={`${percent(churnRate, 1, locale)} of the active base`}
        />
        <StatTile
          label="After a failed payment"
          value={integer(paymentDriven, locale)}
          tone={paymentDriven > 0 ? 'warn' : 'good'}
          hint={
            totalCancellations === 0
              ? undefined
              : `${percent(paymentDriven / totalCancellations, 0, locale)} of all cancellations`
          }
        />
        <StatTile
          label="Median lag"
          value={medianOf(paymentDrivenLags) === null ? '-' : `${medianOf(paymentDrivenLags)} days`}
          hint="Between the last failed charge and giving notice"
        />
        <StatTile
          label="Health"
          value={health.score.score}
          tone={health.score.band === 'green' ? 'good' : health.score.band === 'amber' ? 'warn' : 'bad'}
          hint={humanise(health.score.band)}
        />
      </div>

      {churnDetailFailed !== null && (
        <div className="mb-4">
          <Callout tone="bad" title="The churn detail did not finish">
            {churnDetailFailed}. The weekly figures below are still correct. Narrow the window and
            try again, or take the CSV export instead.
          </Callout>
        </div>
      )}

      {paymentDrivenLags.length > 5 && (
        <div className="mb-4">
          <Callout tone="info" title="Churn follows the payment run, not the calendar">
            Members whose dunning ran out leave a median of{' '}
            <strong>{medianOf(paymentDrivenLags)} days</strong> later. Everyone else who ever had a
            failed charge leaves a median of{' '}
            <strong>{medianOf(otherLags) ?? '-'} days</strong> after theirs, which is to say the
            timing is unrelated. Reducing failed payments is a churn intervention.
          </Callout>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Churn by week"
          actions={
            exportable ? (
              <Link href={`/app/reports/export/churn?days=${days}`} className="text-accent">
                CSV
              </Link>
            ) : undefined
          }
        >
          {churn.length === 0 ? (
            <EmptyState title="Nobody cancelled in this window" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Week</TH>
                  <TH align="right">Cancellations</TH>
                  <TH align="right">After failed payment</TH>
                  <TH align="right">Voluntary</TH>
                </TR>
              </THead>
              <tbody>
                {churn.map((row) => (
                  <TR key={row.week}>
                    <TD mono>{row.week}</TD>
                    <TD align="right">{integer(row.cancellations, locale)}</TD>
                    <TD align="right">
                      {row.paymentDriven === 0 ? (
                        <span className="text-ink-muted">0</span>
                      ) : (
                        <Badge tone="bad">{integer(row.paymentDriven, locale)}</Badge>
                      )}
                    </TD>
                    <TD align="right">{integer(row.voluntary, locale)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="Why members leave">
          {churnDetail.length === 0 ? (
            <EmptyState title="Nothing to explain" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Reason</TH>
                  <TH align="right">Members</TH>
                  <TH align="right">Median tenure</TH>
                  <TH align="right">Median lag after a failure</TH>
                </TR>
              </THead>
              <tbody>
                {groupByReason(churnDetail).map((row) => (
                  <TR key={row.reason}>
                    <TD>{humanise(row.reason)}</TD>
                    <TD align="right">{integer(row.count, locale)}</TD>
                    <TD align="right">{Math.round(row.medianTenure / 30)} months</TD>
                    <TD align="right">{row.medianLag === null ? '-' : `${row.medianLag} days`}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card
          title="Collected per month"
          className="lg:col-span-2"
          actions={
            exportable ? (
              <Link href="/app/reports/export/revenue" className="text-accent">
                CSV
              </Link>
            ) : undefined
          }
        >
          {revenue.length === 0 ? (
            <EmptyState title="No payment runs" />
          ) : (
            <>
              <BarSeries
                bars={revenue.map((row) => ({
                  label: formatPeriod(row.period, locale).replace(` ${row.period.slice(0, 4)}`, ''),
                  value: row.succeededMinor,
                  secondary: row.failedMinor,
                }))}
                format={(value) => amountCompact(value, tenant.currency, locale)}
              />
              <Table className="mt-4">
                <THead>
                  <TR>
                    <TH>Period</TH>
                    <TH align="right">Charges</TH>
                    <TH align="right">Failed</TH>
                    <TH align="right">Failure rate</TH>
                    <TH align="right">Collected</TH>
                    <TH align="right">Missed</TH>
                  </TR>
                </THead>
                <tbody>
                  {[...revenue].reverse().slice(0, 8).map((row) => (
                    <TR key={row.period}>
                      <TD>{formatPeriod(row.period, locale)}</TD>
                      <TD align="right">{integer(row.charges, locale)}</TD>
                      <TD align="right">{integer(row.failedCharges, locale)}</TD>
                      <TD align="right">
                        {percent(row.charges === 0 ? 0 : row.failedCharges / row.charges, 1, locale)}
                      </TD>
                      <TD align="right" mono>
                        {amount(row.succeededMinor, row.currency, locale)}
                      </TD>
                      <TD align="right" mono className="text-bad">
                        {amount(row.failedMinor, row.currency, locale)}
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </>
          )}
        </Card>

        <Card title="Health inputs">
          <ul className="space-y-3">
            {health.score.components.map((component) => (
              <li key={component.key}>
                <div className="flex items-baseline justify-between gap-3">
                  <span>{component.label}</span>
                  <span className="tabular-nums text-ink-muted">
                    {percent(component.score, 0, locale)} of {percent(component.weight, 0, locale)}
                  </span>
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
          <p className="mt-3 text-ink-muted">
            Platform inputs only. Support tickets and NPS live elsewhere and are joined in downstream.
          </p>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card
          title="Failed payments by reason, last six months"
          actions={
            exportable ? (
              <Link href="/app/reports/export/failed-payments" className="text-accent">
                CSV
              </Link>
            ) : undefined
          }
        >
          {byCode.size === 0 ? (
            <EmptyState title="Nothing failed" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Reason</TH>
                  <TH align="right">Charges</TH>
                  <TH>Retryable</TH>
                </TR>
              </THead>
              <tbody>
                {[...byCode]
                  .sort(([, a], [, b]) => b - a)
                  .map(([code, n]) => (
                    <TR key={code}>
                      <TD>{humanise(code)}</TD>
                      <TD align="right">{integer(n, locale)}</TD>
                      <TD>
                        {code === 'mandate_cancelled' || code === 'account_closed' ? (
                          <Badge tone="bad">No</Badge>
                        ) : (
                          <Badge tone="good">Yes</Badge>
                        )}
                      </TD>
                    </TR>
                  ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card
          title="Class fill by site"
          actions={
            exportable ? (
              <Link href={`/app/reports/export/classes?days=${days}`} className="text-accent">
                CSV
              </Link>
            ) : undefined
          }
        >
          {fill.length === 0 ? (
            <EmptyState title="No classes in this window" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Site</TH>
                  <TH align="right">Classes</TH>
                  <TH>Fill</TH>
                  <TH align="right">No-show</TH>
                  <TH align="right">Waitlisted</TH>
                </TR>
              </THead>
              <tbody>
                {fill.map((row) => (
                  <TR key={row.siteId}>
                    <TD>{row.siteName}</TD>
                    <TD align="right">{integer(row.classes, locale)}</TD>
                    <TD className="w-32">
                      <div className="flex items-center gap-2">
                        <Meter value={row.fillRate} tone={row.fillRate > 0.85 ? 'good' : 'info'} />
                        <span className="w-9 text-right tabular-nums text-ink-muted">
                          {percent(row.fillRate, 0, locale)}
                        </span>
                      </div>
                    </TD>
                    <TD align="right">{percent(row.noShowRate, 0, locale)}</TD>
                    <TD align="right">{integer(row.waitlisted, locale)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      {exportable && (
        <div className="mt-4">
          <Card title="Export everything">
            <p className="mb-2 text-ink-muted">
              One CSV per report, for the window above. Large exports at key-account volume take a
              few seconds.
            </p>
            <div className="flex flex-wrap gap-2">
              <LinkButton href={`/app/reports/export/churn?days=${days}`}>Churn</LinkButton>
              <LinkButton href="/app/reports/export/revenue">Revenue</LinkButton>
              <LinkButton href="/app/reports/export/failed-payments">Failed payments</LinkButton>
              <LinkButton href={`/app/reports/export/classes?days=${days}`}>Classes</LinkButton>
              <LinkButton href={`/app/reports/export/members?days=${days}`}>Members</LinkButton>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

interface ReasonRow {
  reason: string;
  count: number;
  medianTenure: number;
  medianLag: number | null;
}

function groupByReason(rows: reports.ChurnDetailRow[]): ReasonRow[] {
  const groups = new Map<string, { tenures: number[]; lags: number[] }>();
  for (const row of rows) {
    const key = row.reason ?? 'other';
    const entry = groups.get(key) ?? { tenures: [], lags: [] };
    entry.tenures.push(row.tenureDays);
    if (row.daysSinceLastFailedPayment !== null) entry.lags.push(row.daysSinceLastFailedPayment);
    groups.set(key, entry);
  }

  const median = (values: number[]): number | null => {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] as number;
  };

  return [...groups]
    .map(([reason, entry]) => ({
      reason,
      count: entry.tenures.length,
      medianTenure: median(entry.tenures) ?? 0,
      medianLag: median(entry.lags),
    }))
    .sort((a, b) => b.count - a.count);
}
