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
import { errorInstantsPrototype, errorRollup, firstErrorAtPrototype } from '@/db/repositories/observability';
import { Suspense } from 'react';
import { PrototypeSwitcher } from '@/components/prototype-switcher';
import { ErrorsTimeseriesPrototype } from './prototype-variants';
import { FLEET_TZ, RANGES, type Range, buildSeries } from './prototype-timeseries';
import * as tenantsRepo from '@/db/repositories/tenants';
import { clock } from '@/lib/clock';
import { ago, integer } from '@/lib/format';
import { getSession } from '@/lib/session';
import { addDays } from '@/domain/dates';
import { timezoneForCountry } from '@/jobs/runner';

export const dynamic = 'force-dynamic';

// PROTOTYPE (BCPLA-50): three variants of the timeseries on this route, ?variant=A|B|C.
export default async function FleetErrors({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session.isBeefcakeStaff) return null;

  const db = getDb();
  const admin = adminScope({ db, actorId: session.user.id });
  const time = clock();
  const since = addDays(time.today(timezoneForCountry('SE')), -30);

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

  const variant = sp.variant === 'B' || sp.variant === 'C' ? sp.variant : 'A';
  const group = sp.group === 'tenant' ? 'tenant' : 'module';
  const range: Range = (RANGES as readonly string[]).includes(sp.range ?? '') ? (sp.range as Range) : '1w';
  const tenantFilter = sp.tenant ?? null;
  const moduleFilter = sp.module ?? null;
  const today = time.today(FLEET_TZ);
  const yearBack = addDays(today, -380);
  const instants = errorInstantsPrototype(admin, `${yearBack}T00:00:00.000Z`);
  const built = buildSeries(instants, {
    group,
    tenant: tenantFilter,
    module: moduleFilter,
    range,
    now: time.now,
    today,
    tenantName: (id) => tenantNames.get(id) ?? id,
  });
  const firstAt = firstErrorAtPrototype(admin);
  const historyFrom = sp.historyFrom ?? (firstAt === null ? null : firstAt.slice(0, 10));
  const historyStart = historyFrom === null ? null : new Date(`${historyFrom}T00:00:00Z`);
  let historyIndex: number | null = null;
  if (historyStart !== null && historyStart > built.from) {
    const i = built.buckets.findIndex((b, k) => {
      const next = built.buckets[k + 1];
      return next === undefined || next.start > historyStart;
    });
    historyIndex = i;
  }
  const protoProps = {
    variant,
    group,
    tenant: tenantFilter,
    module: moduleFilter,
    range,
    bucketLabels: built.buckets.map((b) => b.label),
    series: built.series.map((s) => ({ ...s, lastSeen: ago(s.lastAt, time.now) })),
    other: built.other,
    historyIndex,
    historyFrom,
    tenants: [...tenantNames].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    modules: [...new Set(instants.map((r) => r.where))].sort(),
    unitLabel: range === '1d' ? 'hour' : range === '1w' || range === '1m' ? 'day' : 'week',
  } as const;

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

      <Suspense>
        <ErrorsTimeseriesPrototype {...protoProps} />
        <PrototypeSwitcher
          variants={[
            { key: 'A', name: 'Linear, click to focus' },
            { key: 'B', name: 'Log scale' },
            { key: 'C', name: 'Sparkline per row' },
          ]}
        />
      </Suspense>
    </>
  );
}
