# Class fill by site, with unmarked bookings reported on their own

**Spec:** [BCPLA-19](https://linear.app/monterro-demo/issue/BCPLA-19). The Gherkin lives there.
**Seed:** `tests/e2e/seed.spec.ts`

## Change summary

The class fill report splits the bookings that hold a place into upcoming,
unmarked, attended and no-show. Fill rate is places taken ÷ capacity; no-show
rate is no-shows ÷ (attended + no-shows), and a site that marked nothing has no
no-show rate, shown as "–". The reports page (`/app/reports`) class fill table
reads Site, Classes, Booked, Fill, Unmarked, No-show, Waitlisted. The class fill
CSV export keeps its columns in order and adds `no_show`, `unmarked` and
`upcoming` at the end. This plan covers AS-1 and AS-2 (BCPLA-21), AS-3
(BCPLA-23): the classes page (`/app/classes`) site fill tile reads "No
attendance marked · N classes" when the site has no no-show rate, and AS-5
(BCPLA-24). Upcoming against unmarked, waitlisted and
cancelled bookings, cancelled classes and tenant isolation are unit tests on
the report (`tests/unit/class-fill.test.ts`).

The seed marks every past booking, so it never produces an unmarked roster.
Each test adds its own site, Hornstull (Europe/Stockholm), to Puls Träning
with only the classes and bookings its scenario describes, three days before
the seeded today at 18:00 local, and removes the site, its classes, bookings
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

#### 1.3 AS-3 The site tile says no attendance was marked

**Steps:**
1. Add Hornstull to Puls Träning with two classes of 10 places, 3 and 10 days before the seeded today, with 3 and 5 bookings still `booked`, none marked.
2. Sign in as the site manager of Puls Träning and open `/app/classes?site=sit_e2ehornstull`.
3. Read the "Site fill, 30 days" tile.

**Expected:**
- The tile reads "No attendance marked · 2 classes", not a no-show percentage.

#### 1.4 AS-5 The class fill export keeps its columns and adds the new counts at the end

**Steps:**
1. Add Hornstull to Puls Träning with one class of 10 places and 3 bookings still `booked`, none marked.
2. Sign in as the owner of Puls Träning and open `/app/reports?days=30`.
3. Press "CSV" on "Class fill by site" and read the downloaded file.

**Expected:**
- The header is `site_id, site_name, classes, capacity, booked, attended, waitlisted, fill_rate, no_show_rate, no_show, unmarked, upcoming`, in that order.
- Hornstull's row has an empty `no_show_rate` cell and `unmarked` 3.
