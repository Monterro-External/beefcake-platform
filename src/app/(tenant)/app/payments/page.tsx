/**
 * Payments.
 *
 * Two questions, in this order: did the last run collect what it should have,
 * and who is behind. The dunning list is the actionable half and is anchored so
 * the overview can link straight to it.
 *
 * The dunning list carries the same search and filters as the overview card
 * "In dunning now". Unfiltered it lists the 100 newest charges in open dunning,
 * as it always has; filtered it pages through every match 50 at a time. The
 * Outstanding tile and the abandoned callout always read the unfiltered list.
 */

import Link from 'next/link';
import {
  BarSeries,
  Badge,
  Callout,
  Card,
  EmptyState,
  PageHeader,
  Pagination,
  StatTile,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@/components/ui';
import { RunPaymentsButton } from './run-button';
import { NotAllowed } from '@/components/layout/not-allowed';
import { activeTenant, can, getSession, tenantScopeFor } from '@/lib/session';
import { clock } from '@/lib/clock';
import {
  amount,
  amountCompact,
  ago,
  date as formatDate,
  humanise,
  integer,
  percent,
  period as formatPeriod,
} from '@/lib/format';
import * as paymentsRepo from '@/db/repositories/payments';
import * as tenantsRepo from '@/db/repositories/tenants';
import * as reports from '@/export/reports';
import { addBillingPeriods } from '@/domain/dates';
import { periodForRunDay, runDayFor } from '@/jobs/payment-run';
import { timezoneForCountry } from '@/jobs/runner';
import {
  type DunningSearchParams,
  firstParam,
  isFiltered,
  matchingHeading,
  noMatch,
  readDunningFilter,
  siteOptions,
} from '../_dunning/filter';
import { DunningFilters } from '../_dunning/filters';

export const dynamic = 'force-dynamic';

/** Matching charges per page of the filtered dunning list. */
const DUNNING_PAGE_SIZE = 50;

function pageNumber(value: string | string[] | undefined): number {
  return Math.max(1, Number.parseInt(firstParam(value) ?? '', 10) || 1);
}

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<DunningSearchParams> }) {
  const params = await searchParams;
  const session = await getSession();
  const tenant = activeTenant(session);
  if (tenant === null) return null;
  if (!can(session, 'payments.read')) {
    return <NotAllowed title="Payments" role={session.user.role} what="see payment runs and dunning" />;
  }

  const scope = tenantScopeFor(session);
  const time = clock();
  const today = time.today(timezoneForCountry(tenant.country));
  const locale = tenant.locale;

  const runs = paymentsRepo.listRuns(scope, 18);
  const lastRun = paymentsRepo.lastCompletedRun(scope);
  const revenue = reports.revenueByPeriod(scope, 12);
  // Unfiltered: the 100 newest charges in open dunning. They also feed the
  // Outstanding tile and the abandoned callout, whatever the list is filtered by.
  const dunning = reports.openDunning(scope, 100);
  const requestedDunning = readDunningFilter(params);
  const requestedPage = pageNumber(params.page);
  const pageOf = (page: number) =>
    reports.openDunning(scope, {
      ...requestedDunning,
      limit: DUNNING_PAGE_SIZE,
      offset: (page - 1) * DUNNING_PAGE_SIZE,
    });
  let matching = pageOf(requestedPage);
  // A page past the last match shows the last page rather than an empty list.
  const lastPage = Math.max(1, Math.ceil(matching.chargeCount / DUNNING_PAGE_SIZE));
  const dunningPage = Math.min(requestedPage, lastPage);
  if (dunningPage !== requestedPage) matching = pageOf(dunningPage);
  const dunningFilter = matching.filter;
  const dunningFiltered = isFiltered(dunningFilter);
  const dunningSites = siteOptions(tenantsRepo.listSites(scope));
  const listed = dunningFiltered ? matching.rows : dunning;
  const codes = reports.failedPaymentsByCode(scope, addBillingPeriods(periodForRunDay(today), -5));

  const currentPeriod = periodForRunDay(today);
  const currentRun = paymentsRepo.getRunForPeriod(scope, currentPeriod);
  const nextPeriod = currentRun === null ? currentPeriod : addBillingPeriods(currentPeriod, 1);
  const nextRunOn = runDayFor(nextPeriod);
  const overdue = nextRunOn <= today;

  const retrying = dunning.filter((row) => row.status === 'retrying');
  const abandoned = dunning.filter((row) => row.status === 'abandoned');
  const outstandingMinor = dunning.reduce((acc, row) => acc + row.amountMinor, 0);

  const byCode = new Map<string, number>();
  for (const row of codes) byCode.set(row.failureCode, (byCode.get(row.failureCode) ?? 0) + row.charges);

  return (
    <>
      <PageHeader
        title="Payments"
        subtitle={`Monthly run on the ${runDayFor(currentPeriod).slice(8)}th, billing that month in arrears`}
        actions={can(session, 'payments.run') ? <RunPaymentsButton period={nextPeriod} /> : undefined}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Collected on last run"
          value={lastRun === null ? '-' : amountCompact(lastRun.totalMinor, tenant.currency, locale)}
          hint={lastRun === null ? undefined : formatPeriod(lastRun.period, locale)}
        />
        <StatTile
          label="Failed on last run"
          value={
            lastRun === null || lastRun.chargesAttempted === 0
              ? '-'
              : percent(lastRun.chargesFailed / lastRun.chargesAttempted, 1, locale)
          }
          tone={
            lastRun !== null && lastRun.chargesAttempted > 0 && lastRun.chargesFailed / lastRun.chargesAttempted > 0.08
              ? 'bad'
              : 'warn'
          }
          hint={
            lastRun === null
              ? undefined
              : `${integer(lastRun.chargesFailed, locale)} of ${integer(lastRun.chargesAttempted, locale)}`
          }
        />
        <StatTile
          label="Outstanding"
          value={amountCompact(outstandingMinor, tenant.currency, locale)}
          tone={outstandingMinor > 0 ? 'warn' : 'good'}
          hint={`${integer(retrying.length, locale)} retrying, ${integer(abandoned.length, locale)} given up`}
        />
        <StatTile
          label="Next run"
          value={formatDate(nextRunOn, locale)}
          tone={overdue ? 'warn' : 'neutral'}
          hint={overdue ? 'Overdue: run it now' : formatPeriod(nextPeriod, locale)}
        />
      </div>

      {abandoned.length > 0 && (
        <div className="mb-4">
          <Callout tone="warn" title={`${abandoned.length} member(s) have exhausted their retries`}>
            Every one of these is a cancellation in two to three weeks unless somebody calls them. That
            lag is the single most predictable thing in this data.
          </Callout>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Collected per month" className="lg:col-span-2">
          {revenue.length === 0 ? (
            <EmptyState title="No runs yet" />
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
        </Card>

        <Card title="Why charges fail, last six months">
          {byCode.size === 0 ? (
            <EmptyState title="Nothing failed" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Reason</TH>
                  <TH align="right">Charges</TH>
                  <TH align="right">Retryable</TH>
                </TR>
              </THead>
              <tbody>
                {[...byCode]
                  .sort(([, a], [, b]) => b - a)
                  .map(([code, n]) => (
                    <TR key={code}>
                      <TD>{humanise(code)}</TD>
                      <TD align="right">{integer(n, locale)}</TD>
                      <TD align="right">
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
          <p className="mt-3 text-ink-muted">
            A cancelled mandate or a closed account will fail forever, so those are never retried.
          </p>
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Payment runs">
          {runs.length === 0 ? (
            <EmptyState title="No runs yet" hint="Run `npm run jobs:payment-run`." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Period</TH>
                  <TH>Status</TH>
                  <TH align="right">Attempted</TH>
                  <TH align="right">Failed</TH>
                  <TH align="right">Failure rate</TH>
                  <TH align="right">Collected</TH>
                  <TH>Started</TH>
                </TR>
              </THead>
              <tbody>
                {runs.map((run) => {
                  const rate = run.chargesAttempted === 0 ? 0 : run.chargesFailed / run.chargesAttempted;
                  return (
                    <TR key={run.id}>
                      <TD>
                        <Link href={`/app/payments/${run.id}`} className="font-medium text-accent">
                          {formatPeriod(run.period, locale)}
                        </Link>
                      </TD>
                      <TD>
                        <Badge
                          tone={
                            run.status === 'completed' ? 'good' : run.status === 'running' ? 'warn' : 'bad'
                          }
                        >
                          {humanise(run.status)}
                        </Badge>
                      </TD>
                      <TD align="right">{integer(run.chargesAttempted, locale)}</TD>
                      <TD align="right">{integer(run.chargesFailed, locale)}</TD>
                      <TD align="right" className={rate > 0.08 ? 'text-bad' : undefined}>
                        {percent(rate, 1, locale)}
                      </TD>
                      <TD align="right" mono>
                        {amount(run.totalMinor, run.currency, locale)}
                      </TD>
                      <TD className="whitespace-nowrap text-ink-muted">
                        {ago(run.startedAt, time.now)}
                      </TD>
                    </TR>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <div className="mt-4" id="dunning">
        <Card
          title={
            dunningFiltered
              ? matchingHeading(matching.chargeCount, matching.memberCount, locale)
              : `In dunning (${dunning.length})`
          }
        >
          <DunningFilters
            basePath="/app/payments"
            filter={dunningFilter}
            statusCounts={matching.statusCounts}
            reasonCounts={matching.reasonCounts}
            sites={dunningSites}
            locale={locale}
          />
          {dunningFiltered && listed.length === 0 ? (
            <div className="py-4 text-center">
              <p>{noMatch(dunningFilter)}</p>
              <Link href="/app/payments#dunning" scroll={false} className="text-accent">
                Clear search and filters
              </Link>
            </div>
          ) : listed.length === 0 ? (
            <EmptyState title="Everyone is paid up" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Member</TH>
                  <TH align="right">Amount</TH>
                  <TH>Reason</TH>
                  <TH align="right">Attempt</TH>
                  <TH>Last tried</TH>
                  <TH>Next attempt</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <tbody>
                {listed.map((row) => (
                  <TR key={row.chargeId}>
                    <TD>
                      <Link href={`/app/members/${row.memberId}`} className="text-accent">
                        {row.memberName}
                      </Link>
                    </TD>
                    <TD align="right" mono>
                      {amount(row.amountMinor, row.currency, locale)}
                    </TD>
                    <TD>{humanise(row.failureCode)}</TD>
                    <TD align="right">{row.attempt}</TD>
                    <TD className="whitespace-nowrap text-ink-muted">
                      {ago(row.attemptedAt, time.now)}
                    </TD>
                    <TD className="whitespace-nowrap text-ink-muted">
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
          {dunningFiltered && matching.chargeCount > DUNNING_PAGE_SIZE && (
            <div className="mt-3">
              <Pagination
                basePath="/app/payments"
                page={dunningPage}
                pageSize={DUNNING_PAGE_SIZE}
                total={matching.chargeCount}
                query={{ ...dunningFilter }}
                anchor="dunning"
              />
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
