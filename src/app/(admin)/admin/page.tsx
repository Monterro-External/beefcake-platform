/**
 * The tenant list.
 *
 * 340 operators in production, twelve in the seed. Sorted by health worst first,
 * because the point of this screen is to tell a CSM who to call. Ticket counts
 * are deliberately absent: they live in another system and are joined in there.
 */

import Link from 'next/link';
import { Badge, Card, PageHeader, StatTile, TD, TH, THead, TR, Table } from '@/components/ui';
import { adminScope, tenantScope } from '@/db/repositories/scope';
import { getDb } from '@/db/client';
import * as tenantsRepo from '@/db/repositories/tenants';
import * as reports from '@/export/reports';
import { clock } from '@/lib/clock';
import { amountCompact, humanise, integer, percent } from '@/lib/format';
import { getSession } from '@/lib/session';
import { timezoneForCountry } from '@/jobs/runner';

export const dynamic = 'force-dynamic';

export default async function AdminTenants() {
  const session = await getSession();
  if (!session.isBeefcakeStaff) return null;

  const db = getDb();
  const admin = adminScope({ db, actorId: session.user.id });
  const time = clock();

  const tenants = tenantsRepo.listTenants(admin);
  const rows = tenants.map((tenant) => {
    const scope = tenantScope(tenant.id, { db });
    const today = time.today(timezoneForCountry(tenant.country));
    const health = reports.tenantHealth(scope, today);
    const lastRun = reports.revenueByPeriod(scope, 1)[0] ?? null;
    const sites = tenantsRepo.listSites(scope).length;
    const lag = reports.syncLagBySite(scope);
    const stale = lag.filter(
      (site) =>
        site.lastSuccessAt === null ||
        Date.parse(site.lastSuccessAt) < time.now.getTime() - 48 * 3_600_000,
    ).length;
    return { tenant, health, lastRun, sites, stale };
  });

  const sorted = [...rows].sort((a, b) => a.health.score.score - b.health.score.score);
  const totalMembers = rows.reduce((acc, row) => acc + row.health.activeMembers, 0);
  const red = rows.filter((row) => row.health.score.band === 'red').length;
  const amber = rows.filter((row) => row.health.score.band === 'amber').length;
  const keyAccounts = rows.filter((row) => row.tenant.segment === 'key_account');

  return (
    <>
      <PageHeader
        title="Tenants"
        subtitle={`${integer(tenants.length)} operators · ${integer(totalMembers)} active members`}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Operators" value={integer(tenants.length)} />
        <StatTile label="Active members" value={integer(totalMembers)} />
        <StatTile
          label="Needs attention"
          value={`${integer(red)} red, ${integer(amber)} amber`}
          tone={red > 0 ? 'bad' : amber > 0 ? 'warn' : 'good'}
        />
        <StatTile
          label="Key accounts"
          value={integer(keyAccounts.length)}
          hint={`${integer(keyAccounts.reduce((acc, row) => acc + row.health.activeMembers, 0))} members`}
        />
      </div>

      <Card title="Worst health first">
        <Table>
          <THead>
            <TR>
              <TH>Operator</TH>
              <TH>Segment</TH>
              <TH>Market</TH>
              <TH align="right">Sites</TH>
              <TH align="right">Members</TH>
              <TH align="right">Health</TH>
              <TH align="right">Failed payments</TH>
              <TH align="right">Churn 90d</TH>
              <TH align="right">Last run</TH>
              <TH />
            </TR>
          </THead>
          <tbody>
            {sorted.map(({ tenant, health, lastRun, sites, stale }) => (
              <TR key={tenant.id}>
                <TD>
                  <Link href={`/admin/${tenant.id}`} className="font-medium text-accent">
                    {tenant.name}
                  </Link>
                  {stale > 0 && (
                    <>
                      {' '}
                      <Badge tone="bad">{stale} site(s) behind</Badge>
                    </>
                  )}
                </TD>
                <TD>{humanise(tenant.segment)}</TD>
                <TD className="text-ink-muted">
                  {tenant.country} · {tenant.currency}
                </TD>
                <TD align="right">{integer(sites)}</TD>
                <TD align="right">{integer(health.activeMembers)}</TD>
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
                <TD align="right" className={health.inputs.failedPaymentRate > 0.08 ? 'text-bad' : undefined}>
                  {percent(health.inputs.failedPaymentRate, 1)}
                </TD>
                <TD align="right" className={health.inputs.churnRate90d > 0.08 ? 'text-bad' : undefined}>
                  {percent(health.inputs.churnRate90d, 1)}
                </TD>
                <TD align="right" mono>
                  {lastRun === null ? '-' : amountCompact(lastRun.succeededMinor, lastRun.currency)}
                </TD>
                <TD align="right">
                  <Link href={`/admin/${tenant.id}`} className="text-accent">
                    Open
                  </Link>
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
        <p className="mt-3 text-ink-muted">
          Health is computed from platform inputs only: failed payments, churn, class fill, error
          rate, access sync lag and member app adoption. Support tickets and NPS are joined in
          downstream and never folded into this number.
        </p>
      </Card>
    </>
  );
}
