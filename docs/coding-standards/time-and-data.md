# Time, ids and data

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
