/**
 * Fleet health.
 *
 * The same numbers as the tenant list, arranged so a pattern across the fleet is
 * visible: if every operator's failed-payment rate jumped last month, that is
 * our problem, not theirs.
 */

import Link from 'next/link';
import { Badge, Card, Meter, PageHeader, StatTile, TD, TH, THead, TR, Table } from '@/components/ui';
import { getDb } from '@/db/client';
import { adminScope, tenantScope } from '@/db/repositories/scope';
import * as tenantsRepo from '@/db/repositories/tenants';
import * as reports from '@/export/reports';
import { clock } from '@/lib/clock';
import { humanise, integer, percent } from '@/lib/format';
import { getSession } from '@/lib/session';
import { timezoneForCountry } from '@/jobs/runner';

export const dynamic = 'force-dynamic';

export default async function FleetHealth() {
  const session = await getSession();
  if (!session.isBeefcakeStaff) return null;

  const db = getDb();
  const time = clock();
  const tenants = tenantsRepo.listTenants(adminScope({ db, actorId: session.user.id }));

  const rows = tenants.map((tenant) => {
    const scope = tenantScope(tenant.id, { db });
    return { tenant, health: reports.tenantHealth(scope, time.now, timezoneForCountry(tenant.country)) };
  });

  const mean = (pick: (row: (typeof rows)[number]) => number): number =>
    rows.reduce((acc, row) => acc + pick(row), 0) / Math.max(1, rows.length);

  const fleetFailed = mean((row) => row.health.inputs.failedPaymentRate);
  const fleetChurn = mean((row) => row.health.inputs.churnRate90d);
  const fleetFill = mean((row) => row.health.inputs.classFillRate);
  const fleetScore = Math.round(mean((row) => row.health.score.score));

  return (
    <>
      <PageHeader title="Fleet health" subtitle={`${integer(tenants.length)} operators`} />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Mean health" value={fleetScore} tone={fleetScore >= 70 ? 'good' : 'warn'} />
        <StatTile
          label="Mean failed payments"
          value={percent(fleetFailed, 1)}
          tone={fleetFailed > 0.06 ? 'warn' : 'good'}
        />
        <StatTile label="Mean churn, 90 days" value={percent(fleetChurn, 1)} />
        <StatTile label="Mean class fill" value={percent(fleetFill, 0)} />
      </div>

      <Card title="Every operator, every input">
        <Table>
          <THead>
            <TR>
              <TH>Operator</TH>
              <TH>Segment</TH>
              <TH align="right">Score</TH>
              <TH>Failed payments</TH>
              <TH>Churn 90d</TH>
              <TH>Class fill</TH>
              <TH>Errors /1k</TH>
              <TH>Sync lag</TH>
              <TH>App adoption</TH>
            </TR>
          </THead>
          <tbody>
            {[...rows]
              .sort((a, b) => a.health.score.score - b.health.score.score)
              .map(({ tenant, health }) => (
                <TR key={tenant.id}>
                  <TD>
                    <Link href={`/admin/${tenant.id}`} className="text-accent">
                      {tenant.name}
                    </Link>
                  </TD>
                  <TD className="text-ink-muted">{humanise(tenant.segment)}</TD>
                  <TD align="right">
                    <Badge
                      tone={
                        health.score.band === 'green'
                          ? 'good'
                          : health.score.band === 'amber'
                            ? 'warn'
                            : 'bad'
                      }
                    >
                      {health.score.score}
                    </Badge>
                  </TD>
                  {health.score.components.map((component) => (
                    <TD key={component.key} className="w-28">
                      <div className="flex items-center gap-2">
                        <Meter
                          value={component.score}
                          tone={component.score > 0.7 ? 'good' : component.score < 0.4 ? 'bad' : 'warn'}
                        />
                        <span className="w-8 text-right tabular-nums text-ink-muted">
                          {percent(component.score, 0)}
                        </span>
                      </div>
                    </TD>
                  ))}
                </TR>
              ))}
          </tbody>
        </Table>
        <p className="mt-3 text-ink-muted">
          Each bar is how well that input scores, not the raw value. A full bar is at or better than
          target.
        </p>
      </Card>
    </>
  );
}
