/**
 * The filtered "In dunning now" card answers within 500 ms on the server at
 * key-account scale (BCPLA-36 AC10, BCPLA-41): rows plus every count, for a
 * name search and for each single filter, at Nordic Fitness Group full scale.
 *
 * Skipped unless BEEFCAKE_PERF_DB points to a full-scale database, because the
 * CI unit job has no seeded database. The database is opened read-only.
 *
 * How to run:
 *
 *   BEEFCAKE_DB=/tmp/perf/beefcake.db npm run db:reset          # full scale, ~15 s
 *   BEEFCAKE_PERF_DB=/tmp/perf/beefcake.db TZ=UTC npx vitest run tests/unit/open-dunning-perf.test.ts
 *
 * Each case makes one warm-up call, then takes the median of five timed calls
 * of the card's query (filtered, limit 50) and logs it.
 */

import { existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type Connection } from '@/db/client';
import { tenantScope } from '@/db/repositories/scope';
import { FAILURE_CODES } from '@/domain/retry-policy';
import { openDunning, type DunningFilter } from '@/export/reports';

const PERF_DB = process.env.BEEFCAKE_PERF_DB;
const LIMIT_MS = 500;
const RUNS = 5;

describe.skipIf(PERF_DB === undefined || PERF_DB === '')(
  'the open-dunning report at Nordic Fitness Group full scale',
  () => {
    let connection: Connection;
    let tenantId: string;
    let siteId: string;

    beforeAll(() => {
      if (!existsSync(PERF_DB as string)) throw new Error(`BEEFCAKE_PERF_DB not found: ${PERF_DB}`);
      connection = openDatabase(PERF_DB as string, { readonly: true });
      const tenant = connection.sqlite
        .prepare("select id from tenants where name = 'Nordic Fitness Group'")
        .get() as { id: string } | undefined;
      if (tenant === undefined) throw new Error('Nordic Fitness Group is not in the database');
      tenantId = tenant.id;
      const members = (
        connection.sqlite.prepare('select count(*) as n from members where tenant_id = ?').get(tenantId) as {
          n: number;
        }
      ).n;
      if (members < 15_000) throw new Error(`not a full-scale database: ${members} members`);
      siteId = (
        connection.sqlite.prepare('select id from sites where tenant_id = ? order by id limit 1').get(tenantId) as {
          id: string;
        }
      ).id;
    });

    afterAll(() => {
      connection?.sqlite.close();
    });

    function medianMs(filter: DunningFilter): { ms: number; chargeCount: number } {
      const scope = tenantScope(tenantId, { db: connection.db });
      const query = { ...filter, limit: 50 };
      const warm = openDunning(scope, query);
      const times: number[] = [];
      for (let i = 0; i < RUNS; i++) {
        const start = performance.now();
        openDunning(scope, query);
        times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      return { ms: times[Math.floor(RUNS / 2)] as number, chargeCount: warm.chargeCount };
    }

    const cases: Array<[string, () => DunningFilter]> = [
      ['no filter', () => ({})],
      ['name search "anna"', () => ({ q: 'anna' })],
      ['Retrying', () => ({ status: 'retrying' })],
      ['Abandoned', () => ({ status: 'abandoned' })],
      ...FAILURE_CODES.map((code): [string, () => DunningFilter] => [`reason ${code}`, () => ({ reason: code })]),
      ['one site', () => ({ site: siteId })],
    ];

    it.each(cases)('answers %s within 500 ms, rows and all counts', (label, filter) => {
      const { ms, chargeCount } = medianMs(filter());
      console.log(`open-dunning perf: ${label}: ${ms.toFixed(1)} ms (${chargeCount} charges)`);
      expect(ms).toBeLessThan(LIMIT_MS);
    });
  },
);
