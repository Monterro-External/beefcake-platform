# Coding standards

How code is written here, by area. Read the file for the area you are about to
change; each rule names an example to copy. Code review checks changes against
these files.

These sit beside, not above, the documents that already decide things:
`docs/agents/rules.md` (rules that have caused incidents), `docs/adr/` and
`docs/domain-glossary.md`. Tooling enforces what it can: `eslint.config.mjs`.

| Area | Scope | File |
|---|---|---|
| Server actions | `src/app/actions/` | [server-actions.md](server-actions.md) |
| Pages and route handlers | `src/app/` | [pages.md](pages.md) |
| Data access and reports | `src/db/repositories/`, `src/export/` | [data-access.md](data-access.md) |
| Domain | `src/domain/` | [domain.md](domain.md) |
| Time, ids and data | all of `src/` | [time-and-data.md](time-and-data.md) |
| Unit tests | `tests/unit/` | [unit-tests.md](unit-tests.md) |
| E2E tests | `tests/e2e/` | [e2e-tests.md](e2e-tests.md) |

[decisions.md](decisions.md) records why each rule exists and what was
rejected. [open-questions.md](open-questions.md) holds what is not decided.
`sessions/` holds the evidence from each convention scan.
