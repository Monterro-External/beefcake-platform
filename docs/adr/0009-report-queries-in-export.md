# 9. Report queries live in src/export, outside the repositories

- Status: accepted
- Date: 2026-10-25
- Deciders: Per Hassle

## Context

ADR-0001 puts every read and write behind a repository in `src/db/repositories/`.
Report queries do not fit that shape. Revenue by period, churn with payment lag,
class fill and sync lag each join several entities and return aggregates. An
aggregate row carries no `tenant_id`, so `guard()` has nothing to check.

In practice the reports were written in `src/export/reports.ts`: 19 queries with
10 callers in pages, against four in repositories. Two of them existed in both
places, and in each case the repository copy had no callers.

## Decision

Cross-entity report queries live in `src/export/reports.ts`. Everything else
stays in a repository.

- A report function takes a `TenantScope` first and filters every table in the
  query on `scope.tenantId`, joined tables included.
- Where it returns full rows, they pass through `guard()`.
- It only reads. Writes go through a repository.
- A per-entity read (one member, a list of charges) belongs in the repository
  for that entity, even when a report page is the caller.

## Consequences

There are two places to look for a read, and the rule above decides which.

`guard()` cannot catch a missing filter in an aggregate. Review is the check: a
report query is approved only when every table in it is filtered on the tenant.
Plain id foreign keys do not enforce that both sides share a tenant, so the
filter on the joined side is what keeps one tenant's rows out of another's
report.

At the time of this decision several existing queries in `reports.ts` filter
only one side of a join (lines 74, 103, 144, 262, 387 and 424 at 831d102).
They are tracked as drift in `docs/conventions/report.html` and are brought in
line before new report queries copy them.
