# Error history: depth and spread (BCPLA-47)

Question: how deep and how spread is the `errors` history, and can a 1-year
grouped-by-day view run on page load against SQLite with the existing indexes?

Production reseeds from the deterministic seed, so the seeded `errors` table is
the stand-in for real data.

## Method

- Branch `research/error-history` from `2920aaa`. No changes under `src/`.
- Database built with the documented command, into a scratch file:
  `BEEFCAKE_DB=<scratch>/eh.db npm run db:reset -- --seed beefcake-2026 --today 2026-08-26 --scale full`
  (default seed, `PINNED_TODAY`, full scale; 1,861,198 rows total, 14.4 s).
- Queries run with the `sqlite3` CLI (3.x, macOS) against that file.
- Sources: `src/db/schema.ts:381-394`, `src/db/repositories/observability.ts:85-158`,
  `src/db/seed/write-activity.ts:338-810`, every `recordError` caller under `src/`.

Key assumption: the seed has **12 tenants**, while the fleet is ~340. Spread
numbers are per the seed; the performance section also tests synthetic 30x and
100x copies to approximate fleet volume.

## Depth

| | Value |
|---|---|
| Rows | 8,642 |
| Earliest | `2025-02-25T01:08:47Z` (Voima Kuntosalit), 547 days before `today` |
| Latest | `2026-08-26T22:52:00Z` |
| Rows in the last 365 days | 7,223 |

Per tenant, earliest row is `2025-02-25` for 11 of 12 tenants; Bodyfokus Umeå
starts `2025-04-25`. Every tenant's history is therefore ~18 months deep.

| Tenant | Rows | First | Last |
|---|---:|---|---|
| Nordic Fitness Group | 3,422 | 2025-02-25 | 2026-08-25 |
| Kraft Trening | 3,325 | 2025-02-25 | 2026-08-26 |
| Vestkyst Trening | 577 | 2025-02-25 | 2026-08-26 |
| Voima Kuntosalit | 328 | 2025-02-25 | 2026-08-25 |
| Puls Träning | 288 | 2025-02-25 | 2026-08-25 |
| Trening Grünerløkka | 187 | 2025-02-25 | 2026-08-26 |
| Kuntoklubi Kallio | 118 | 2025-02-25 | 2026-08-25 |
| Träningsverket Lund | 114 | 2025-02-25 | 2026-08-25 |
| Aktiv Hälsa | 112 | 2025-02-25 | 2026-08-25 |
| Fitness Nørrebro | 61 | 2025-02-25 | 2026-08-25 |
| Gymmet Vasastan | 60 | 2025-02-25 | 2026-08-25 |
| Bodyfokus Umeå | 50 | 2025-04-25 | 2026-08-25 |

Depth per module differs a lot (see below): only `integrations/payment` goes back
18 months. `app/receipts` covers only the last 30 days, `jobs/access-sync` ~90 days,
`export/reports` ~160 days. That follows from the seed writers' windows
(`write-activity.ts:536-575`, `:578-618`), so a "1y" view is in practice a payment
view with recent spikes of the other modules.

**Retention / pruning: none.** No `delete` against `errors` anywhere in `src/`
(searched for `delete(errors)`, `DELETE FROM errors`, `prune`, `retention`).
`recordError` only inserts (`observability.ts:93`). The table grows unbounded
between reseeds.

## Rows per day

- 157 distinct days have errors out of 548 calendar days in range. Mean 55 rows
  per active day, min 1, max 504.
- Busiest day: **2026-08-25, 504 rows** (payment, receipts, access-sync).
  Next: 2026-06-25 (418), 2026-07-25 (391), 2026-04-25 (380), 2026-05-25 (373).
- The shape is a monthly spike on the payment-run day: of 5,786 payment errors,
  5,214 (90%) fall on the 25th, 403 on the 26th, 105 on the 27th (retries).
  Payment errors exist on 98 days.
- Last 30 days: every day has errors (72 to 504, mean 104.5), driven by
  `app/receipts`. Before that: 126 active days, mean 42.9.

## Modules (`where`)

| Module | Rows | Tenants | `tenant_id` NULL | First | Severity |
|---|---:|---:|---:|---|---|
| `integrations/payment` | 5,786 | 12 | 0 | 2025-02-25 | warn |
| `app/receipts` | 2,768 | 3 | 0 | 2026-07-27 | warn |
| `jobs/access-sync` | 73 | 11 | 0 | 2026-05-29 | error |
| `export/reports` | 15 | 2 | 0 | 2026-03-17 | error |

4 distinct modules in the seed. `app/receipts`: Trening Grünerløkka, Vestkyst
Trening, Kraft Trening (all NO locale). `export/reports`: Nordic Fitness Group,
Kraft Trening (members > 4,000 is the seed's trigger, `write-activity.ts:604`).

**`tenant_id` NULL: 0 rows in total.** The column is nullable
(`schema.ts:385`) and `recordError` writes NULL for an `AdminScope`
(`observability.ts:59-61`), but no caller currently passes an admin scope.

**Not a closed set.** `ErrorInput.where` is `string`
(`observability.ts:85`), unlike `EventAction`, which is a union. Values in use:

| Value | Seed writer | Runtime `recordError` caller |
|---|---|---|
| `integrations/payment` | `write-activity.ts:716` | none |
| `app/receipts` | `write-activity.ts:566` | `src/app/(member)/me/receipts/page.tsx:38` |
| `export/reports` | `write-activity.ts:610` | `src/app/(tenant)/app/reports/page.tsx:86`, `src/app/(tenant)/app/reports/export/[report]/route.ts:58` |
| `jobs/access-sync` | `write-activity.ts:781` | `src/jobs/access-sync.ts:241` |
| `export/signals` | none | `src/export/signals.ts:279` |

So 5 values exist in code, 4 in the seed. `integrations/payment` is seed-only
(the payment run job does not call `recordError`); `export/signals` is
runtime-only. A UI that hardcodes the list would drift; derive it from the data
or introduce a union type.

## Severity mix

| Severity | Rows | Share |
|---|---:|---:|
| warn | 8,554 | 99.0% |
| error | 88 | 1.0% |
| fatal | 0 | 0% |

Severity is fixed per module in the seed. At runtime `jobs/access-sync` can also
write `warn` (when `outcome.retryable`, `access-sync.ts:244`), which the seed
never produces. Nothing in code writes `fatal`.

## Performance: 1y grouped by day

Queries (all `at >= '2025-08-26T00:00:00.000Z'`):

- Q1 fleet, by day x module: `group by substr(at,1,10), "where"`
- Q2 fleet, by day x tenant: `group by substr(at,1,10), tenant_id`
- Q3 one tenant (NFG), by day x module
- Q4 one module (`integrations/payment`), by day x tenant

`EXPLAIN QUERY PLAN` (same before and after `ANALYZE`, and at 30x):

| Query | Plan |
|---|---|
| Q1 | `SEARCH errors USING INDEX errors_tenant_at_idx (ANY(tenant_id) AND at>?)` + temp B-tree for GROUP BY |
| Q2 | `SEARCH errors USING COVERING INDEX errors_tenant_at_idx (ANY(tenant_id) AND at>?)` + temp B-tree |
| Q3 | `SEARCH errors USING INDEX errors_tenant_at_idx (tenant_id=? AND at>?)` + temp B-tree |
| Q4 | `SEARCH errors USING INDEX errors_where_idx (where=?)` + temp B-tree (the `at` filter is applied per row) |

Timings, warm cache, `sqlite3 .timer`, median of runs. The 30x and 100x
databases copy every error row with a suffixed `tenant_id` (360 and 1,200
synthetic tenants), so they approximate fleet volume with the seed's mix:

| Rows | Q1 | Q2 | Q3 | Q4 |
|---|---:|---:|---:|---:|
| 8,642 (seed) | 3 ms | 1.3 ms | 0.7 ms | 1.1 ms |
| 259,260 (30x, ~fleet) | 215 ms | 60 ms | 0.9 ms | 58 ms |
| 864,200 (100x) | 820 ms | 210 ms | 1.0 ms | 200 ms |

Reading:

- On the seed and for any one tenant (Q3), fast enough for a page load at every volume tested.
- Fleet-wide by module (Q1) is the slow one: it uses the tenant index with a skip
  scan but must read each table row to get `where`. ~200 ms at fleet volume is
  borderline for a page load and grows linearly; at 100x it is ~0.8 s.
- Q2 is covering and ~3.5x faster than Q1.
- Neither index serves Q1 or Q4 well. An `(at, where)` or `(where, at)` index
  would make them covering; that is a migration, out of scope here.
- Fleet volume is an extrapolation: the 30x copy multiplies key accounts too,
  so it may overstate volume, but real production has no pruning, so rows only grow.

## Instants later than the seed's `today`

- Rows with a UTC date after `2026-08-26`: **0**.
- Rows on `today` itself: 88 (87 `app/receipts`, 1 `export/reports`), up to `22:52Z`.
  The pinned clock is `today` plus the real UTC time of day (`src/lib/clock.ts:36`),
  so 60 rows after 12:00Z read as "in the future" for most of the day.
- Rows whose site-local day is after `today` (SE/NO/DK +2 h, FI +3 h in August):
  **6**, all `app/receipts`, NO tenants. The receipt seed writer draws hours 06-22
  UTC on `today - 0..30` (`write-activity.ts:541`), which is the likely BCPRO-157 source.
- Separately, `src/export/signals.ts:284` stamps `at: new Date().toISOString()`
  (real clock, not `clock()`), so on a pinned database an export failure writes a
  row months after `today`. Not observed in the seed; reported, not fixed.
