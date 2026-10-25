# Conventions

How code is written here, layer by layer. `rules.md` holds the rules that have
caused incidents; this file is the house style around them. Each rule names an
example to copy. The evidence and the reasoning behind every rule are in
`docs/conventions/report.html` (decided 25 Oct 2026).

## Server actions (`src/app/actions/`)

- Take typed positional arguments and return `Promise<ActionResult>`
  (`{ ok, message }`). Example: `src/app/actions/settings.ts`.
- Return `{ ok: false, message }` for anything a user can cause: bad input, a
  missing permission, a disabled feature. Throw only for a state that means a
  bug. No caller catches and there is no error boundary, so a throw never
  reaches the user.
- Check a `PERMISSIONS` key in every action, member self-service (`self.book`,
  `self.subscription`) and staff-only actions included.
- Validate every input at runtime at the top of the action.
- Write the message as a full sentence that states the consequence: "Frozen
  from 1 March to 31 March. Back on 1 April."
- After a write, call `revalidatePath(<surface>, 'layout')`.
- Call an action from the client with `useTransition` and local state, and show
  the result in a `Callout`. Example: `src/app/(tenant)/app/members/new/form.tsx`.
- Orchestrate in the action or the job; there is no service layer. Pass
  dependencies on context objects (`JobContext`, `TenantScope`), not a container.

## Pages and route handlers (`src/app/`)

- Read through repositories, or `src/export/reports.ts` for a report. Server
  actions are for writes.
- Get the scope with `tenantScopeFor(await getSession())`.
- Narrow Beefcake staff to one tenant with `impersonate(admin, tenantId)`, so the
  scope keeps the staff actor. A batch CLI with no person behind it (the signal
  export) builds `tenantScope(id, { db, actorRole: 'system' })`, like a job.
- Show money and dates through `src/lib/format`, passing `tenant.locale`.
- Return route-handler errors as `NextResponse.json({ error, hint? }, { status })`
  and send files with `cache-control: no-store`.

## Repositories (`src/db/repositories/`)

- Import as `import * as membersRepo from '@/db/repositories/members'`. Named
  imports from `observability` are fine.
- Write each function synchronous: `TenantScope` first, optional filter last, a
  default limit. Example: `src/db/repositories/members.ts`.
- Give a cross-tenant function an `AdminScope` and an `all*` name. Example:
  `allRunSummaries` in `src/db/repositories/payments.ts`.
- Map rows to domain types inside the repository (`toRecord`). Cast
  `as PlainDate` only here, for a column the schema constrains.
- Build queries with Drizzle; raw SQL lives only in the seed writer.
- Return amounts as `amountMinor` plus `currency`. `Money` is built in the domain
  and in `src/lib/format`.
- Leave transactions to the caller, who writes events and outbox after the
  transaction. Example: `src/jobs/waitlist-promote.ts`.

## Reports (`src/export/`)

- Put a cross-entity report query in `reports.ts`: `TenantScope` first, every
  joined table filtered on the tenant, full rows through `guard()`. See ADR-0009.

## Domain (`src/domain/`)

- Return a discriminated union on `ok` from a yes/no decision with reasons.
  Example: `src/domain/freezes.ts`. A domain word may be the discriminant where
  it carries meaning (`result: 'granted' | 'denied'` in `access-rules.ts`).
- Throw a built-in `TypeError` or `RangeError` for a bad argument, and a named
  `Error` subclass for anything a caller is expected to catch. Example:
  `CurrencyMismatchError` in `src/domain/money.ts`.
- Declare each value list once, here, as an `as const` array or a string-literal
  union; `src/db/schema.ts` imports it for its enum. Example: `CURRENCIES` in
  `src/domain/money.ts`.
- Describe object shapes with an `interface` of `readonly` fields.
- Export named `function` declarations; default exports only where Next requires
  them.

## Time, ids and data, everywhere in `src/`

- Code below server actions is synchronous.
- Take request time in actions and pages from `clock()` in `src/lib/clock.ts`, and
  the CLIs and the job runner take their default `now` from it too. A job reads
  `now` from its context, so `--now` replays; a domain function takes the instant
  as an argument. `job_runs.finished_at` alone records the real wall clock.
- Write an instant with `.toISOString()`. Parse with `fromIso()` any string that
  did not come from one of our own `_at` columns.
- Check a plain date from a user, a URL or a file with `assertPlainDate()`.
- Make ids with `newId(kind)`, or `sequentialId(kind, n)` in the seed.
- Name TypeScript fields in camelCase; event and outbox payloads, error context
  and CSV headers in snake_case, because they are exported contracts.
- Record a failure with `recordError()`. CLIs write to stdout and stderr.
- Get integrations from `createIntegrations()`.
- Get the database path from `databasePath()`. `tests/e2e` and root config files
  spell out `BEEFCAKE_DB`, because e2e imports nothing from `src`.

## Unit tests (`tests/unit/`)

- Get a database from `createTestDb()` in `tests/helpers/test-db.ts`. Until it
  takes a seed, a seeded test may set one up by hand as `tests/unit/jobs.test.ts`
  does.
- Title each `it` as a predicate that completes its `describe`:
  `describe('effective status')`, `it('is pending before the start date')`.
- Build inputs with a local `over: Partial<T>` builder in the test file.
- Pass time in, and test integrations through their fakes. Example:
  `tests/unit/jobs.test.ts`.

## E2E tests (`tests/e2e/`)

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
- Sign in with `signIn` and a persona cookie; drive the switcher only when it is
  under test.
- Test as a black box: through the browser and SQL, importing nothing from `src`.
