# Unit tests

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
