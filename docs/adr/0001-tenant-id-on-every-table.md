# 1. tenant_id on every table, enforced in a repository layer

- Status: accepted
- Date: 2025-09-08
- Deciders: Sara Lindqvist, Elin Sandberg

## Context

One process and one database serve every operator. We have 340 of them, from a
single gym in Umeå to a fifteen-site chain. A query that forgets to filter by
tenant does not fail, it returns someone else's members. That is the one class of
bug that ends a customer relationship on the spot, and it is exactly the kind of
mistake a refactor introduces quietly.

Two shapes were on the table:

1. Derive the tenant through joins. `charges` reaches a tenant through
   `subscriptions` and `members`, so the column would be redundant.
2. Carry `tenant_id` on every tenant-scoped table and filter on it directly.

## Decision

`tenant_id` goes on every tenant-scoped table, even where a join could derive
it, and all access goes through `src/db/repositories/`.

- Every repository function takes a `TenantScope` as its first argument and
  filters on `scope.tenantId`.
- Reads pass their result through `guard()`, which throws a
  `TenantIsolationError` if a row from another tenant came back.
- Cross-tenant access takes an `AdminScope`. It is a separate type that cannot
  be passed where a `TenantScope` is expected, so every cross-tenant query is
  visible in review rather than hidden in a `where` clause.

## Consequences

Good:

- A missing filter is caught by the guard in development and in CI rather than
  by a customer.
- Report queries filter on one indexed column instead of joining three tables.
  This is most of why the churn and revenue reports are usable at key-account
  volume at all.
- "Which tenant does this row belong to" is answerable from the row.

Bad:

- The column is denormalised, so a wrong value is possible in principle. The
  seed asserts the invariant and so does `tests/unit/seed.test.ts`.
- Every write has to set it. The repositories set it from the scope rather than
  from the caller's arguments, which removes the interesting half of that risk.

The guard costs a comparison per row. We measured it on the 22,000-member report
queries and it did not show up next to the query itself. Do not remove it as an
optimisation.
