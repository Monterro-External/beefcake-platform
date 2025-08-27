# 7. SQLite, for now

- Status: accepted
- Date: 2025-08-27
- Deciders: Sara Lindqvist, Elin Sandberg

## Context

We need a database for a product with roughly 45,000 member records, a million
charges of history and reporting queries over both. The team is five engineers.
Postgres is the default answer and the one we will eventually need.

Against it, right now: a developer joining the team should be able to clone the
repo and see the product working in two minutes, and every engineer should be
able to rebuild a full, realistic dataset from scratch without thinking about it.
That argues for a database that is a file.

## Decision

SQLite, accessed through Drizzle, one file at `data/beefcake.db`, with WAL
enabled and foreign keys on. Migrations are generated SQL under
`src/db/migrations/` and applied in order.

The schema is written so that the move to Postgres is mechanical: no SQLite-only
types, integer minor units rather than a money type, ISO strings rather than
native dates, and no reliance on dynamic typing. Reporting queries live in
repositories rather than being spread through the UI, so they are the only thing
that would need retuning.

## Consequences

Good:

- `npm install && npm run db:reset && npm run dev` and you have the product, with
  1.8 million rows of believable history, in well under a minute.
- No container, no connection string, no local service to forget to start.
- The whole dataset is one file, so "send me the state you are seeing" is a copy.

Bad:

- One writer at a time. Fine for a single process; it is the first thing that
  breaks when we run more than one.
- No concurrent index builds, no partial indexes we would want for the reports,
  weaker query planner on the wider joins.
- The full-scale seed is a 470 MB file. It is not committed, but it is on
  everyone's disk.

Revisit when either of these is true: we run more than one application process,
or a report screen at key-account volume cannot be made fast enough in dev mode.
