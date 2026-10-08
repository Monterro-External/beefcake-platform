# Calendar file of a member's booked classes

**Spec:** [BCPLA-10](https://linear.app/monterro-demo/issue/BCPLA-10). The Gherkin lives there.
**Seed:** `tests/e2e/seed.spec.ts`

## Change summary

A member downloads a calendar file of their upcoming booked classes from their
schedule (`/me`), with the hint "Changed a booking? Download again to update
your calendar." This plan covers AS-1, AS-3, AS-5 and AS-10 (BCPLA-14), the
empty state, AS-2 and AS-8 (BCPLA-15): with nothing to send the schedule
shows "You have no upcoming booked classes." instead of the button and hint,
and `/me/calendar` sends the member back to `/me` without a file; and the
cancelled entries, AS-4, AS-6 and AS-9 (BCPLA-16): a booking the member
cancelled, one promotion released, and one on a cancelled class, on a class
that has not started, are written as cancelled events (`STATUS:CANCELLED`)
with the booking's identity (`UID`), so a re-download cancels the event
rather than adding one. A member whose only entries are cancelled still gets
the button, the hint and the file. AS-7, a booking on a cancelled class (the
tenant app cannot cancel a class) and the other date rules are unit tests on
`src/domain/calendar-file.ts`.

Every Then reads the downloaded `.ics` file or the schedule, never a calendar
app. Each test books its own classes through the member schedule and finds
them in the file by class name and start, because seeded members already hold
upcoming bookings and earlier runs leave theirs behind. The empty state needs a
member with nothing to send: the seed keeps one member login per tenant with no
booking from the seeded day on (at Puls Träning, Maria Åkerlund at Solna), found
by query rather than by name, and those tests book nothing as her. AS-9 needs
a member with nothing booked too, and books as them, so it never takes that
login: it takes the first member login outside Puls Träning with no booking
ahead other than cancelled ones, and a class they never booked. Repeated runs
leave that member cancelled bookings, which AS-9 tolerates.

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

#### 1.7 AS-4 A booking the member cancelled is marked cancelled in the next calendar file

**Steps:**
1. Sign in as "Oskar" (Elin Sandberg, Solna) and book a Solna class with room that she does not hold (Yoga Flow where one has room).
2. Download the calendar file.
3. Choose "Cancel" on that class.
4. Download the calendar file again.

**Expected:**
- The first file holds the class as `STATUS:CONFIRMED`.
- The second file holds it once, as `STATUS:CANCELLED`, with the same `UID` as in the first file.

#### 1.8 AS-6 After promotion, the next calendar file holds the promoted class and marks the released fallback booking cancelled

**Steps:**
1. Find the same setup as AS-3: two member logins at one site, a class with one place left and nobody waiting, and an overlapping class with room.
2. As "Oskar", book the overlapping class (the fallback) and download the calendar file.
3. As the other member, book the last place; as "Oskar", join the waitlist (position 1).
4. As the other member, cancel; run `waitlist-promote` for the tenant; as "Oskar", reopen `/me` (the class shows "Booked").
5. Download the calendar file again.

**Expected:**
- The first file holds the fallback as `STATUS:CONFIRMED`.
- The second file holds the promoted class as `STATUS:CONFIRMED` and the fallback as `STATUS:CANCELLED`, with the same `UID` as in the first file.

#### 1.9 AS-9 A member who cancelled their only booking still gets a calendar file

**Steps:**
1. Find a member login outside Puls Träning with no booking ahead other than cancelled ones, and a class with room they never booked (it plays Ebba; Puls Träning's idle login stays untouched for AS-2 and AS-8).
2. Sign in, book that class, download the calendar file.
3. Choose "Cancel" on that class and reload `/me`.
4. Download the calendar file again.

**Expected:**
- The first file holds that class as its only `STATUS:CONFIRMED` event.
- After cancelling, the schedule still shows "Add my booked classes to your calendar" and the hint, and not "You have no upcoming booked classes."
- The second file holds that class as `STATUS:CANCELLED` and no confirmed event.
