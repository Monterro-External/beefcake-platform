# Test tags

One list, so the same thing never gets two names (`@smoke`, `@sanity`, `@quick`).
Tags go on Gherkin scenarios and, with the same spelling, on Playwright tests:
`test('…', { tag: ['@happy', '@BCPLA-142'] }, …)` or on a `test.describe`.

| Tag | Kind | Meaning |
|---|---|---|
| `@BCPLA-<n>` | Spec | The BCPLA Spec issue that holds the scenario's Gherkin. Find every test for one change. |
| `@registration`, `@booking`, `@membership`, `@payments`, `@access` | Area | One feature, named from `docs/domain-glossary.md`. Add a new area here first. |
| `@happy` | Type | The behaviour works as intended. |
| `@edge` | Type | A limit, an empty value, a duplicate, a date or time-zone boundary. |
| `@error` | Type | What the user sees when it goes wrong. |
| `@negative` | Type | What must not change or must not be possible. |
| `@regression` | Type | Nearby behaviour the change could break. |
| `@acceptance` | Run | An acceptance scenario from a Spec, recorded with video and trace. |
| `@smoke` | Run | Two or three journeys that must never break; run on every change. |
| `@wip` | Run | Written but not built yet; never run in CI. |

Every scenario has exactly one type tag. Every Spec has at least one `@happy`,
one `@error` and one `@regression` scenario. On a read-only view such as a report,
`@error` is what the reader sees when the data is missing: no rows, or a figure
that cannot be computed.

```bash
npx playwright test --grep @smoke                           # quick check
npx playwright test --grep @booking                         # one feature
npx playwright test --grep "(?=.*@booking)(?=.*@edge)"      # booking AND edge cases
npx playwright test --grep @BCPLA-142                       # one Spec
npx playwright test --grep-invert @wip                      # everything except unfinished work
```
