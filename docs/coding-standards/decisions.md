# Decision log

Newest first. One entry per decision, with the variants weighed and why. Rejected
and "neither" outcomes are recorded too, so a later scan does not propose them
again. The evidence for each entry is in the linked session report.

## 2026-10-25: first convention scan (commit 831d102)

Decided by Per Hassle. Evidence: [sessions/2026-10-25/report.html](sessions/2026-10-25/report.html).

### Competing patterns

**C1. Where report and aggregate queries live.** Variants: A Repository function (4); B src/export/reports.ts as read model (19).
Decision: Both, with a rule (25 Oct 2026). Per-entity reads and writes live in src/db/repositories. Cross-entity report queries live in src/export/reports.ts, take TenantScope first and pass full rows through guard(). rules.md names this exception. Removing the dead duplicates (payments.revenueByPeriod, access.allSyncLag) is an optional cleanup ticket. Why: An agent adding a report has two homes to choose from. Two queries already exist twice (revenue by period, sync lag), and the copy in the repository is the dead one. Rule: [data-access.md#reports](data-access.md#reports).

**C2. How a server action reports an expected failure.** Variants: A Return { ok: false, message } (40); B Throw (9).
Decision: A is the standard (25 Oct 2026). A server action returns { ok: false, message } for anything a user can cause, including a missing permission or a disabled feature. It throws only for states that mean a bug. Why: There is no error.tsx and no client caller catches. A thrown denial or a bad date becomes an unhandled rejection instead of a message at the desk. Rule: [server-actions.md](server-actions.md).

**C3. How a server action checks who may do it.** Variants: A requirePermission(session, key) (11); B Hand-written assertMay* (2); C session.isBeefcakeStaff (2).
Decision: A is the standard (25 Oct 2026). Every server action checks a PERMISSIONS key, including member self-service (self.book, self.subscription) and staff-only actions, and returns { ok: false, message } when the check fails (per C2). Adding a non-throwing check beside requirePermission and replacing assertMay* and isBeefcakeStaff checks are cleanup tickets. Why: PERMISSIONS defines self.book and self.subscription, and nothing uses them. Member rights are enforced ad hoc, so a new action is easy to ship with no check at all (statusOf and cancelBooking already are). Rule: [server-actions.md](server-actions.md).

**C4. How Beefcake staff narrow to one tenant.** Variants: A impersonate(admin, tenantId) (1); B Fresh tenantScope(id, { db }) (7).
Decision: A is the standard (25 Oct 2026). Staff narrow to one tenant with impersonate(admin, tenantId), so the scope keeps the staff actor. Exception: the batch signal export in src/export/signals.ts has no person behind it, so it builds per-tenant scopes the way jobs do, with tenantScope(id, { db, actorRole: 'system' }). The exception covers batch CLIs only, never a page or an action. Why: scope.ts offers impersonate() so the narrowed scope keeps the staff actor. Admin pages instead build an actorless tenantScope, so anything they write is not attributable. Rule: [pages.md](pages.md).

**C5. Where "now" comes from.** Variants: A clock() from src/lib/clock.ts (27); B defaultNow(db) in jobs/runner.ts (2); C seededToday(db) or new Date() (5).
Decision: A is the standard (25 Oct 2026). clock() from src/lib/clock.ts is the only source of request time in actions and pages, and of the default now in the CLIs and the job runner. Jobs keep reading now from their context so --now replays, and domain functions take the instant as an argument. Exception: job_runs.finished_at is stamped with the real wall clock, because it records when the process actually finished. Merging defaultNow and seededToday into clock() is a cleanup ticket. Why: Three copies of the seeded-today rule can drift apart, and one falls back to a UTC slice. A job run with --now still stamps real wall-clock finish times. Rule: [time-and-data.md](time-and-data.md).

**C6. How a domain function says "not allowed".** Variants: A Union on ok (1); B { allowed: boolean; reason? } (1); C Own discriminant per function (3).
Decision: Both A and C, with a rule (25 Oct 2026). A yes/no domain decision with reasons returns a discriminated union on ok. A domain word may be the discriminant where it carries meaning (granted/denied for access). { allowed, reason? } is not used in new code. Why: With an optional reason the type cannot narrow, and the caller writes guard.reason ?? ''. Each new decision invents its own key. Rule: [domain.md](domain.md).

**C7. Which error type a broken invariant throws.** Variants: A Built-in TypeError / RangeError (12); B Named subclass (3); C Plain Error (1).
Decision: Both A and B, with a rule (25 Oct 2026). Throw a built-in TypeError or RangeError for a bad argument, and a named Error subclass for anything a caller is expected to catch. A plain Error is not used. Moving proration.ts:91 to CurrencyMismatchError is a cleanup ticket. Why: Callers catch with instanceof (export route, reports page). A plain Error for a currency mix slips past a catch written for CurrencyMismatchError. Rule: [domain.md](domain.md).

**C8. Where status and enum value lists are defined.** Variants: A Inline in schema.ts (14); B Domain const or union (8).
Decision: B is the source (25 Oct 2026). A value list is declared once in src/domain as an as-const array or union, and src/db/schema.ts imports it for its enum. No migration is needed, because the column type does not change. Adding a ChargeStatus type and switching schema.ts over are cleanup tickets. Why: The schema and the domain each declare the same list. Adding a value to one compiles fine and breaks at runtime. Charge status has no type at all. Rule: [domain.md](domain.md).

**C9. Turning a database string into a PlainDate.** Variants: A as PlainDate cast (58); B assertPlainDate() / isPlainDate() (10).
Decision: Both, with a rule (25 Oct 2026). Cast as PlainDate only inside a repository mapper, for a column the schema constrains. Use assertPlainDate() for anything from a user, a URL or a file. Pages do not cast. Why: A cast lets '2026-02-30' type-check. ADR-0005 says the assert helpers are for boundaries and is silent on rows read back from the database. Rule: [data-access.md#repositories](data-access.md#repositories).

**C10. Converting instants to and from strings.** Variants: A .toISOString() / new Date(str) (100); B toIso() / fromIso() from dates.ts (2).
Decision: Both, with a rule (25 Oct 2026). Write instants with .toISOString(). Parse with fromIso() any string that did not come from one of our own _at columns. toIso is retired (cleanup ticket). Why: fromIso validates and new Date(string) does not. An invalid string becomes Invalid Date and renders as "Invalid Date" on a page. Rule: [time-and-data.md](time-and-data.md).

**C11. Importing repositories and integrations.** Variants: A import * as xRepo from '@/db/repositories/x' (47); B Barrel (@/db/repositories, @/domain) (0).
Decision: A is the standard (25 Oct 2026). Import repositories as import * as xRepo from '@/db/repositories/x'; named imports from observability are allowed. AGENTS.md is corrected to match. Deleting the unused barrels is a cleanup ticket. Why: AGENTS.md says repositories are reached "via index.ts", but nothing imports that barrel. Agents follow the doc and produce an import style no one else uses. Rule: [data-access.md#repositories](data-access.md#repositories).

**C12. Resolving the database path.** Variants: A databasePath() / DEFAULT_DB_PATH (2); B process.env.BEEFCAKE_DB ?? 'data/beefcake.db' (6).
Decision: Both, with a rule (25 Oct 2026). src and scripts call databasePath(). tests/e2e and root config files may spell out the env var and default, because e2e imports nothing from src. Why: Six places retype the env var and the default path. A changed default would leave tests and tools on the old file. Rule: [time-and-data.md](time-and-data.md).

**C13. Setting up a database in a unit test.** Variants: A createTestDb() (2); B mkdtemp + migrate + seed by hand (3).
Decision: A is the standard (25 Oct 2026). Unit tests get a database from createTestDb(). Until it takes an optional seed (small ticket), hand-rolled setup is allowed for seeded tests only. Why: Hand-rolled setup copies cleanup logic and leaks temp directories when it is missed. The helper has no seeded mode, so agents fall back to hand-rolling. Rule: [unit-tests.md](unit-tests.md).

**C14. Where an e2e test gets its data.** Variants: A Find suitable rows in the seed (2); B Fixture inserts and removes its own rows (1); C Create through the UI, no cleanup (3).
Decision: All three, with a rule (25 Oct 2026). A test that needs a precise state uses a fixture that inserts its own rows and removes them. Read-only checks may find rows in the seed. A test creates rows through the UI only when creating them is what it tests, and then it removes them. Why: workers is 1 and the database is shared. Rows created through the UI and never removed can be picked up later by helpers that search the seed. Rule: [e2e-tests.md](e2e-tests.md).

**C15. Three generations of e2e files.** Variants: A Acceptance folders (18); B Planner-generated folders (13); C Legacy root files (6).
Decision: A and B, with a rule (25 Oct 2026). Tests tied to a BCPLA Spec use the acceptance template. Plan-driven tests with no ticket use the planner layout. Both import expect from ../evidence. The legacy root files stay as they are and are never copied. Why: A new test copied from a legacy file gets a 5-second expect, no tags and no evidence, and never shows up in a PR. Rule: [e2e-tests.md](e2e-tests.md).

**C16. Locating form fields in e2e tests.** Variants: A getByLabel('Email') (3); B CSS input[name=…] (1).
Decision: A is the standard (25 Oct 2026). Form fields are located with getByLabel. data-* attributes are used only to target table rows. Why: A CSS locator passes even when the label is not wired to the input, so an accessibility regression goes unnoticed. Rule: [e2e-tests.md](e2e-tests.md).

**C17. How a unit test title reads.** Variants: A Predicate that completes the describe (380); B Standalone sentence with its own subject (57).
Decision: A is the standard (25 Oct 2026). An it() title is a predicate that completes its describe(). Existing standalone titles stay as they are. Why: Mixed titles read oddly in the reporter ("effective status a member …"). Low risk. Rule: [unit-tests.md](unit-tests.md).

### Terminology

Recorded in `docs/domain-glossary.md`.

- **Subscription (member-facing)**: code and staff UI say subscription; the member UI may say membership. Glossary gets a member-facing words section.
- **Site (member-facing)**: site in code and the tenant UI; the member UI may say gym. Same glossary section.
- **Access event**: access event in code and glossary; the member UI says visit; the staff UI says check-in (granted) or denied, never "event". Renaming the tenant heading is a small ticket.
- **event**: event means a row in events; UI never calls a swipe an event.
- **plan**: new glossary entry Plan tier, Beefcake's pricing tier for a tenant, never just "plan". No rename.
- **session**: the glossary Class definition stops using "session"; session in code means the signed-in user's session only.
- **member**: glossary line that a user with role member is a sign-in persona linked to one members row.
- **Statuses not in glossary**: glossary entries for former ("Archived" in the UI), churned, and the cancelling label "Notice given".
- **Site scope**: no rename; the glossary Site scope entry notes the column sites_scope.

The glossary already decided tenant, abandoned, freeze and involuntary churn; code that says otherwise is drift, not a decision.

### Consistent conventions

Recorded: K1, K2, K3, K4, K5, K6, K7, K8, K9, K10, K11, K12, K14, K15, K16, K17, K18, K19, K20, K22, K23, K26, K27, K28, K29.
Rejected as rules (true, but agents copy them from neighbouring code): K13 pagination: filter { limit?, offset? }; pages read ?page defensively; K21 file names are kebab-case; K24 boolean fields are bare adjectives (granted, dryrun); predicate functions start is/has/can; K25 unit tests use describe + it with explicit vitest imports, one file per module in tests/unit.

### Absences

- **A1. No service or application layer.** Deliberate. Recorded as one line: orchestration lives in server actions and jobs; do not add a service layer.
- **A2. No DI container.** Deliberate. Recorded as one line: dependencies travel on context objects; no DI container.
- **A3. No way to hand integrations into runJob.** Gap. Cleanup ticket: let runJob take integrations.
- **A4. No central config module.** Deliberate. No line needed.
- **A5. No lint-enforced layer boundaries.** Gap. Proposed lint rule (no-restricted-imports for layer boundaries), added only after a yes.
- **A6. zod is a dependency with zero imports.** Intent recorded: every server action validates its input at runtime. A ticket chooses the tool (adopt zod or remove it).
- **A7. No error.tsx, global-error.tsx or not-found.tsx.** Gap. Ticket: add error.tsx and global-error.tsx for bugs that still throw (see C2).
- **A8. No site-timezone resolver.** Gap. Ticket: a site-timezone resolver outside src/jobs, which also fixes the timezone drift.
- **A9. No id-prefix validation.** Deliberate. No line needed: a scoped lookup returning null is the id check.
- **A10. No logger and no stack traces.** Deliberate, covered by K16. Passing the stack to recordError is a ticket.
- **A11. No unit tests for server actions or src/lib.** Gap. Ticket: unit tests for server actions and src/lib (can(), clock, format).
- **A12. Money objects are rarely used outside the domain.** Deliberate. Recorded as one line: repositories return amountMinor + currency pairs; Money is built in the domain and in format.
- **A13. No Prettier or other formatter.** Parked. Formatting tooling is a team choice (see Open questions).

### Tool rules

- `no-console` in `src` (K16) and a ban on TS `enum` (K20) were added to `eslint.config.mjs` instead of prose. `src/instrumentation.node.ts` may use `console`, because it bridges console to OpenTelemetry.
- A `no-restricted-imports` rule for layer boundaries (A5) waits for the site-timezone resolver (A8), since pages import `timezoneForCountry` from `src/jobs` today.

### Architecture

- C1 is recorded as [ADR-0009](../adr/0009-report-queries-in-export.md): cross-entity report queries live in `src/export/reports.ts`.
