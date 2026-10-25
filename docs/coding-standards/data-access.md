# Data access and reports

Scope: `src/db/repositories/` and `src/export/`. Tenant isolation itself is in
`docs/agents/rules.md` and ADR-0001.

## Repositories

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

## Reports

- Put a cross-entity report query in `src/export/reports.ts`: `TenantScope` first,
  every table in the query filtered on the tenant (joined ones included), full
  rows through `guard()`. A per-entity read stays in its repository. See ADR-0009.
