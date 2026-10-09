/**
 * CSV export of a report.
 *
 * A route handler rather than a server action, because the answer is a file
 * download and the browser should treat it as one. Same data as the screen: both
 * call the same functions in src/export/reports.ts, so an owner who exports what
 * they are looking at gets what they are looking at.
 */

import { NextResponse } from 'next/server';
import { csvCell } from '@/export/signals';
import * as reports from '@/export/reports';
import { activeTenant, can, getSession, tenantScopeFor } from '@/lib/session';
import { recordError, recordEvent } from '@/db/repositories/observability';
import { clock } from '@/lib/clock';
import { addBillingPeriods } from '@/domain/dates';
import { periodForRunDay } from '@/jobs/payment-run';
import { timezoneForCountry } from '@/jobs/runner';

const REPORTS = ['churn', 'revenue', 'failed-payments', 'classes', 'members'] as const;
type ReportName = (typeof REPORTS)[number];

interface Csv {
  readonly header: readonly string[];
  readonly rows: readonly (string | number | null)[][];
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ report: string }> },
): Promise<NextResponse> {
  const { report } = await params;
  if (!(REPORTS as readonly string[]).includes(report)) {
    return NextResponse.json({ error: `Unknown report: ${report}` }, { status: 404 });
  }

  const session = await getSession();
  const tenant = activeTenant(session);
  if (tenant === null) {
    return NextResponse.json({ error: 'No tenant selected' }, { status: 400 });
  }
  if (!can(session, 'reports.export')) {
    return NextResponse.json({ error: 'Not allowed to export reports' }, { status: 403 });
  }

  const scope = tenantScopeFor(session);
  const time = clock();
  const today = time.today(timezoneForCountry(tenant.country));
  const requested = Number.parseInt(new URL(request.url).searchParams.get('days') ?? '90', 10);
  const days = Number.isFinite(requested) ? Math.min(730, Math.max(7, requested)) : 90;
  const window = reports.windowOfDays(today, days);

  let csv: Csv;
  try {
    csv = build(report as ReportName, scope, window, today, time.now);
  } catch (error) {
    if (!(error instanceof reports.ReportTimeoutError)) throw error;
    recordError(scope, {
      where: 'export/reports',
      message: error.message,
      severity: 'error',
      context: { report, days, elapsed_ms: error.elapsedMs },
      at: time.now.toISOString(),
    });
    return NextResponse.json(
      { error: error.message, hint: 'Narrow the window with ?days= and try again.' },
      { status: 504 },
    );
  }

  recordEvent(scope, {
    action: 'report.exported',
    subjectType: 'report',
    subjectId: report,
    payload: { report, format: 'csv', rows: csv.rows.length, days },
    at: time.now.toISOString(),
  });

  const body = [
    csv.header.join(','),
    ...csv.rows.map((row) => row.map(csvCell).join(',')),
  ].join('\n');

  return new NextResponse(`${body}\n`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${tenant.name.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}-${report}-${today}.csv"`,
      'cache-control': 'no-store',
    },
  });
}

function build(
  report: ReportName,
  scope: ReturnType<typeof tenantScopeFor>,
  window: reports.ReportWindow,
  today: string,
  now: Date,
): Csv {
  switch (report) {
    case 'churn': {
      const rows = reports.churnWithPaymentLag(scope, window);
      return {
        header: [
          'member_id',
          'cancelled_on',
          'ends_on',
          'reason',
          'joined_on',
          'tenure_days',
          'days_since_last_failed_payment',
        ],
        rows: rows.map((row) => [
          row.memberId,
          row.cancelledOn,
          row.endsOn,
          row.reason,
          row.joinedOn,
          row.tenureDays,
          row.daysSinceLastFailedPayment,
        ]),
      };
    }

    case 'revenue': {
      const rows = reports.revenueByPeriod(scope, 24);
      return {
        header: [
          'period',
          'currency',
          'charges',
          'failed_charges',
          'collected_minor',
          'missed_minor',
        ],
        rows: rows.map((row) => [
          row.period,
          row.currency,
          row.charges,
          row.failedCharges,
          row.succeededMinor,
          row.failedMinor,
        ]),
      };
    }

    case 'failed-payments': {
      const rows = reports.failedPaymentsByCode(
        scope,
        addBillingPeriods(periodForRunDay(today as never), -11),
      );
      return {
        header: ['period', 'failure_code', 'charges', 'amount_minor'],
        rows: rows.map((row) => [row.period, row.failureCode, row.charges, row.amountMinor]),
      };
    }

    case 'classes': {
      const rows = reports.classFillBySite(scope, window, now);
      return {
        header: [
          'site_id',
          'site_name',
          'classes',
          'capacity',
          'booked',
          'attended',
          'waitlisted',
          'fill_rate',
          'no_show_rate',
        ],
        rows: rows.map((row) => [
          row.siteId,
          row.siteName,
          row.classes,
          row.capacity,
          row.booked,
          row.attended,
          row.waitlisted,
          row.fillRate.toFixed(4),
          row.noShowRate === null ? null : row.noShowRate.toFixed(4),
        ]),
      };
    }

    case 'members': {
      const summary = reports.membershipSummary(scope, window);
      return {
        header: ['metric', 'value'],
        rows: [
          ['active', summary.active],
          ['frozen', summary.frozen],
          ['notice_given', summary.cancelling],
          ['archived', summary.former],
          ['joined_in_window', summary.joinedInWindow],
          ['left_in_window', summary.leftInWindow],
          ['window_from', window.from],
          ['window_to', window.to],
        ],
      };
    }
  }
}
