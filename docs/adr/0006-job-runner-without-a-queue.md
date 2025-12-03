# 6. A job runner without a queue

- Status: accepted
- Date: 2025-12-03
- Deciders: Sara Lindqvist, Tobias Ek

## Context

Three things run on a schedule: the monthly payment run, the nightly access sync
per site, and waitlist promotion. The payment run is the heavy one, about 45,000
charges across the fleet, and it runs once a month per tenant.

The obvious infrastructure answer is a queue with workers, retries and a
dashboard. That is a service to operate, a broker to keep up, and a second place
where state lives.

## Decision

Jobs are plain scripts under `src/jobs/`, invoked by name:

```
npm run jobs:payment-run
npm run jobs:access-sync
npm run jobs:waitlist-promote
```

In production the scheduler runs the same scripts. Each run writes a row to
`job_runs` with its outcome, and each job is idempotent per tenant and period:
running the payment run twice for `2026-08` does not charge anyone twice, because
`payment_runs` has a unique key on `(tenant_id, period)`.

Retries are a domain concept, not an infrastructure one. A failed charge is
retried on a schedule the tenant configures, tracked as rows in `charges` with an
`attempt` and a `next_attempt_at`. A crashed job is re-run, and it picks up where
it left off because the work to do is derived from the data rather than from a
queue.

## Consequences

Good:

- Nothing to operate. A developer runs the same command the scheduler does, and
  gets the same result against a seeded database.
- Retry state is in the domain tables, where support can read it and where the
  reports already look.
- A job is debuggable with a breakpoint.

Bad:

- No parallelism inside a job. The payment run is sequential per tenant. At
  current volume it finishes in seconds; the design point where this stops being
  true is around a hundred key accounts.
- No automatic retry of the job itself. A failed run needs a human or the
  scheduler's next tick, which is what the runbook in
  `docs/runbooks/payment-run-failed.md` is for.
