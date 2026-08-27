# Beefcake platform

Gym management software for Nordic operators. This repo is the whole product:
one Next.js application serving three surfaces, one SQLite database, a handful
of scheduled jobs and two hardware integrations.

Read this before changing anything. The rules below are not style preferences,
they are the things that have caused incidents.

## What the product is

Beefcake AB (Stockholm, founded 2016) sells gym management software to about 340
gym operators in Sweden, Norway, Finland and Denmark. Operators pay per site per
month, plus a percentage of the member payments we process through Beefcake Pay.

**Three layers, and they are never the same thing:**

```
Beefcake (us)  →  tenant (a gym operator)  →  member (the operator's customer)
```

A bug hurts a **member**. The **site manager** hears about it at the front desk.
The **owner** calls our support. Repeated pain churns the **tenant**, and a
tenant is worth between 30,000 SEK and 4 MSEK a year. When you are weighing an
edge case, ask which of the three layers pays for getting it wrong.

Segments, because behaviour differs sharply between them:

| Segment | Roughly | Shape |
|---|---|---|
| Long tail | 250 operators | Single site, few hundred members, loud in support |
| Mid | 80 operators | 2 to 5 sites, 1,000 to 3,500 members |
| Key accounts | 10 chains | 6 to 15 sites, up to 22,000 members, ~35% of ARR |

The two key accounts in the seed are **Nordic Fitness Group** (15 sites, SE and
NO, ~22,000 members) and **Kraft Trening** (8 sites, NO, ~9,000 members). Any
change to a report, an export or a job needs to be considered at their volume,
not at a single-site gym's.

## Surfaces

| Path | Who | What |
|---|---|---|
| `/app` | owner, site_manager, front_desk | Members, subscriptions, classes, payments, access, reports, settings |
| `/me` | member | Class schedule and booking, own subscription, receipts, access QR |
| `/admin` | beefcake_admin | Tenant list and detail, feature flags, read-only impersonation |

Roles are `beefcake_admin`, `owner`, `site_manager`, `front_desk`, `member`.
In development there is no real auth: a persona switcher picks a user and tenant.

## Glossary

Use these words in code, in commits and when talking to support. They map
one-to-one onto the customer's vocabulary in all four markets.

| Term | Means |
|---|---|
| **tenant** | A gym operator, our paying customer. One row in `tenants`. |
| **site** | One physical gym. A tenant has one or more. Carries its own timezone and access hardware. |
| **member** | The operator's customer. Belongs to a tenant, has a home site. |
| **plan** | A priced product a tenant sells: name, price, interval, binding months, site scope. Per tenant, never shared. |
| **subscription** | A member on a plan. The `status` column is *intent*; frozen and expired are derived, see below. |
| **binding period** | Months the member committed to. Blocks a downgrade, not an upgrade. Pushed out by a freeze. |
| **notice period** | Days between giving notice and the subscription ending. Tenant setting, 30 days by default. |
| **freeze** | A paused subscription, whole months. Swedish *uppehåll*, Norwegian *frys*. Not billed, no access, binding extended. |
| **payment run** | The monthly batch that charges every member of one tenant. Goes out on the 25th, bills that calendar month in arrears. |
| **charge** | One attempt to take money for one member for one period. A retry is a new row with a higher `attempt`. |
| **dunning** | The retry sequence after a failed charge. 3 attempts, 3 days apart, by default. |
| **abandoned** | Dunning gave up. This is the event that shows up as a cancellation two to three weeks later. |
| **mandate** | A member's standing authorisation to be debited (Autogiro, AvtaleGiro). No mandate, no charge. |
| **waitlist** | Ordered queue on a full class. Position 1 is next. Promotion releases any clashing booking the member holds. |
| **access event** | A swipe at a door, granted or denied, with a reason. |
| **allow-list** | What we push to a door controller so it works offline. Derived from the same rules as `evaluateAccess`. |
| **grace hours** | Access still granted for N hours after a **freeze** starts. Never after a cancellation. |
| **health score** | 0 to 100 per tenant, from platform inputs only. Sorts 340 tenants for the CS team. |
| **outbox** | Every notification we would have sent. The fake email and SMS gateways write here. |

Markets: SEK/`sv-SE`/`Europe/Stockholm`, NOK/`nb-NO`/`Europe/Oslo`,
EUR/`fi-FI`/`Europe/Helsinki`, DKK/`da-DK`/`Europe/Copenhagen`. Payment methods
are Autogiro (SE), AvtaleGiro (NO) and card (FI, DK). MobilePay and Vipps are on
the backlog and are not wired up.

## Architecture

```
src/
  app/            Next.js App Router. (tenant)/app, (member)/me, (admin)/admin
  domain/         Pure logic, no I/O. money, dates, proration, billing, freezes,
                  cancellation, waitlist, access-rules, retry-policy,
                  subscriptions, tenant-settings, health
  db/             schema, migrations, repositories, seed
  integrations/   Interfaces plus deterministic fakes for PSP, door hardware, email
  jobs/           payment-run, access-sync, waitlist-promote
  export/         Signal exports consumed by the commercial side
tests/
  unit/           Vitest. Everything in src/domain has tests here.
  e2e/            Playwright, a small number of whole flows.
docs/
  adr/            Why the load-bearing decisions were made
  runbooks/       What to do at 07:00 when a payment run has not finished
```

Decisions worth knowing before you argue with the code are in `docs/adr/`.
SQLite, money as minor units, tenant settings as key-value, a job runner with no
queue, plain dates for calendar logic.

## Rules

### Tenant isolation is non-negotiable

One process, one database, 340 operators. A query that forgets `tenant_id` shows
one gym's members to another. That is the one bug we cannot ship.

- `tenant_id` is on **every** tenant-scoped table, even where a join could derive it.
- Every read and write goes through a repository in `src/db/repositories/`.
- Every repository function takes a `TenantScope` first and filters on it.
- Reads pass their rows through `guard()`, which throws if anything from another
  tenant came back. Keep it. It has caught real mistakes during refactors.
- Cross-tenant reads take an `AdminScope`, a deliberately incompatible type, so
  every one of them is visible in review.

Never write a raw `db.select()` against a tenant-scoped table outside
`src/db/repositories/`.

### Money

- Integer minor units plus an explicit `Currency`, always together. There is no
  bare `amount` column and no float anywhere near an amount.
- Mixing currencies throws. It never silently coerces.
- Anything that can produce a fraction takes an explicit rounding mode. Pick it
  deliberately: `half-up` for an invoice line, `half-even` for reconciliation.
- Splitting an amount uses `allocate()`, which preserves the total.
- Display currency comes from the **amount**, never from the reader's locale. A
  Norwegian operator reading a Swedish report sees SEK on the SEK figures.

### Dates

Two kinds of time, and mixing them is the single most common source of
off-by-one-day bugs here:

- An **instant** (`Date`, stored as ISO-8601 with `Z`). Something that happened:
  a check-in, a charge attempt. Column names end `_at`.
- A **plain date** (`PlainDate`, `'YYYY-MM-DD'`). Something on a calendar: the
  day a freeze ends, a billing boundary. No timezone, because "the freeze ends
  on 28 February" means the same in Oslo and Helsinki. Column names end `_on`.

Rules:
- Converting an instant to a calendar day goes through `localDay(at, timezone)`
  with the **site's** timezone. Never the host machine's: CI runs in UTC and a
  developer runs in Stockholm, and a Finnish site is an hour off both.
- Calendar arithmetic uses `src/domain/dates.ts`, not raw `Date`.
- `addMonths` clamps: 31 January plus one month is 28 February, never 3 March.
- Month ends are load-bearing. A freeze from the last day of a month resumes on
  the first day of a month. Test the month boundary, in a leap year too.

### Derived state stays derived

`subscriptions.status` is the intent someone expressed. Whether a subscription
is *frozen* is a fact about the `freezes` table, and whether it has *ended* is a
fact about `ends_on` and today's date. Both are computed in
`src/domain/subscriptions.ts`. Do not add columns for them: that is how a
nightly job and a screen end up disagreeing.

### Tenant settings

All settings live in one key-value table. `src/domain/tenant-settings.ts` is the
only place that knows what a key means, what type it has and what it falls back
to. Read settings with `readSettings()`. Never read the raw rows and coerce at
the call site, and never duplicate a default: most tenants have no override, so a
wrong default is a fleet-wide incident.

### Integrations

`src/integrations/` holds an interface per external system and a deterministic
fake next to it. Fakes write everything they would have sent to `outbox`, which
is what makes "did the job actually notify the member" checkable.

The two door-hardware adapters exist because the vendors genuinely disagree:
`access-provider-a` sends ISO-8601 with an offset, `access-provider-b` sends a
bare local wall-clock string with no zone at all. That is why `normalise()`
requires the site timezone. The adapter's answer is what gets stored, so an
adapter bug is a reporting bug.

## Running it

```bash
npm install
npm run db:reset          # drop, migrate, seed. ~15s, ~1.8M rows
npm run dev               # http://localhost:3000
```

| Command | Does |
|---|---|
| `npm run db:reset` | Rebuild the development database from scratch |
| `npm run db:reset -- --scale small` | About a twelfth of the data, ~1.5s. Use this while iterating |
| `npm run db:reset -- --today 2026-11-12` | Same story, shifted in time |
| `npm run db:migrate` | Apply pending migrations without reseeding |
| `npm run db:studio` | Drizzle Studio against the local database |
| `npm test` | Vitest, everything under `tests/unit` |
| `npm run test:watch` | Same, watching |
| `npm run test:e2e` | Playwright |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run jobs:payment-run` | Run the monthly payment run |
| `npm run jobs:access-sync` | Push allow-lists to the door controllers |
| `npm run jobs:waitlist-promote` | Promote waitlisted members into freed spots |
| `npm run export:signals` | Write the signal exports for the commercial side |

`$BEEFCAKE_DB` overrides the database path. Default `data/beefcake.db`, which is
not committed.

### The seed

Deterministic: the same `--seed` and `--today` produce an identical database, so
a screenshot, a test expectation and a colleague's laptop all agree. Nothing in
it is hardcoded to a date; every date is an offset from `today`, which defaults
to the pinned development date in `src/db/seed/options.ts`.

It positions the story so the app looks live: the last monthly payment run has
just completed, the next one is due, some charges are mid-retry, classes are on
the schedule for the coming fortnight, and freezes cluster in January and over
the summer the way they actually do.

If you add data to the seed, add it to `src/db/seed/` and give it an invariant in
`tests/unit/seed.test.ts`. Never use `Math.random` under `src/db/seed`: use
`createRng` from `src/lib/rng.ts`, and use `unitFor` rather than dividing a raw
hash, or successive draws keyed on a counter come out correlated.

## Conventions

- TypeScript everywhere, `strict` plus `noUncheckedIndexedAccess`.
- Ids are prefixed text: `ten_`, `sit_`, `mem_`, `sub_`, `chg_`. Readable in a
  log line and impossible to join to the wrong table by accident.
- Domain modules are pure. No database, no clock, no `new Date()` without an
  argument. Pass the instant in.
- Comments explain *why*, and specifically why the obvious thing is wrong here.
  If a comment restates the code, delete it.
- Tests are named as sentences about behaviour, not about functions.

## What not to touch without talking to someone

- `src/db/repositories/scope.ts`. The isolation guarantee lives there.
- `src/domain/money.ts`. Every amount in the company goes through it.
- The `tenant_settings` defaults in `src/domain/tenant-settings.ts`. Most tenants
  have no override, so a changed default reaches everyone at once.
- `src/db/migrations/`. Migrations are applied in order and never edited after
  they have run anywhere. Add a new one.

## Agent skills

### Issue tracker

Linear, team Beefcake (`BC`), via the Linear MCP tools. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, default names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` plus `docs/adr/`. See `docs/agents/domain.md`.
