# Class fill by site, with unmarked bookings reported on their own

**Spec:** [BCPLA-19](https://linear.app/monterro-demo/issue/BCPLA-19). The Gherkin lives there.
**Seed:** `tests/e2e/seed.spec.ts`

## Change summary

The class fill report splits the bookings that hold a place into upcoming,
unmarked, attended and no-show. Fill rate is places taken ÷ capacity; no-show
rate is no-shows ÷ (attended + no-shows), and a site that marked nothing has no
no-show rate, shown as "–". The reports page (`/app/reports`) class fill table
reads Site, Classes, Booked, Fill, Unmarked, No-show, Waitlisted. A class
counts in the period of its site-local day, in its own site's timezone. This
plan covers AS-1 and AS-2 (BCPLA-21) and AS-4 (BCPLA-22). Upcoming against
unmarked, waitlisted and cancelled bookings, cancelled classes, tenant
isolation, and the Stockholm, Helsinki and leap-year month ends are unit tests
on the report (`tests/unit/class-fill.test.ts`).

The seed marks every past booking, so it never produces an unmarked roster.
Each test adds its own site, Hornstull (Europe/Stockholm), to Puls Träning
with only the classes and bookings its scenario describes, by default three
days before the seeded today at 18:00 local, and removes the site, its classes, bookings
and members when the test ends. The fixture is `hornstull` in
`tests/e2e/class-fill/hornstull.ts`. Every Then reads the Hornstull row of the
"Class fill by site" table for the last 30 days, by column header.

## Test plan

### 1. Class fill by site with unmarked bookings reported on their own

**Seed:** `tests/e2e/seed.spec.ts`

#### 1.1 AS-1 An owner sees unmarked bookings counted apart from no-shows

**Steps:**
1. Add Hornstull to Puls Träning with one class of 10 places: 4 attended bookings, 1 no-show and 3 bookings still `booked`.
2. Sign in as the owner of Puls Träning and open `/app/reports?days=30`.
3. Read the Hornstull row of "Class fill by site".

**Expected:**
- Classes 1, Booked 8, Unmarked 3, Fill 80 %, No-show 20 %.

#### 1.2 AS-2 A site where no attendance was marked shows no no-show rate

**Steps:**
1. Add Hornstull to Puls Träning with one class of 10 places and 3 bookings still `booked`, none marked.
2. Sign in as the owner of Puls Träning and open `/app/reports?days=30`.
3. Read the Hornstull row of "Class fill by site".

**Expected:**
- Unmarked 3, and No-show reads "–", not 0 %.

#### 1.3 AS-4 A class just after local midnight on the first day of the window counts in the window

The last 30 days run from 30 days before the seeded today to today, as local
days at Hornstull.

**Steps:**
1. Add Hornstull to Puls Träning with a class of 10 places at 00:30 local time 30 days before the seeded today (22:30 UTC the day before), with 2 attended bookings.
2. Add a class of 20 places at 23:30 local time 31 days before the seeded today, with 5 attended bookings.
3. Sign in as the owner of Puls Träning and open `/app/reports?days=30`.
4. Read the Hornstull row of "Class fill by site".

**Expected:**
- Classes 1, Booked 2: the 00:30 class counts, the 23:30 class the night before does not.
