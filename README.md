# Beefcake

Gym management software for Nordic operators. Members, subscriptions, classes,
payments, access control and reporting for about 340 gym operators in Sweden,
Norway, Finland and Denmark.

One Next.js application serves three surfaces:

| Path | Who it is for |
|---|---|
| `/app` | Gym operators: owners, site managers, front desk |
| `/me` | Members: class booking, own subscription, receipts |
| `/admin` | Beefcake staff: tenant list, feature flags, read-only impersonation |

## Getting started

Requires Node 20.11 or newer. No database server, no Docker.

```bash
git clone <this repo>
cd beefcake-platform
npm install
npm run db:reset
npm run dev
```

Open <http://localhost:3000>. The landing page tells you what state the local
database is in and links to the three surfaces.

`npm install` compiles `better-sqlite3`, which needs a working C++ toolchain
(Xcode command line tools on macOS, `build-essential` on Debian). Everything else
is JavaScript.

## Contributing

We use Gitflow: `develop` is the default integration branch; `main` holds
releases. Start feature branches from `develop` and open pull requests back to
`develop`. See [the Gitflow guide](docs/gitflow.md) for releases, hotfixes and
the required checks.

All coding assistants share [AGENTS.md](AGENTS.md) and the
[engineering rules](docs/agents/rules.md). Copilot's instruction file points
to these same documents; maintain shared rules in one place.

## Picking a persona

There is no real authentication in development. The header has a persona
switcher: choose a tenant, then a role. The seed creates an owner, a site
manager and two front desk users for every site, plus a few member logins per
tenant and four Beefcake staff accounts.

The choice is per surface. Keep `/app`, `/me` and `/admin` open in three tabs
and each remembers its own persona: picking a member in the member app does not
sign the admin tab out. A surface with no persona yet defaults to someone who
belongs there: an owner in the tenant app, a member in the member app, Beefcake
staff in admin.

Start with **Puls Träning** (four sites, ~2,500 members) for anything ordinary,
and **Nordic Fitness Group** (fifteen sites, ~22,000 members) when you want to
see how something behaves at key-account volume.

## The development database

SQLite, one file at `data/beefcake.db`, not committed. Set `$BEEFCAKE_DB` to put
it somewhere else.

```bash
npm run db:reset                          # drop, migrate, seed
npm run db:reset -- --scale small         # ~1/12 of the data, about 1.5 seconds
npm run db:reset -- --today 2026-11-12    # the same story, shifted in time
npm run db:reset -- --seed my-experiment  # a different but equally valid company
npm run db:migrate                        # migrations only, keep the data
npm run db:studio                         # browse it
```

The seed is deterministic. The same `--seed` and the same `--today` produce a
byte-identical database, so a screenshot in a document, a test expectation and a
colleague's laptop all agree.

`--scale full` is the default and takes about 15 seconds for roughly 1.8 million
rows and a 470 MB file. While you are iterating on a screen, use `--scale small`.

### What the seed builds

Twelve tenants, a deliberate sample of the real book of business: six
single-site gyms across all four markets, four mid-sized operators with two to
five sites, and the two key accounts. About 45,000 members in total, eighteen
months of payment runs, and a class schedule covering the last eight weeks and
the next two.

Every date is an offset from `today`, never hardcoded, and the story is
positioned so the app looks live rather than finished:

- the last monthly payment run has just completed and the next one is due
- some charges from that run are mid-retry, with the next attempt still ahead
- classes are on the schedule for the coming fortnight
- freezes cluster in January and over the summer, and a good number start on the
  last day of a month
- cancellations run at a baseline plus a visible bump two to three weeks after
  the payment run, which is the involuntary churn following exhausted dunning

### What the seed does not build

- **Receipts older than six months.** Receipts carry line JSON and dominate the
  file size, so only the recent periods are materialised. The charges they came
  from are all there.
- **Check-ins older than 90 days.** Long-run trends come from the payment,
  subscription and class data; access history only needs to be deep enough for
  the access log, the denial reports and the sync-lag monitoring.
- **A notification outbox older than 60 days.**

`--scale small` and `--scale tiny` shorten the first two further. All three
scales keep the full eighteen months of payment-run history, so the trend
reports look the same at every size.

## Jobs

There is no queue. Jobs are scripts you run, and in production a scheduler runs
the same scripts.

```bash
npm run jobs:payment-run        # charge every member of every tenant for the period
npm run jobs:access-sync        # push allow-lists to the door controllers
npm run jobs:waitlist-promote   # move waitlisted members into freed class spots
```

## Tests

```bash
npm test           # Vitest: domain logic, repositories, integrations, the seed
npm run typecheck
npm run lint
npm run test:e2e   # Playwright, whole flows through the app
```

Everything under `src/domain/` is pure and covered by unit tests. The seed has
its own suite asserting that it is deterministic, that the story anchors land
where the reports expect them, and that the invariants that make the data
believable actually hold.

The [member registration acceptance scenarios](specs/member-registration.md)
run in a separate **Playwright acceptance scenarios** CI job. It seeds a small
database and runs every `@acceptance` test in Chromium: registration and member search,
duplicate rejection, and tenant isolation. Every scenario records a 1280×720
video with highlighted actions and step captions, plus a trace, including
successful runs. Named Given/When/Then steps and recordings appear in the HTML
report. CI retains the report, videos, traces and acceptance/evidence documents
for seven days in the `playwright-acceptance-report` artifact. Run these
scenarios locally against a seeded database with:

```bash
npm run test:e2e -- --grep @acceptance --project=chromium
```

These tests create members through the app. CI uses a fresh database per job.
Locally, recordings are saved under `test-results/`. To generate and open the
same HTML report locally, add `--reporter=html` to the command above and run
`npx playwright show-report`. Each scenario has its own video and trace.
The [release evidence example](docs/testing/member-registration-release-evidence.md)
maps visible release-note claims to the corresponding scenario and video step.
On pull requests, CI also publishes one updated comment with the spec's change
summary, scenario results, recording links and approximate timestamps. The artifact
includes `test-results/bdd-evidence/index.html`, a player with clickable chapters.
See [Acceptance specs and PR evidence](docs/testing/pr-evidence.md) to add more scenarios.

## Integrations

Nothing external runs in development. Each integration has an interface in
`src/integrations/` and a deterministic fake next to it:

- **Payments.** Autogiro (SE), AvtaleGiro (NO) and card (FI, DK) via one
  provider interface. The fake returns the same outcome for the same request, so
  a payment run replayed against the same seed produces the same failures.
- **Access hardware.** Two vendors, `access-provider-a` and `access-provider-b`,
  which genuinely disagree about timestamp formats. Both adapters are real code
  and the seed pushes its check-ins through them.
- **Email and SMS.** Accepted and written to the `outbox` table, where the
  notification log in the app reads them back. Nothing leaves the machine.

## Signal exports

The commercial side consumes platform data rather than querying the database:

```bash
npm run export:signals -- --since 2026-01-01 --out ../beefcake-product/signals/platform/
```

Writes `events.jsonl`, `errors.jsonl`, `payment-runs.csv`, `churn.csv`,
`tenant-health.csv` and `access-sync.csv`.

## Getting back to a known state

```bash
git checkout baseline
npm run db:reset -- --today $(date +%F)
npm run export:signals -- --out ../beefcake-product/signals/platform/
```

Takes under two minutes end to end. Use it whenever you have been poking at data
by hand and no longer trust what you are looking at. Passing today's real date
means all history, payment runs, churn and access events end today, so every
report reads as current.

## Hosting for the workshop

`Dockerfile` and `fly.toml` run the platform as one Fly.io machine with the
database on a volume at `/data/beefcake.db`. The image keeps `tsx` and `src/`
so the database can be reseeded in place over ssh:

```bash
fly ssh console -C "npm --prefix /app run --silent db:reset -- --today 2026-11-12 --quiet"
fly machine restart <id>     # the app holds the deleted file open until it restarts
```

The workshop repo's `workshop/setup/deploy-platform.sh` does all of it, and is
the way to deploy the evening before a run.

## Where to look

- `AGENTS.md`: shared instructions, workflows and the code map.
- `docs/agents/rules.md`: the rules that have caused incidents, and what not
  to touch without asking. Read it before your first change.
- `docs/domain-glossary.md`: the vocabulary, with the edge cases.
- `docs/adr/`: why the load-bearing decisions were made.
- `docs/runbooks/`: what to do when a payment run has not finished by 07:00.
