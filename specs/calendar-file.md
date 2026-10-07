# Calendar file of a member's booked classes

**Spec:** [BCPLA-10](https://linear.app/monterro-demo/issue/BCPLA-10). The Gherkin lives there.
**Seed:** `tests/e2e/seed.spec.ts`

## Change summary

A member downloads a calendar file of their upcoming booked classes from their
schedule (`/me`), with the hint "Changed a booking? Download again to update
your calendar." This plan covers AS-1, AS-3, AS-5 and AS-10 (BCPLA-14) and
the empty state, AS-2 and AS-8 (BCPLA-15): with nothing to send the schedule
shows "You have no upcoming booked classes." instead of the button and hint,
and `/me/calendar` sends the member back to `/me` without a file. Cancelled
entries (AS-4, AS-6, AS-9) come with BCPLA-16. AS-7 and the other date rules are unit tests on
`src/domain/calendar-file.ts`.

Every Then reads the downloaded `.ics` file or the schedule, never a calendar
app. Each test books its own classes through the member schedule and finds
them in the file by class name and start, because seeded members already hold
upcoming bookings and earlier runs leave theirs behind. The empty state needs a
member with nothing to send: the seed keeps one member login per tenant with no
booking from the seeded day on (at Puls Träning, Maria Åkerlund at Solna), found
by query rather than by name, and those tests book nothing as her.

## Test plan

### 1. Calendar file of a member's booked classes

**Seed:** `tests/e2e/seed.spec.ts`

#### 1.1 AS-1 A member's booked classes are in their calendar file

**Steps:**
1. Sign in as Oskar Jernberg (member, Puls Träning) and open `/me`.
2. Choose "Book" on three upcoming classes with room that he does not hold.
3. Choose "Add my booked classes to your calendar" and read the downloaded file.

**Expected:**
- The file is an `.ics` with exactly one event per booked class, and no other events than his booked classes that have not started.
- Each event has the class name, the location "site, address, city", and the class start and end.
- The schedule shows "Changed a booking? Download again to update your calendar."

#### 1.2 AS-3 A waitlisted class stays out of the calendar file, and promotion still releases the fallback booking

**Steps:**
1. Find two member logins at one site, a class there with one place left and nobody waiting, and an overlapping class with room (Puls Träning first; on the small seed its timetables have no such pair where two logins can book, so another tenant is used).
2. As the other member, book the last place. As "Oskar", join the waitlist (position 1) and book the overlapping class.
3. As "Oskar", download the calendar file.
4. As the other member, cancel the booking on the full class; run `waitlist-promote` for the tenant.
5. As "Oskar", reopen `/me`.

**Expected:**
- The file holds the fallback class and not the waitlisted class.
- After promotion "Oskar" is booked on the class he waited for, and his fallback booking is cancelled (the row offers "Book" again).

#### 1.3 AS-5 Class times are absolute, so a calendar in another timezone shows the right time

**Steps:**
1. Sign in as a Kuntoklubi Kallio member and book a class at 18:00 Helsinki time.
2. Download the calendar file.

**Expected:**
- The event's start is a UTC time (`DTSTART:…Z`) that reads 18:00 in Europe/Helsinki and 17:00 in Europe/Stockholm.

#### 1.4 AS-10 A calendar file holds only the member's own bookings and nothing about them

**Steps:**
1. As "Oskar" (Elin Sandberg, Solna, since the seed's Oskar trains at Täby) and Ebba Bergström, book the same Solna class (Yoga Flow where one has room).
2. As Ebba, book a second Solna class (Zumba where one has room).
3. As "Oskar", download the calendar file.

**Expected:**
- The file holds the shared class and not Ebba's other class.
- The file holds neither member's name, email, login email or phone number.

#### 1.5 AS-2 A member with nothing to send is told so and offered no calendar file

**Steps:**
1. Find the Puls Träning member login with no booking on a class that has not started (it plays Ebba).
2. Sign in as her and open `/me`.

**Expected:**
- The schedule shows "You have no upcoming booked classes."
- There is no "Add my booked classes to your calendar" link and no hint "Changed a booking? Download again to update your calendar."

#### 1.6 AS-8 Opening the calendar file address with nothing to send leads back to the schedule

**Steps:**
1. Find the same member login and sign in as her.
2. Open `/me/calendar` directly.

**Expected:**
- No download starts; the browser lands on `/me` with her greeting ("Hej <first name>").
- The schedule shows "You have no upcoming booked classes."
