# 5. Plain dates for calendar logic, instants for events

- Status: accepted
- Date: 2025-11-11
- Deciders: Elin Sandberg, Petter Lund

## Context

We operate in four timezones, two of which differ from each other for part of
the year, and our door hardware reports check-ins in two different formats, one
of which has no timezone information at all.

Almost every date bug we have had came from treating two different things as the
same type:

- "The freeze ends on 28 February." A calendar fact. It is the 28th in Oslo and
  the 28th in Helsinki.
- "The card was swiped at 23:14:07." A point in time. Which calendar day it
  belongs to depends on where the door is.

Using `Date` for both means the freeze end date silently acquires a time and a
timezone, and then a member in Helsinki resumes a day early.

## Decision

Two types, and they do not mix.

- **Instant.** A `Date`, persisted as ISO-8601 with an explicit `Z`. Column names
  end `_at`. Used for anything that happened.
- **Plain date.** `PlainDate`, a `'YYYY-MM-DD'` string, with arithmetic in
  `src/domain/dates.ts`. Column names end `_on`. Used for anything on a calendar.

Converting between them always names a timezone: `localDay(at, timezone)` and
`startOfDay(day, timezone)`, where the timezone comes from the **site**, never
from the host. CI runs in UTC and developers run in Stockholm, and both have to
produce the same answer as a door in Tampere.

`addMonths` clamps rather than overflowing: 31 January plus one month is 28
February, never 3 March.

## Consequences

Good:

- The type tells you which kind of time you are holding, so mixing them is a
  compile error rather than an off-by-one-day report.
- Plain-date arithmetic has no DST edge cases at all, because it has no time.
- The two hardware adapters have one obvious job: turn a vendor timestamp into an
  instant plus a site-local day.

Bad:

- A string-based date type is not enforced at the database level. `isPlainDate`
  and `assertPlainDate` exist for boundaries where data arrives from outside.
- Two conversion helpers to remember instead of one `Date` everywhere. The
  alternative is the class of bug that generates forty support tickets in a week.
