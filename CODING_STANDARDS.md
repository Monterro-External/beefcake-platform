# Coding standards

How code is written here, by area. Read the section for the area you are about
to change; code review checks changes against this file. Each rule names an
example to copy.

The rules that have caused incidents (tenant isolation, money, dates, the seed)
are in `docs/agents/rules.md` and are not repeated here. Mechanical rules are
lint rules in `eslint.config.mjs`; this file holds the judgement calls. Why each
rule exists, and what was rejected, is in `docs/coding-standards/decisions.md`.

## Server actions

Scope: `src/app/actions/`.

- Take typed positional arguments and return `Promise<ActionResult>`
  (`{ ok, message }`). Example: `src/app/actions/settings.ts`.
- Return `{ ok: false, message }` for anything a user can cause: bad input, a
  missing permission, a disabled feature. Throw only for a state that means a
  bug. No caller catches and there is no error boundary, so a throw never
  reaches the user.
- Check a `PERMISSIONS` key in every action, member self-service (`self.book`,
  `self.subscription`) and staff-only actions included. Example:
  `src/app/actions/settings.ts`.
- Validate every input at runtime at the top of the action.
- Write the message as a full sentence that states the consequence: "Frozen
  from 1 March to 31 March. Back on 1 April."
- After a write, call `revalidatePath(<surface>, 'layout')`.
- Call an action from the client with `useTransition` and local state, and show
  the result in a `Callout`. Example: `src/app/(tenant)/app/members/new/form.tsx`.
- Orchestrate in the action or the job; there is no service layer. Pass
  dependencies on context objects (`JobContext`, `TenantScope`), not a container.

## Pages and route handlers

Scope: `page.tsx`, `layout.tsx` and `route.ts` under `src/app/`.

- Read through repositories, or `src/export/reports.ts` for a report. Server
  actions are for writes.
- Get the scope with `tenantScopeFor(await getSession())`.
- Narrow Beefcake staff to one tenant with `impersonate(admin, tenantId)`, so the
  scope keeps the staff actor. Example: `src/lib/session.ts`. A batch CLI with no
  person behind it (the signal export) builds
  `tenantScope(id, { db, actorRole: 'system' })`, like a job.
- Show money and dates through `src/lib/format`, passing `tenant.locale`.
- Return route-handler errors as `NextResponse.json({ error, hint? }, { status })`
  and send files with `cache-control: no-store`. Example:
  `src/app/(tenant)/app/reports/export/[report]/route.ts`.

### Screens

Pages and the components they render.

- When a list gains search or filters, narrow the list only. Every other figure
  on the page that read the same rows (tiles, callouts, the "In dunning" total)
  keeps its unfiltered meaning unless the Spec says otherwise.
- Key a rendered row by its own id, never by display fields such as member and
  timestamp, which can repeat.

## Data access and reports

Scope: `src/db/repositories/` and `src/export/`. Tenant isolation itself is in
`docs/agents/rules.md` and ADR-0001.

### Repositories

- Import as `import * as membersRepo from '@/db/repositories/members'`. Named
  imports from `observability` are fine.
- Write each function synchronous: `TenantScope` first, optional filter last, a
  default limit. Example: `src/db/repositories/members.ts`.
- Give a cross-tenant function an `AdminScope` and an `all*` name. Example:
  `allRunSummaries` in `src/db/repositories/payments.ts`.
- Map rows to domain types inside the repository (`toRecord` in
  `subscriptions.ts`). Cast `as PlainDate` only here, for a column the schema
  constrains.
- Build queries with Drizzle; raw SQL lives only in the seed writer.
- Return amounts as `amountMinor` plus `currency`. `Money` is built in the domain
  and in `src/lib/format`.
- Leave transactions to the caller, who writes events and outbox after the
  transaction. Example: `src/jobs/waitlist-promote.ts`.

### Reports

- Put a cross-entity report query in `src/export/reports.ts`: `TenantScope` first,
  every table in the query filtered on the tenant (joined ones included), full
  rows through `guard()`. A per-entity read stays in its repository. See ADR-0009.

### Queries

- Escape a search term from the address or a form for `\`, `%` and `_`, and
  compare with `escape '\'`; otherwise `?q=_` matches every row. Reuse
  `memberSearchCondition()` in `src/db/repositories/members.ts` for member
  searches.
- Build a list and its count ("12 matching charges") from the same conditions
  or subquery, so they never disagree.
- Make a paged or capped order total: add the row id after the sort column, or
  rows with equal timestamps swap between pages and reloads.

## Domain

Scope: `src/domain/`. Purity (no database, no clock) is in `docs/agents/rules.md`.

- Return a discriminated union on `ok` from a yes/no decision with reasons.
  Example: `src/domain/freezes.ts`. A domain word may be the discriminant where
  it carries meaning (`result: 'granted' | 'denied'` in `access-rules.ts`).
- Throw a built-in `TypeError` or `RangeError` for a bad argument, and a named
  `Error` subclass for anything a caller is expected to catch. Example:
  `CurrencyMismatchError` in `src/domain/money.ts`.
- Declare each value list once, here, as an `as const` array or a string-literal
  union; `src/db/schema.ts` imports it for its enum. Example: `CURRENCIES` in
  `src/domain/money.ts`. Lint rejects `enum`.
- Describe object shapes with an `interface` of `readonly` fields.
- Export named `function` declarations; default exports only where Next requires
  them.

## Time, ids and data

Scope: all of `src/`. The two kinds of time are in `docs/agents/rules.md` and
ADR-0005.

- Keep code below server actions synchronous.
- Take request time in actions and pages from `clock()` in `src/lib/clock.ts`;
  the CLIs and the job runner take their default `now` from it too. A job reads
  `now` from its context, so `--now` replays; a domain function takes the instant
  as an argument. `job_runs.finished_at` alone records the real wall clock.
- Write an instant with `.toISOString()`. Parse with `fromIso()` any string that
  did not come from one of our own `_at` columns.
- Check a plain date from a user, a URL or a file with `assertPlainDate()`.
- Make ids with `newId(kind)`, or `sequentialId(kind, n)` in the seed.
- Name TypeScript fields in camelCase; event and outbox payloads, error context
  and CSV headers in snake_case, because they are exported contracts.
- Record a failure with `recordError()`. CLIs write to stdout and stderr; lint
  rejects `console` in `src`.
- Get integrations from `createIntegrations()`.
- Get the database path from `databasePath()`. `tests/e2e` and root config files
  spell out `BEEFCAKE_DB`, because e2e imports nothing from `src`.

## Unit tests

Scope: `tests/unit/`. Naming tests as sentences about behaviour, and covering a
month end and a leap year, are in `AGENTS.md`.

- Get a database from `createTestDb()` in `tests/helpers/test-db.ts`. Until it
  takes a seed, a seeded test may set one up by hand as `tests/unit/jobs.test.ts`
  does.
- Title each `it` as a predicate that completes its `describe`:
  `describe('effective status')`, `it('is pending before the start date')`.
- Build inputs with a local `over: Partial<T>` builder in the test file. Example:
  `tests/unit/subscriptions.test.ts`.
- Pass time in, and test integrations through their fakes. Example:
  `tests/unit/jobs.test.ts`.

## E2E tests

Scope: `tests/e2e/`. Spec headers, tags and recorded evidence are in
`docs/testing/pr-evidence.md` and `docs/test-tags.md`.

- Use the acceptance template (`calendar-file/`, `class-fill/`) for a test tied
  to a BCPLA Spec, and the planner layout (`site-smoke/`) for a plan-driven test
  with no ticket. Both import `expect` from `../evidence`. The flat files in the
  root predate both and are not templates.
- Give a test that needs a precise state a fixture that inserts its own rows and
  removes them. Example: `tests/e2e/class-fill/hornstull.ts`. A read-only check
  may find rows in the seed. Create rows through the UI only when creating them is
  the test, and remove them afterwards.
- Locate form fields with `getByLabel`; use `data-*` attributes only to target a
  table row.
- Pass `exact: true` to a link or button lookup whose name can be a substring of
  another: `getByRole('link', { name: 'Payments' })` also matches "See all on
  Payments" and "All payments".
- Sign in with `signIn` and a persona cookie; drive the switcher only when it is
  under test.
- Test as a black box: through the browser and SQL, importing nothing from `src`.
