# Waitlist promotion

**Spec:** none yet. The Acceptance block below moves to a BCPLA Spec issue once Linear is connected.
**Seed:** `tests/e2e/seed.spec.ts`

## Change summary

Planned browser coverage for waitlist promotion in the member app: a promoted
member's overlapping fallback booking is released, and unrelated bookings are
kept. Not automated yet; the scenarios are tagged `@wip`.

Domain rules such as closing up waitlist positions belong in unit tests
(`renumberWaitlist` in `src/domain/waitlist.ts`), not in this spec.

## Acceptance

```gherkin
@wip @booking
Feature: Waitlist promotion releases the fallback booking
  A member waiting for a full class often books an overlapping class as a
  fallback. Promotion must release that fallback, otherwise the site manager
  sees a class that looks full while half the room does not turn up.

  Background:
    Given tenant "Träningsverket Lund" has a site with the classes:
      | class   | starts | ends  | capacity |
      | Spin    | 18:00  | 18:45 | 1        |
      | Circuit | 18:15  | 19:00 | 10       |
    And member "Anna" is booked on "Spin"

  @happy
  Scenario: AS-1 Promotion releases the overlapping fallback
    Given member "Erik" is waitlisted at position 1 on "Spin"
    And member "Erik" is booked on "Circuit"
    When member "Anna" cancels the booking on "Spin"
    And the waitlist promotion job runs
    Then "Erik" is booked on "Spin"
    And the booking of "Erik" on "Circuit" is cancelled
    And the outbox holds a promotion message for "Erik"

  @error
  Scenario: AS-2 A class that has already started cannot be joined
    Given "Spin" started five minutes ago
    When member "Erik" tries to join the waitlist for "Spin"
    Then the booking is refused with "That class has already started."
    And "Erik" has no booking on "Spin"

  @regression
  Scenario: AS-3 A non-overlapping booking is kept
    Given member "Erik" is waitlisted at position 1 on "Spin"
    And member "Erik" is booked on "Yoga" at 20:00
    When a spot on "Spin" frees up and the waitlist promotion job runs
    Then "Erik" is booked on "Spin"
    And "Erik" is still booked on "Yoga"
```
