/**
 * Errors across the fleet.
 *
 * Rolled up by module and tenant, which is how you tell "one operator has a
 * broken controller" from "our report export falls over above 5,000 members".
 */

import Link from 'next/link';
import { Badge, Card, EmptyState, PageHeader, StatTile, TD, TH, THead, TR, Table } from '@/components/ui';
import { getDb } from '@/db/client';
import { adminScope } from '@/db/repositories/scope';
import { errorRollup } from '@/db/repositories/observability';
import * as tenantsRepo from '@/db/repositories/tenants';
import { clock } from '@/lib/clock';
import { ago, integer } from '@/lib/format';
import { getSession } from '@/lib/session';
import { addDays } from '@/domain/dates';
import { timezoneForCountry } from '@/jobs/runner';

export const dynamic = 'force-dynamic';

export default async function FleetErrors() {
  const session = await getSession();
  if (!session.isBeefcakeStaff) return null;

  const db = getDb();
  const admin = adminScope({ db, actorId: session.user.id });
  const time = clock();
  const since = addDays(time.today(timezoneForCountry('SE')), -30);

  // eslint-disable-next-line no-restricted-syntax -- BCPLA-26: error rollup starts at UTC midnight
  const rollup = errorRollup(admin, `${since}T00:00:00.000Z`);
  const tenantNames = new Map(tenantsRepo.listTenants(admin).map((tenant) => [tenant.id, tenant.name]));

  const byModule = new Map<string, { count: number; tenants: Set<string> }>();
  for (const row of rollup) {
    const entry = byModule.get(row.where) ?? { count: 0, tenants: new Set<string>() };
    entry.count += row.n;
    if (row.tenantId !== null) entry.tenants.add(row.tenantId);
    byModule.set(row.where, entry);
  }

  const total = rollup.reduce((acc, row) => acc + row.n, 0);
  const modules = [...byModule].sort(([, a], [, b]) => b.count - a.count);

  return (
    <>
      <PageHeader title="Errors" subtitle={`Since ${since}`} />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatTile label="Errors, 30 days" value={integer(total)} tone={total > 0 ? 'warn' : 'good'} />
        <StatTile label="Modules involved" value={integer(byModule.size)} />
        <StatTile
          label="Widest blast radius"
          value={modules[0] === undefined ? '-' : `${modules[0][1].tenants.size} tenants`}
          hint={modules[0]?.[0]}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="By module">
          {modules.length === 0 ? (
            <EmptyState title="Nothing logged" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Module</TH>
                  <TH align="right">Errors</TH>
                  <TH align="right">Tenants affected</TH>
                  <TH>Shape</TH>
                </TR>
              </THead>
              <tbody>
                {modules.map(([module, entry]) => (
                  <TR key={module}>
                    <TD mono>{module}</TD>
                    <TD align="right">{integer(entry.count)}</TD>
                    <TD align="right">{integer(entry.tenants.size)}</TD>
                    <TD>
                      {entry.tenants.size === 1 ? (
                        <Badge tone="warn">One operator</Badge>
                      ) : entry.tenants.size >= 5 ? (
                        <Badge tone="bad">Fleet wide</Badge>
                      ) : (
                        <Badge tone="info">Several</Badge>
                      )}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
          <p className="mt-3 text-ink-muted">
            One operator means their configuration or their hardware. Fleet wide means ours.
          </p>
        </Card>

        <Card title="By tenant and module">
          {rollup.length === 0 ? (
            <EmptyState title="Nothing logged" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Operator</TH>
                  <TH>Module</TH>
                  <TH align="right">Errors</TH>
                  <TH>Last seen</TH>
                </TR>
              </THead>
              <tbody>
                {rollup.slice(0, 40).map((row) => (
                  <TR key={`${row.tenantId}-${row.where}`}>
                    <TD>
                      {row.tenantId === null ? (
                        <span className="text-ink-muted">Platform</span>
                      ) : (
                        <Link href={`/admin/${row.tenantId}`} className="text-accent">
                          {tenantNames.get(row.tenantId) ?? row.tenantId}
                        </Link>
                      )}
                    </TD>
                    <TD mono>{row.where}</TD>
                    <TD align="right">{integer(row.n)}</TD>
                    <TD className="whitespace-nowrap text-ink-muted">{ago(row.lastAt, time.now)}</TD>
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
