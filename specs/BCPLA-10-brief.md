# BCPLA-10 brief for the planner

**Spec:** [BCPLA-10](https://linear.app/monterro-demo/issue/BCPLA-10) · Product Ticket BCPRO-114
**Seed:** `tests/e2e/seed.spec.ts`

A copy for the planner agent. The Gherkin lives in BCPLA-10 and wins over this
file; CI never reads this file.

## 1. Story

A member downloads a calendar file of their upcoming booked classes, so they no
longer add each class to their calendar by hand.

## 2. Acceptance criteria

- **AC1** Every `booked` booking whose class has not started is in the file, with class name, site with address, start, end and instructor. A class without an instructor gets an empty description.
- **AC2** Waitlisted classes and classes that have started are left out.
- **AC3** A booking the member cancelled, one promotion released, and one on a cancelled class appear as cancelled, with the same identity in every download.
- **AC4** Times are absolute; a daylight saving changeover keeps the local start time.
- **AC5** A member with nothing to send sees "You have no upcoming booked classes." and no button; opening the download address leads back to the schedule.
- **AC6** The button and the hint "Changed a booking? Download again to update your calendar." show whenever there is at least one entry to send, even if every entry is cancelled.
- **AC7** The file holds only the signed-in member's bookings and no personal data.
- **AC8** Promotion still moves the member in and releases the fallback booking.

## 3. Red cards still open

None.

## 4. Scenarios

```gherkin
@BCPLA-10 @booking
Feature: Calendar file of a member's booked classes

  # Covers: AC1, AC6
  @happy @smoke
  Scenario: AS-1 A member's booked classes are in their calendar file
    Given Oskar, a member at Puls Träning, is booked on three classes that have not started
    When Oskar downloads his calendar file from his schedule
    Then the calendar file holds three events
    And each event shows the class name, the site with its address, the start and the end
    And the schedule shows "Changed a booking? Download again to update your calendar."

  # Covers: AC5
  @error @smoke
  Scenario: AS-2 A member with nothing to send is told so and offered no calendar file
    Given Ebba, a member at Puls Träning, has no bookings on classes that have not started
    When Ebba opens her schedule
    Then she sees "You have no upcoming booked classes."
    And she is offered no calendar file

  # Covers: AC2, AC8
  @regression
  Scenario: AS-3 A waitlisted class stays out of the calendar file, and promotion still releases the fallback booking
    Given Oskar is on the waitlist for Spinning 45 at 18:00 at Solna
    And Oskar is booked on Core at 18:15 at Solna as a fallback
    When Oskar downloads his calendar file
    Then the calendar file holds Core and not Spinning 45
    When a place on Spinning 45 frees up and promotion runs
    Then Oskar is booked on Spinning 45
    And his booking on Core is cancelled

  # Covers: AC3
  @edge
  Scenario: AS-4 A booking the member cancelled is marked cancelled in the next calendar file
    Given Oskar has downloaded his calendar file with his booking on Yoga Flow at Solna
    When Oskar cancels his booking on Yoga Flow
    And Oskar downloads his calendar file again
    Then the calendar file holds Yoga Flow as a cancelled event
    And that event has the same identity as in the first file

  # Covers: AC4
  @edge
  Scenario: AS-5 Class times are absolute, so a calendar in another timezone shows the right time
    Given a member at Kuntoklubi Kallio is booked on a class at 18:00 Helsinki time
    When the member downloads their calendar file
    Then the event starts at 18:00 Helsinki time, which is 17:00 Stockholm time

  # Covers: AC3
  @edge
  Scenario: AS-6 After promotion, the next calendar file holds the promoted class and marks the released fallback booking cancelled
    Given Oskar has downloaded his calendar file with his fallback booking on Core at 18:15 at Solna
    And Oskar is on the waitlist for Spinning 45 at 18:00 at Solna
    When promotion moves Oskar onto Spinning 45
    And Oskar downloads his calendar file again
    Then the calendar file holds Spinning 45
    And it holds Core as a cancelled event

  # Covers: AC5
  @negative
  Scenario: AS-8 Opening the calendar file address with nothing to send leads back to the schedule
    Given Ebba, a member at Puls Träning, has no bookings on classes that have not started
    When Ebba opens the calendar file address directly
    Then she is on her schedule
    And she sees "You have no upcoming booked classes."

  # Covers: AC3, AC6
  @edge
  Scenario: AS-9 A member who cancelled their only booking still gets a calendar file
    Given Ebba has downloaded her calendar file with her only booking, Zumba at Solna
    When Ebba cancels her booking on Zumba
    Then her schedule still offers the calendar file
    And the calendar file holds Zumba as a cancelled event

  # Covers: AC7
  @negative
  Scenario: AS-10 A calendar file holds only the member's own bookings and nothing about them
    Given Oskar and Ebba are both booked on Yoga Flow at Solna
    And Ebba is also booked on Zumba at Solna
    When Oskar downloads his calendar file
    Then it holds Yoga Flow and not Zumba
    And it holds no name, email or phone number of Oskar or Ebba
```

## 5. What the planner must not test

Unit-level rules, covered by the rules module's unit tests: AS-7 (a class on
the daylight saving changeover day), a booking on a cancelled class, a class
without an instructor, a month end, a leap day and a class about to start.
Nothing in a member's own calendar app: every Then reads the downloaded file or
the schedule.

## 6. Environment

- **App:** `playwright.config.ts` starts its own `npm run dev` on `127.0.0.1:3100` (`E2E_PORT` to move it), locally and in CI, never reusing a running server, against a database from `npm run db:reset -- --scale small`.
- **Accounts:** sign in with the persona cookie via `signIn` and `memberLogin(tenantName)` in `tests/e2e/helpers.ts`. The seed has three member logins per tenant, Kuntoklubi Kallio included. The seed test signs in as Puls Träning's front desk; member scenarios sign in themselves.
- **Data:** each test makes its own bookings through the member schedule. Tests share one SQLite file and run serially (`workers: 1`), so no test relies on another's bookings. Promotion runs as in `tests/e2e/booking.spec.ts`; `waitlist_auto_promote` is on by default.
- **Outside services:** none; email and payments are fakes writing to `outbox`.
- **Blockers:** the planner explores the running app, and the calendar file, its button and its hint do not exist yet. Planning starts once implementation ticket (2) has them running locally; the build itself waits for BCPLA-9.
