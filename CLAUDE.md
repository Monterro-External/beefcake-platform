# Beefcake platform

The rules below have each caused an incident. Everything else, the stack, the
commands, the code map, the workflows and the docs index, is in `AGENTS.md`.
Use the words in `docs/domain-glossary.md` in code, commits and support threads.

Weigh an edge case by which layer pays for it: a bug hurts a member, the site
manager hears about it at the desk, the owner calls support, repeated pain
churns the tenant.

## Rules

### Tenant isolation is non-negotiable

One process, one database, 340 operators. A query that forgets `tenant_id` shows
one gym's members to another. That is the one bug we cannot ship. See ADR-0001.

- `tenant_id` is on every tenant-scoped table, even where a join could derive it.
- Every read and write goes through a repository in `src/db/repositories/`.
  Never a raw `db.select()` against a tenant-scoped table outside that directory.
- Every repository function takes a `TenantScope` first and filters on it.
- Reads pass their rows through `guard()`, which throws if anything from another
  tenant came back. Keep it. It has caught real mistakes during refactors.
- Cross-tenant reads take an `AdminScope`, a deliberately incompatible type, so
  every one of them is visible in review.

### Money

Integer minor units plus an explicit `Currency`, always together. No bare
`amount` column, no float near an amount. See ADR-0002.

- Mixing currencies throws. It never silently coerces.
- Anything that can produce a fraction takes an explicit rounding mode:
  `half-up` for an invoice line, `half-even` for reconciliation.
- Splitting an amount uses `allocate()`, which preserves the total.
- Display currency comes from the amount, never the reader's locale. A Norwegian
  operator reading a Swedish report sees SEK on the SEK figures.

### Dates

Mixing the two kinds of time is the most common source of off-by-one-day bugs
here. See ADR-0005.

- An **instant** (`Date`, ISO-8601 with `Z`) is something that happened. Columns
  end `_at`. A **plain date** (`PlainDate`, `'YYYY-MM-DD'`) is a day on a
  calendar. Columns end `_on`.
- Instant to calendar day goes through `localDay(at, timezone)` with the *site's*
  timezone. Never the host's: CI runs in UTC, a developer runs in Stockholm, a
  Finnish site is an hour off both.
- Calendar arithmetic uses `src/domain/dates.ts`, never raw `Date`. `addMonths`
  clamps: 31 January plus one month is 28 February, never 3 March.
- Month ends are load-bearing. A freeze from the last day of a month resumes on
  the first day of a month. Test the boundary, in a leap year too.

### Derived state stays derived

`subscriptions.status` is intent. Frozen is a fact about the `freezes` table,
ended is a fact about `ends_on` and today. Both are computed in
`src/domain/subscriptions.ts`. Do not add columns for them: that is how a nightly
job and a screen end up disagreeing.

### Tenant settings

All settings live in one key-value table. `src/domain/tenant-settings.ts` is the
only place that knows what a key means, its type and its fallback. Read them with
`readSettings()`. Never read the raw rows and coerce at the call site, and never
duplicate a default: most tenants have no override, so a wrong default is a
fleet-wide incident. See ADR-0003.

### Integrations

`src/integrations/` holds an interface per external system and a deterministic
fake next to it. Fakes write everything they would have sent to `outbox`, which
is what makes "did the job actually notify the member" checkable.

The two door adapters exist because the vendors disagree: `access-provider-a`
sends ISO-8601 with an offset, `access-provider-b` a bare local wall-clock string
with no zone. That is why `normalise()` requires the site timezone. The adapter's
answer is what gets stored, so an adapter bug is a reporting bug.

### The seed

Deterministic: the same `--seed` and `--today` produce an identical database.
Nothing is hardcoded to a date; every date is an offset from `today`. Never use
`Math.random` under `src/db/seed`: use `createRng` from `src/lib/rng.ts`, and
`unitFor` rather than dividing a raw hash, or successive draws keyed on a counter
come out correlated. New seed data gets an invariant in `tests/unit/seed.test.ts`.

### Pure domain, tested domain

`src/domain/` has no database, no clock, no `new Date()` without an argument.
Pass the instant in. Everything there has tests in `tests/unit/`, named as
sentences about behaviour.

## What not to touch without talking to someone

- `src/db/repositories/scope.ts`. The isolation guarantee lives there.
- `src/domain/money.ts`. Every amount in the company goes through it.
- The defaults in `src/domain/tenant-settings.ts`. A changed default reaches all
  340 tenants at once.
- `src/db/migrations/`. Applied in order, never edited after they have run
  anywhere. Add a new one.
