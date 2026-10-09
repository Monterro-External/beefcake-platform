# Class fill by site with unmarked bookings reported on their own

**Spec:** [BCPLA-19](https://linear.app/monterro-demo/issue/BCPLA-19). The Gherkin lives there.
**Seed:** `tests/e2e/seed.spec.ts`

## Change summary

The class fill report counts each site's places taken as upcoming, unmarked,
attended and no-show bookings. The no-show rate is no-shows over attended plus
no-shows, and a site that marked nothing shows "–". The reports page
(`/app/reports?days=30`) gains Booked and Unmarked columns. This plan covers AS-1
and AS-2 (BCPLA-21). The other scenarios join it with their tickets.

The seed marks every past booking, so each test adds its own site, Hornstull, to
Puls Träning with only its own classes and bookings, through `addHornstull()` in
`tests/e2e/class-fill/class-fill.ts`. The class is three days before the seeded
today, so it has started. Each test removes the site afterwards, and a Hornstull
left behind by an interrupted run is removed before a new one is added. Each Then
reads the Hornstull row of the "Class fill by site" table, cell by column header.

## Test plan

### 1. Class fill by site

**Seed:** `tests/e2e/seed.spec.ts`

#### 1.1 AS-1 An owner sees unmarked bookings counted apart from no-shows

**File:** `tests/e2e/class-fill/as-1-an-owner-sees-unmarked-bookings-counted-apart-from-no-shows.spec.ts`

1. Add Hornstull with one class of 10 places: 4 attended, 1 no-show, 3 booked.
2. Sign in as the Puls Träning owner and open `/app/reports?days=30`.
3. Expect Booked `8`, Unmarked `3`, Fill `80 %` and No-show `20 %` in the Hornstull row.

#### 1.2 AS-2 A site where no attendance was marked shows no no-show rate

**File:** `tests/e2e/class-fill/as-2-a-site-where-no-attendance-was-marked-shows-no-no-show-rate.spec.ts`

1. Add Hornstull with one class of 10 places and 3 booked bookings.
2. Sign in as the Puls Träning owner and open `/app/reports?days=30`.
3. Expect Unmarked `3` and No-show `–` in the Hornstull row.
