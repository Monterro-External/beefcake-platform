# E2E tests

Scope: `tests/e2e/`. Spec headers, tags and recorded evidence are in
`docs/testing/pr-evidence.md` and `docs/test-tags.md`.

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
