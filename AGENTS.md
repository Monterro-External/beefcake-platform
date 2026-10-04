# AGENTS.md

Shared repository instructions for all coding assistants and contributors.
Keep project rules here and in the linked docs, independent of the tool used.

Be extremely concise.
End each plan with the open questions.

Gym management SaaS for ~340 Nordic gym operators (SE, NO, FI, DK): members,
subscriptions, classes, payments, door access, reporting. One Next.js app
serving three surfaces, one SQLite file, three scheduled jobs, two door-hardware
adapters. A tenant is worth 30k SEK to 4 MSEK a year; ten key accounts are ~35%
of ARR, so size every report, export and job against Nordic Fitness Group
(15 sites, ~22,000 members).

Read `docs/agents/rules.md` before the first change: it holds the rules that
have caused incidents and the files to leave alone. This file is the map.

## Stack

- Next.js 15 App Router, React 19, TypeScript `strict` + `noUncheckedIndexedAccess`.
- Drizzle ORM on better-sqlite3. Schema in `src/db/schema.ts`, SQL migrations in `src/db/migrations/`.
- Tailwind 4; tokens in `tokens/tokens.json`; components in `src/components/ui`.
- Vitest unit tests in `tests/unit/`, a handful of Playwright flows in `tests/e2e/`.
- No queue, no auth in dev (persona switcher), no external services: fakes write to `outbox`.
- Ids are prefixed text (`ten_`, `sit_`, `mem_`, `sub_`, `chg_`), see `ID_PREFIXES` in `src/db/ids.ts`.

## Code by concept

| Concept | Where | Symbols |
|---|---|---|
| Tenant isolation | `src/db/repositories/scope.ts` | `TenantScope`, `AdminScope`, `guard()`, `impersonate()` |
| Data access | `src/db/repositories/` | `membersRepo`, `paymentsRepo`, ... via `index.ts` |
| Money | `src/domain/money.ts` | `Money`, `Currency`, `Rounding`, `allocate()`, `prorate()` |
| Calendar time | `src/domain/dates.ts` | `PlainDate`, `localDay()`, `addMonths()`, `BillingPeriod` |
| Subscription state | `src/domain/subscriptions.ts` | `effectiveStatus()`, `isBillableIn()`, `canChangePlan()` |
| Freezes, cancellation, dunning | `src/domain/` | `freezes.ts`, `cancellation.ts`, `retry-policy.ts`, `billing.ts` |
| Tenant settings and flags | `src/domain/tenant-settings.ts` | `readSettings()`, `DEFAULT_SETTINGS`, `FEATURE_FLAGS` |
| Session, roles, permissions | `src/lib/session.ts` | `getSession()`, `scopeFor()`, `can()`, `PERMISSIONS` |
| Jobs | `src/jobs/` | `runJob()`, `paymentRunJob`, `accessSyncJob`, `waitlistPromoteJob` |
| Integrations and fakes | `src/integrations/` | `createIntegrations()`, `PaymentProvider`, `AccessProvider.normalise` |
| Door adapters | `src/integrations/access/` | `createAccessProviderA()` (ISO + offset), `createAccessProviderB()` (bare wall clock) |
| Seed | `src/db/seed/` | `seedDatabase()`, `anchorsFor()`, `SCALES`; `createRng()`, `unitFor()` in `src/lib/rng.ts` |
| Signal exports and reports | `src/export/` | `exportSignals()`, `tenantHealth()`, `churnWithPaymentLag()` |
| Surfaces | `src/app/(tenant)`, `(member)`, `(admin)` | `/app`, `/me`, `/admin`; server actions in `src/app/actions/` |
| Timezones | `src/domain/dates.ts` | `TIMEZONES`; `timezoneForCountry()` in `src/jobs/runner.ts` |
| Acceptance specs and PR evidence | `specs/`, `tests/e2e/<feature>/`, `.github/scripts/` | `recordEvidence`, `@acceptance`, `// spec:` header, `parseSpec()` |

## Commands

`package.json` is the source of truth. The flags worth knowing:

```bash
npm run db:reset -- --scale small          # drop, migrate, seed in ~1.5 s (full: 15 s, 470 MB)
npm run db:reset -- --today 2026-11-12 --seed my-experiment   # same story shifted; deterministic
npm run dev                                # http://localhost:3000, persona switcher in the header
npm run lint && npm run typecheck && npm test                 # what CI runs, with TZ=UTC
npm run test:e2e                           # needs a seeded db; starts the dev server itself
npm run jobs:payment-run -- --now 2026-09-25 --tenant ten_000000b --dry-run
npm run export:signals -- --since 2026-01-01 --out ../beefcake-product/signals/platform/
npm run db:studio                          # browse data/beefcake.db ($BEEFCAKE_DB to relocate)
```

Start with tenant Puls Träning for ordinary work, Nordic Fitness Group for volume.

## Workflows

### Gitflow

- Start ordinary work from `origin/develop`; target PRs at `develop`.
- Use `feature/<topic>`. Start `release/<version>` from `develop` and
  `hotfix/<version>` from `main`.
- If a tool requires a branch namespace, use `<tool>/feature/<topic>`,
  `<tool>/release/<version>` or `<tool>/hotfix/<version>` with the same flow.
- Use merge commits. Return releases and hotfixes to `develop`; also return
  hotfixes to an active release branch. Tag releases on `main` as `vX.Y.Z`.
- Follow `docs/gitflow.md`. Never push ordinary work directly to `main` or
  `develop`.

### Change domain behaviour

1. Read the glossary section and the ADR for the area. Use the glossary's words in code, tests and commits.
2. Put the logic in `src/domain/` as a pure function. Pass the instant and the site timezone in; the module never touches the clock or the database.
3. Add a test in `tests/unit/` named as a sentence about behaviour. Where dates are involved, cover a month end and a leap year.
4. Persist through a repository function that takes `TenantScope` first and returns rows through `guard()`.
5. Expose it via a server action in `src/app/actions/` and the page. Settings come from `readSettings()`.
6. New seed data: draw from `createRng()` and `unitFor()`, then add an invariant to `tests/unit/seed.test.ts`.
7. Done when lint, typecheck and unit tests pass and `npm run db:reset -- --scale small` still builds.

### Change the schema

1. Edit `src/db/schema.ts`. Every tenant-scoped table carries `tenant_id`; instants end `_at`, plain dates `_on`; an amount is minor units plus a `currency` column.
2. Add a new numbered SQL file under `src/db/migrations/` with a journal entry. A migration that has run anywhere stays as it is.
3. Update the seed writers in `src/db/seed/` and the repository for the table.
4. Done when `npm run db:reset` at full scale, `npm run build` and the seed suite pass. CI rebuilds the full database on every change.

### Reproduce a job or date bug

1. `npm run db:reset -- --today <day>` so the story surrounds the day in question. The default seeded day is `PINNED_TODAY`.
2. Run the job with `--now <instant or day> --tenant <id> --dry-run`. Jobs read `now` from the context, never the clock, so any date is replayable.
3. Inspect `job_runs` and `outbox` for what the job did and what it would have sent.
4. Read the matching runbook in `docs/runbooks/` before changing anything.
5. Fix in `src/domain/` with a unit test at the boundary, then re-run the same command. Identical seed and today give an identical database, so the diff is the fix.

Implementing a screen from a Figma URL follows `docs/agents/design-system.md`.

## Docs

- `docs/agents/rules.md`: shared engineering rules and files requiring discussion.
- `docs/gitflow.md`: branches, pull requests, releases, hotfixes and CI.
- `docs/domain-glossary.md`: canonical vocabulary with edge cases; the three layers, segments, plans, money, classes, access, signals. No root `GLOSSARY.md`.
- `docs/adr/0001-tenant-id-on-every-table.md`: isolation via `tenant_id` everywhere plus a repository layer.
- `docs/adr/0002-money-as-minor-units.md`: integer minor units with explicit currency and rounding.
- `docs/adr/0003-tenant-settings-as-kv.md`: one key-value table, defaults in one module.
- `docs/adr/0004-no-outbound-refunds.md`: downgrades produce credit rather than refunds.
- `docs/adr/0005-plain-dates-for-calendar-logic.md`: `PlainDate` for calendars, instants for events.
- `docs/adr/0006-job-runner-without-a-queue.md`: jobs are idempotent scripts a scheduler runs.
- `docs/adr/0007-sqlite-for-now.md`: one SQLite file, and the conditions for leaving it.
- `docs/adr/0008-three-surfaces-one-application.md`: tenant, member and admin in one Next.js app.
- `docs/runbooks/payment-run-failed.md`: 07:00 and the run has not finished, or a double charge.
- `docs/runbooks/access-sync-stuck.md`: a door on a stale allow-list, or the sync-lag alert.
- `docs/runbooks/tenant-onboarding.md`: signed contract to a gym that charges and opens its door.
- `docs/agents/domain.md`: how skills consume the glossary and ADRs.
- `docs/agents/issue-tracker.md`: Linear via MCP; team `BCPLA`, product tickets in `BCPRO` read-only.
- `docs/agents/triage-labels.md`: the five triage roles mapped to label strings.
- `docs/agents/design-system.md`: implementing from Figma with `tokens/figma-map.json`.
- `docs/testing/pr-evidence.md`: the BCPLA Spec issue holds the Gherkin, `specs/` the Playwright plans; agents and PR evidence.
- `docs/test-tags.md`: the one list of test tags (ticket, area, type, run).
- `docs/figma-design-system-plan.md`: the three Figma files and the plan for the library.
- `docs/figma-design-system-step3.md`: the token decisions handed into the codebase.

## Agent skills

### Issue tracker

Linear via MCP: team `BCPLA`, with Product Tickets in `BCPRO` (read-only). See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels, in a Linear `triage` label group. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `docs/domain-glossary.md` and `docs/adr/`. See `docs/agents/domain.md`.
