/**
 * PROTOTYPE (BCPLA-50), throwaway. Buckets and series for the Errors timeseries,
 * following the decisions on BCPLA-48 (buckets) and BCPLA-49 (series). Not for
 * main: the real version belongs in src/domain with tests.
 */

import {
  type PlainDate,
  type Timezone,
  addDays,
  atLocalTime,
  dayOfWeek,
  localDay,
  localTime,
  startOfDay,
} from '@/domain/dates';

export const FLEET_TZ: Timezone = 'Europe/Stockholm';
export const RANGES = ['1d', '1w', '1m', '6m', '1y'] as const;
export type Range = (typeof RANGES)[number];

const RANGE_SHAPE: Record<Range, { unit: 'hour' | 'day' | 'week'; count: number }> = {
  '1d': { unit: 'hour', count: 24 },
  '1w': { unit: 'day', count: 7 },
  '1m': { unit: 'day', count: 30 },
  '6m': { unit: 'week', count: 26 },
  '1y': { unit: 'week', count: 52 },
};

export interface Bucket {
  readonly key: string;
  readonly label: string;
  readonly start: Date;
}

function mondayOf(day: PlainDate): PlainDate {
  return addDays(day, -((dayOfWeek(day) + 6) % 7));
}

const SHORT_DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
const SHORT_DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function bucketsFor(range: Range, now: Date, today: PlainDate) {
  const { unit, count } = RANGE_SHAPE[range];
  const buckets: Bucket[] = [];
  let keyOf: (at: Date) => string;

  if (unit === 'hour') {
    const currentHourStart = atLocalTime(today, FLEET_TZ, localTime(now, FLEET_TZ).hour);
    for (let i = count - 1; i >= 0; i -= 1) {
      const start = new Date(currentHourStart.getTime() - i * 3_600_000);
      const hour = localTime(start, FLEET_TZ).hour;
      buckets.push({ key: String(start.getTime()), label: `${String(hour).padStart(2, '0')}:00`, start });
    }
    keyOf = (at) => String(Math.floor(at.getTime() / 3_600_000) * 3_600_000);
  } else if (unit === 'day') {
    for (let i = count - 1; i >= 0; i -= 1) {
      const day = addDays(today, -i);
      buckets.push({ key: day, label: SHORT_DAY.format(new Date(`${day}T00:00:00Z`)), start: startOfDay(day, FLEET_TZ) });
    }
    keyOf = (at) => localDay(at, FLEET_TZ);
  } else {
    const thisMonday = mondayOf(today);
    for (let i = count - 1; i >= 0; i -= 1) {
      const monday = addDays(thisMonday, -7 * i);
      buckets.push({ key: monday, label: SHORT_DATE.format(new Date(`${monday}T00:00:00Z`)), start: startOfDay(monday, FLEET_TZ) });
    }
    keyOf = (at) => mondayOf(localDay(at, FLEET_TZ));
  }
  return { buckets, keyOf, unit, from: buckets[0]!.start };
}

export interface ErrorInstant {
  readonly tenantId: string | null;
  readonly where: string;
  readonly at: string;
}

export interface SeriesRow {
  readonly key: string;
  readonly label: string;
  readonly mono: boolean;
  readonly total: number;
  readonly spread: number; // tenants affected (by module) or modules involved (by tenant)
  readonly lastAt: string;
  readonly values: number[];
  readonly drawn: boolean; // one of the top 8 lines
}

export const PLATFORM = '__platform__';

export function buildSeries(
  rows: readonly ErrorInstant[],
  opts: {
    group: 'module' | 'tenant';
    tenant: string | null;
    module: string | null;
    range: Range;
    now: Date;
    today: PlainDate;
    tenantName: (id: string) => string;
  },
) {
  const { buckets, keyOf, from } = bucketsFor(opts.range, opts.now, opts.today);
  const index = new Map(buckets.map((b, i) => [b.key, i]));
  const bySeries = new Map<string, { values: number[]; total: number; spread: Set<string>; lastAt: string }>();

  for (const row of rows) {
    const at = new Date(row.at);
    if (at < from || at > opts.now) continue; // future-dated rows are BCPRO-157's problem
    if (opts.tenant !== null && row.tenantId !== opts.tenant) continue;
    if (opts.module !== null && row.where !== opts.module) continue;
    const i = index.get(keyOf(at));
    if (i === undefined) continue;
    const key = opts.group === 'module' ? row.where : (row.tenantId ?? PLATFORM);
    const entry =
      bySeries.get(key) ?? { values: buckets.map(() => 0), total: 0, spread: new Set<string>(), lastAt: row.at };
    entry.values[i]! += 1;
    entry.total += 1;
    entry.spread.add(opts.group === 'module' ? (row.tenantId ?? PLATFORM) : row.where);
    if (row.at > entry.lastAt) entry.lastAt = row.at;
    bySeries.set(key, entry);
  }

  const sorted = [...bySeries].sort(([ka, a], [kb, b]) => {
    if (ka === PLATFORM) return -1; // Platform is always drawn
    if (kb === PLATFORM) return 1;
    return b.total - a.total;
  });

  const series: SeriesRow[] = sorted.map(([key, entry], rank) => ({
    key,
    label:
      key === PLATFORM ? 'Platform' : opts.group === 'module' ? key : opts.tenantName(key),
    mono: opts.group === 'module' && key !== PLATFORM,
    total: entry.total,
    spread: entry.spread.size,
    lastAt: entry.lastAt,
    values: entry.values,
    drawn: rank < 8,
  }));

  const rest = series.filter((s) => !s.drawn);
  const other =
    rest.length === 0
      ? null
      : {
          label: opts.group === 'module' ? 'All other modules' : 'All other tenants',
          count: rest.length,
          values: buckets.map((_, i) => rest.reduce((acc, s) => acc + s.values[i]!, 0)),
        };

  return { buckets, series, other, from };
}
