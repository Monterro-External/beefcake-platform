/**
 * One payment run.
 *
 * The screen support opens when an owner says "you charged my members twice" or
 * "half the club got a failure email". Every charge the run produced, every
 * attempt, and the failure breakdown that explains the shape of it.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import {
  Badge,
  Card,
  DefinitionList,
  EmptyState,
  PageHeader,
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
  ago,
  humanise,
  instant,
  integer,
  percent,
  period as formatPeriod,
} from '@/lib/format';
import * as paymentsRepo from '@/db/repositories/payments';
import { charges, members, paymentRuns } from '@/db/schema';
import { guard } from '@/db/repositories/scope';
import { billingPeriodRange } from '@/domain/dates';
import { timezoneForCountry } from '@/jobs/runner';

export const dynamic = 'force-dynamic';

const CHARGE_TONE = {
  succeeded: 'good',
  pending: 'neutral',
  failed: 'bad',
  retrying: 'warn',
  abandoned: 'bad',
} as const;

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const session = await getSession();
  const tenant = activeTenant(session);
  if (tenant === null) return null;
  if (!can(session, 'payments.read')) {
    return <NotAllowed title="Payment run" role={session.user.role} what="see payment runs" />;
  }

  const scope = tenantScopeFor(session);
  const time = clock();
  const timezone = timezoneForCountry(tenant.country);
  const locale = tenant.locale;

  const run = scope.db
    .select()
    .from(paymentRuns)
    .where(and(eq(paymentRuns.tenantId, scope.tenantId), eq(paymentRuns.id, runId)))
    .get();
  if (run === undefined) notFound();
  guard(scope, 'payment_runs', [run]);

  const breakdown = paymentsRepo.failureBreakdown(scope, run.id);
  const range = billingPeriodRange(run.period);

  // Only the interesting charges: everything that did not simply succeed, plus a
  // sample of the ones that did. A run at key-account volume has 22,000 rows and
  // nobody scrolls those.
  const problems = guard(
    scope,
    'charges',
    scope.db
      .select({
        tenantId: charges.tenantId,
        id: charges.id,
        memberId: charges.memberId,
        memberName: members.name,
        amountMinor: charges.amountMinor,
        currency: charges.currency,
        status: charges.status,
        method: charges.method,
        failureCode: charges.failureCode,
        attempt: charges.attempt,
        attemptedAt: charges.attemptedAt,
        nextAttemptAt: charges.nextAttemptAt,
      })
      .from(charges)
      .innerJoin(members, eq(members.id, charges.memberId))
      .where(and(eq(charges.tenantId, scope.tenantId), eq(charges.paymentRunId, run.id)))
      .all()
      .filter((row) => row.status !== 'succeeded')
      .slice(0, 200),
  );

  const succeededCount = run.chargesAttempted - run.chargesFailed;
  const failureRate = run.chargesAttempted === 0 ? 0 : run.chargesFailed / run.chargesAttempted;
  const durationSeconds =
    run.finishedAt === null
      ? null
      : Math.max(1, Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000));

  return (
    <>
      <PageHeader
        title={`Payment run ${formatPeriod(run.period, locale)}`}
        subtitle={`Billing ${range.from} to ${range.to} · started ${instant(run.startedAt, timezone, locale)}`}
        actions={
          <Link href="/app/payments" className="text-accent">
            All payments
          </Link>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Attempted" value={integer(run.chargesAttempted, locale)} />
        <StatTile label="Paid" value={integer(succeededCount, locale)} tone="good" />
        <StatTile
          label="Failed"
          value={`${integer(run.chargesFailed, locale)} (${percent(failureRate, 1, locale)})`}
          tone={failureRate > 0.08 ? 'bad' : failureRate > 0.05 ? 'warn' : 'neutral'}
        />
        <StatTile
          label="Collected"
          value={amountCompact(run.totalMinor, run.currency, locale)}
          hint={`${amount(run.totalMinor, run.currency, locale)} attempted`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Run">
          <DefinitionList
            items={[
              { label: 'Period', value: run.period },
              { label: 'Status', value: <Badge tone={run.status === 'completed' ? 'good' : 'warn'}>{humanise(run.status)}</Badge> },
              { label: 'Triggered by', value: humanise(run.triggeredBy) },
              { label: 'Started', value: ago(run.startedAt, time.now) },
              { label: 'Duration', value: durationSeconds === null ? 'still running' : `${durationSeconds}s` },
              { label: 'Currency', value: run.currency },
            ]}
          />
        </Card>

        <Card title="Failure breakdown" className="lg:col-span-2">
          {breakdown.length === 0 ? (
            <EmptyState title="Everything went through" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Reason</TH>
                  <TH align="right">Charges</TH>
                  <TH align="right">Share of failures</TH>
                  <TH>Retried</TH>
                </TR>
              </THead>
              <tbody>
                {breakdown.map((row) => (
                  <TR key={row.failureCode}>
                    <TD>{humanise(row.failureCode)}</TD>
                    <TD align="right">{integer(row.n, locale)}</TD>
                    <TD align="right">
                      {percent(run.chargesFailed === 0 ? 0 : row.n / run.chargesFailed, 0, locale)}
                    </TD>
                    <TD>
                      {row.failureCode === 'mandate_cancelled' || row.failureCode === 'account_closed' ? (
                        <Badge tone="bad">Terminal</Badge>
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
      </div>

      <div className="mt-4">
        <Card
          title={`Charges that did not go through (${problems.length}${problems.length === 200 ? ' shown' : ''})`}
        >
          {problems.length === 0 ? (
            <EmptyState title="Nothing to look at" hint="Every charge on this run succeeded." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Member</TH>
                  <TH align="right">Amount</TH>
                  <TH>Method</TH>
                  <TH>Reason</TH>
                  <TH align="right">Attempt</TH>
                  <TH>Attempted</TH>
                  <TH>Next</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <tbody>
                {problems.map((row) => (
                  <TR key={row.id}>
                    <TD>
                      <Link href={`/app/members/${row.memberId}`} className="text-accent">
                        {row.memberName}
                      </Link>
                    </TD>
                    <TD align="right" mono>
                      {amount(row.amountMinor, row.currency, locale)}
                    </TD>
                    <TD>{humanise(row.method)}</TD>
                    <TD>{humanise(row.failureCode)}</TD>
                    <TD align="right">{row.attempt}</TD>
                    <TD className="whitespace-nowrap text-ink-muted">
                      {instant(row.attemptedAt, timezone, locale)}
                    </TD>
                    <TD className="whitespace-nowrap text-ink-muted">
                      {row.status === 'abandoned' ? '-' : ago(row.nextAttemptAt, time.now)}
                    </TD>
                    <TD>
                      <Badge tone={CHARGE_TONE[row.status]}>{humanise(row.status)}</Badge>
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
