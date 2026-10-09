# BCPLA-19 brief for the planner

**Spec:** [BCPLA-19](https://linear.app/monterro-demo/issue/BCPLA-19/spec-class-fill-report-by-site-local-day-with-unmarked-bookings) · Spec: Class fill report by site-local day, with unmarked bookings reported on their own · from bug BCPLA-18 (no Product Ticket)
**Seed:** `tests/e2e/seed.spec.ts`
**Published:** the Gherkin below is saved in BCPLA-19 (read back 2026-10-09).
**Readiness:** ready for implementation; not ready for the planner (see 5).

A copy for the planner agent. The Gherkin lives in BCPLA-19 and wins over this
file; CI never reads this file.

## 1. Story

An owner or site manager sees class fill and no-show rate per site by site-local
day, with unmarked bookings reported on their own, so they don't drop a timetable
slot because of rosters nobody took.

## 2. Acceptance criteria

- **AC1** A class counts in the period of its site-local day, using its own site's timezone.
- **AC2** Bookings that hold a place split into upcoming (class not started), unmarked (class started, still `booked`), attended and no-show.
- **AC3** Fill rate = places taken ÷ capacity. Waitlisted and cancelled bookings, and cancelled classes, are excluded.
- **AC4** No-show rate = no-shows ÷ (attended + no-shows). It is empty when nothing is marked.
- **AC5** The class fill tables on the reports page and the classes page show an Unmarked column, and "–" where there is no no-show rate.
- **AC6** The classes-page site tile reads "No attendance marked · N classes" when the site has no no-show rate.
- **AC7** The class fill CSV keeps its existing columns in order, adds `no_show`, `unmarked` and `upcoming` at the end, and leaves an empty cell where there is no no-show rate.
- **AC8** The dashboard class fill tile and tenant health use the same definitions.
- **AC9** A tenant never sees another tenant's classes in its class fill figures.
- **AC10** On a full-scale database, the 30-day class fill report for Nordic Fitness Group returns in under 500 ms. This is checked by hand, not as a CI gate.

Terms (`docs/domain-glossary.md`): Fill rate, No-show rate, Unmarked booking,
upcoming (as in Calendar file). Decisions: area tag `@booking`; `@error` covers
what the reader sees when no roster was taken; the browser scenarios replace the
Spec's earlier "No new Playwright flow".

## 3. Red cards still open

None.

## 4. Scenarios

```gherkin
@BCPLA-19 @booking
Feature: Class fill by site with unmarked bookings reported on their own

  # Covers: AC2, AC3, AC4, AC5
  @happy
  Scenario: AS-1 An owner sees unmarked bookings counted apart from no-shows
    Given Puls Träning has a site Hornstull whose only class in the last 30 days has 10 places
    And that class has 4 attended bookings, 1 no-show and 3 unmarked bookings
    When the owner of Puls Träning opens the class fill report for the last 30 days
    Then Hornstull shows 8 booked, 3 unmarked, 80% fill and 20% no-show

  # Covers: AC4, AC5
  @error
  Scenario: AS-2 A site where no attendance was marked shows no no-show rate
    Given Puls Träning has a site Hornstull whose only class in the last 30 days has 3 unmarked bookings and none marked
    When the owner of Puls Träning opens the class fill report for the last 30 days
    Then Hornstull shows 3 unmarked and "–" as its no-show rate

  # Covers: AC6
  @error
  Scenario: AS-3 The site tile says no attendance was marked
    Given Puls Träning has a site Hornstull whose 2 classes in the last 30 days have only unmarked bookings
    When the site manager of Puls Träning opens the classes page for Hornstull
    Then the site fill tile reads "No attendance marked · 2 classes"

  # Covers: AC1
  @edge
  Scenario: AS-4 A class just after local midnight on the first day of the window counts in the window
    Given Puls Träning has a site Hornstull in Europe/Stockholm
    And Hornstull has a class at 00:30 local time on the first day of the last 30 days
    And Hornstull has a class at 23:30 local time on the day before
    When the owner of Puls Träning opens the class fill report for the last 30 days
    Then Hornstull shows 1 class

  # Covers: AC7
  @regression
  Scenario: AS-5 The class fill export keeps its columns and adds the new counts at the end
    Given Puls Träning has a site Hornstull whose only class in the last 30 days has 3 unmarked bookings and none marked
    When the owner of Puls Träning exports the class fill report for the last 30 days
    Then the file's columns are site_id, site_name, classes, capacity, booked, attended, waitlisted, fill_rate, no_show_rate, no_show, unmarked, upcoming
    And Hornstull's no_show_rate cell is empty and its unmarked cell is 3

  # Covers: AC8
  @regression
  Scenario: AS-6 The dashboard class fill tile agrees with the class fill report
    Given Puls Träning has a site Hornstull whose only class in the last 30 days has 10 places and 3 unmarked bookings
    When the owner of Puls Träning opens the dashboard
    Then the 30-day class fill tile shows the same fill as the class fill report's total
```

## 5. Coverage, obligations and environment

| Criterion | Browser | Unit level (class fill report on a migrated db) |
|---|---|---|
| AC1 | AS-4 | Stockholm and Helsinki month ends, 29 February, 00:30 on the 1st |
| AC2 | AS-1 | upcoming vs. unmarked against `now` (depends on time of day, so unit only) |
| AC3 | AS-1 | waitlisted and cancelled bookings, cancelled class |
| AC4 | AS-1, AS-2 | `null` rate when nothing marked |
| AC5 | AS-1, AS-2 | |
| AC6 | AS-3 | |
| AC7 | AS-5 | CSV header contract in `tests/unit/export.test.ts` |
| AC8 | AS-6 | tenant health |
| AC9 | | two tenants |
| AC10 | | timing on a full-scale db, by hand |

Implementation tickets: none yet. Mapping happens in `/to-tickets BCPLA-19`.

Environment, checked 2026-10-09:

- **App:** verified. `npm run test:e2e` starts its own server on `:3100` against `data/beefcake.db` (`playwright.config.ts`). The screens exist (`/app`, `/app/classes`, `/app/reports`, `/app/reports/export/classes`), but the Unmarked column, "–" and the tile text aren't built yet. **Blocker for the planner.**
- **Accounts:** verified for Puls Träning: owner Erik Nyström, site manager Albin Bergström, front desk Axel Lindqvist. Sign in with `personaFor(role, 'Puls Träning')` and `signIn()` from `tests/e2e/helpers.ts`. `reports.read` and `reports.export` are for owner and site manager only.
- **Data:** missing. The seed marks every past booking, and Puls Träning's sites are Solna, Sundbyberg, Kista and Täby. Each scenario needs a fixture that adds the site Hornstull (Europe/Stockholm) with only its own classes and bookings through `withDb`, relative to `seededToday()`, and removes it afterwards. **This is an implementation task.** The seeded today is 2026-08-26; tests run serially (`workers: 1`) on one shared database.
- **Outside services:** none involved.
- **Seed test:** `tests/e2e/seed.spec.ts`. It signs in as Puls Träning's front desk and opens `/app`. These scenarios sign in as owner or site manager themselves.

## 6. CI evidence contract

- `.github/scripts/bdd-pr-comment.cjs` (`parseGherkin`, `resolveSpecs`) reads this Gherkin from BCPLA-19. It requires unique `AS-n` names, one type tag each, at least `@happy`, `@error` and `@regression`, and Given/When/Then.
- A test matches a scenario when it is tagged `@BCPLA-19` and its title equals the full scenario name, ID included. Only Chromium runs count.
- Each file starts with `// spec: specs/<feature>.md`. Its describe is tagged `@acceptance @booking`, and each test carries its type tag and `@BCPLA-19`. It calls `test.use(recordEvidence)` from `tests/e2e/evidence.ts` (video and trace on every run), and each Gherkin line is a named `test.step`. Use one page per scenario.
- Files go in `tests/e2e/<feature>/as-<n>-<scenario-slug>.spec.ts`.
- Implementation tickets name the scenarios they make pass on a `Covers:` line.

## 7. Request for the planner (for later: blocked until the screens and the Hornstull fixture exist)

```text
Create a test plan for BCPLA-19 from specs/BCPLA-19-brief.md, using tests/e2e/seed.spec.ts.
Recheck the Spec on https://linear.app/monterro-demo/issue/BCPLA-19 and refresh the brief if its
scenarios changed. Other source tickets are supporting context.
Plan one test per approved browser scenario. Its title must equal the full
scenario name, including the ID. Preserve its tags.
Copy each Given/When/Then/And/But line word for word as a named test step;
describe executable UI actions underneath it without changing the expectation.
Use user-facing locators and web-first assertions. Follow the environment and
CI evidence contract in the brief, including recording and runner requirements.
Keep tests independent and use the project's fakes or mocks.
List newly discovered requirement gaps separately for a product decision.
```
