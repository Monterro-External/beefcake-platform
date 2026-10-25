# Coding standards

Read during review. Each rule is a judgement call that no lint rule covers yet,
learned from a review finding. The hard rules (tenant isolation, money, dates,
seed) are in `docs/agents/rules.md` and are not repeated here.

## Queries

- **Escape user text in `LIKE`.** A search term from the address or a form is
  escaped for `\`, `%` and `_`, and the comparison says `escape '\'`. Otherwise
  `?q=_` matches every row. Reuse `memberSearchCondition()` in
  `src/db/repositories/members.ts` for member searches.
- **Rows and counts share one set of conditions.** When a screen shows a list
  and a count of it ("12 matching charges"), build both from the same
  conditions or subquery, so they can never disagree.
- **A paged or capped order is total.** Add a unique tiebreaker (the row id)
  after the sort column. Without it, rows with equal timestamps swap between
  pages and between reloads.

## Screens

- **A filter narrows the list, not the summary.** When a list gains search or
  filters, check every figure on the page that read the same rows (tiles,
  callouts, "In dunning" totals). They keep their unfiltered meaning unless the
  Spec says otherwise.
- **React keys are the row's own id.** Never a key built from display fields
  such as member and timestamp, which can repeat.

## Playwright tests

- **Link and button lookups that can be substrings use `exact: true`.**
  `getByRole('link', { name: 'Payments' })` also matches "See all on Payments"
  and "All payments".
