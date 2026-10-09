# First-time visitor test plan

## Application Overview

Cold visitor to Beefcake dev site: a browser with no `beefcake_dev_persona` cookie. Scenarios use the `@registration` area tag (signup) and `@happy`/`@edge`/`@error`/`@negative`/`@regression` type tags from `docs/test-tags.md`; none are `@acceptance` (no BCPLA Spec). Every scenario starts in a fresh browser context with no cookies, base URL http://127.0.0.1:3000 (persona cookies are bound to host 127.0.0.1). Tenant: Puls Träning; look up its users via `personaFor(role, 'Puls Träning')` in `tests/e2e/helpers.ts`. The DB is read-only to tests.

Not repeated, already covered: entry page heading, three surface links, seeded DB block and Tenant app link (`tests/e2e/site-smoke/entry-page-links-to-surfaces.spec.ts`); new-member form opening and duplicate email (`tests/e2e/site-smoke/`); no-cookie default landing per surface (`tests/e2e/personas.spec.ts`, second test); front-desk happy-path signup (`tests/e2e/member-signup.spec.ts`).

Observed in the running app (verified): `/` shows links /app, /me, /admin and Local database (Today 2026-08-26, Seed beefcake-2026, Scale small, Tenants 12). With no cookie, /app, /app/members, /app/members/new, /me, /me/card, /admin and /admin/health all return 200 with no redirect, prompt or Set-Cookie; the server silently acts as a default user: /app = Julia Falk (owner) of Aktiv Hälsa, /me = Elin Hallberg (member), /admin = Nour Haddad (beefcake admin). Unknown paths and unknown ids (/nope, /app/members/mem_zzz) return the 404 page with no switcher. The switcher is a combobox labelled "Acting as" in the header on every surface, listing all users (4 beefcake admins, then per tenant roles). There is no public member join flow: signup only exists at /app/members/new for roles with `members.write`. Server-side messages (from `src/app/actions/subscriptions.ts`, not exercised in the browser): 'A name is required.' (name under 2 chars), 'That does not look like an email address.', duplicate email message.

Open questions:
1. No-cookie visitors are not redirected or prompted; they are silently signed in as a default user with full access (an owner at /app, staff at /admin) and no cookie is set. Intended for dev only, or should the entry page tell them? Scenarios 1.1 and 1.2 assert current behaviour.
2. The default tenant at /app is Aktiv Hälsa (first owner alphabetically), not Puls Träning, so any cold /app test needs the switcher or a signIn cookie to reach Puls Träning. Intended?
3. There is no public "join" flow; the only signup is front-desk at /app/members/new. Is a self-service member signup planned? None is tested.
4. The /me switcher list has an extra member (Karl Nyström) and the /app list differs from /me in members shown (not verified in depth); confirm which members each surface should offer.
5. Native HTML validation (required, type=email, birth year min/max) blocks submit before the server messages can show; server-only messages 'A name is required.' and the email-format message are only reachable by bypassing it, and a one-character name passes `required`. Which layer should the tests assert? Steps below mark browser behaviour (not verified).
6. Selecting a user from the switcher on /app was not completed in the browser by this exploration (calls hung); cookie path scoping per surface is taken from `src/app/actions/session.ts` (not verified live).

## Test Scenarios

### 1. First-time visitor

**Seed:** `tests/e2e/seed.spec.ts`

#### 1.1. Cold visit to each surface lands without a prompt

**File:** `tests/e2e/first-time-visitor/cold-surfaces-open-without-prompt.spec.ts`

**Steps:**
  1. With no cookies, navigate to /app, /me and /admin in turn (tag @regression).
    - expect: Each returns 200 and stays on the same URL (no redirect, login prompt or error).
    - expect: Each header shows an 'Acting as' switcher and a default user name.
    - expect: No beefcake_dev_persona cookie exists afterwards.

#### 1.2. Cold visit to deep links works and unknown paths 404

**File:** `tests/e2e/first-time-visitor/cold-deep-links-and-404.spec.ts`

**Steps:**
  1. With no cookies, open /app/members, /me/card and /admin/health (@edge).
    - expect: Headings Members, Access and Fleet health appear.
  2. Open /nope and /app/members/mem_zzz.
    - expect: The 404 page 'This page could not be found.' shows with status 404.
    - expect: No switcher is shown.

#### 1.3. Visitor picks Puls Träning front desk with the switcher

**File:** `tests/e2e/first-time-visitor/switcher-picks-puls-front-desk.spec.ts`

**Steps:**
  1. Open /app with no cookies. Read the front desk user's name via personaFor('front_desk','Puls Träning') and choose '<name> (front desk)' in 'Acting as' (@happy).
    - expect: Header shows '<name> · Front desk' and the page heading is Puls Träning.
    - expect: Navigation no longer shows Payments, Reports or Settings (front desk) (not verified).
  2. Reload /app.
    - expect: The choice persists.

#### 1.4. Switcher choice stays on its own surface

**File:** `tests/e2e/first-time-visitor/switcher-choice-is-per-surface.spec.ts`

**Steps:**
  1. Cold open /app, choose the Puls Träning front desk, then open /admin and /me (@negative).
    - expect: /admin still shows Beefcake staff default and /me still shows the default member, not the front desk user (not verified; per cookie path in src/app/actions/session.ts).

#### 1.5. Switcher lists the personas and options on every surface

**File:** `tests/e2e/first-time-visitor/switcher-lists-personas.spec.ts`

**Steps:**
  1. Cold open /app, /me and /admin (@regression).
    - expect: The 'Acting as' combobox exists on each and lists the 4 beefcake admins and the Puls Träning owner, site manager, front desk and a member.

#### 1.6. Cold visitor as a member sees a not-allowed screen on signup

**File:** `tests/e2e/first-time-visitor/member-persona-cannot-sign-up.spec.ts`

**Steps:**
  1. Cold open /app, choose the Puls Träning member in the switcher, then go to /app/members/new (@negative).
    - expect: A not-allowed message for 'New member' (NotAllowed) shows instead of the form (not verified).

#### 1.7. Cold visitor as default owner can open the signup form

**File:** `tests/e2e/first-time-visitor/cold-owner-opens-signup-form.spec.ts`

**Steps:**
  1. With no cookies, open /app/members/new (@happy, @registration).
    - expect: Heading 'New member' and Name, Email, Phone, Birth year, Home gym, Plan and 'Issue an access card now' (checked) show.
    - expect: Subtitle reads 'Joining Aktiv Hälsa today, 2026-08-26' (default tenant, see open question 2).

#### 1.8. Signup form blocks empty and malformed input

**File:** `tests/e2e/first-time-visitor/signup-form-validation.spec.ts`

**Steps:**
  1. As Puls Träning front desk after the switcher, open /app/members/new and click Sign up with all fields empty (@error, @registration).
    - expect: Browser validation blocks submit; URL unchanged; no member created (not verified).
  2. Enter Name 'Testperson', Email 'not-an-email', click Sign up.
    - expect: Submit blocked by email validation (not verified).
  3. Enter a valid email, set Birth year to a value above current year minus 14 (2020) and click Sign up.
    - expect: Browser blocks submit with a range message (not verified).

#### 1.9. Signup rejects an existing Puls Träning email

**File:** `tests/e2e/first-time-visitor/signup-rejects-duplicate-via-switcher.spec.ts`

**Steps:**
  1. Cold open /app, pick Puls Träning front desk via the switcher, read an active member email via withDb, fill the form with it and submit (@error, @registration; variant of the site-smoke duplicate case reached via the switcher).
    - expect: Message 'Somebody at this gym already uses that email address.' shows and the form stays.

#### 1.10. Visitor signs up a new member after choosing a persona

**File:** `tests/e2e/first-time-visitor/signup-after-switcher.spec.ts`

**Steps:**
  1. Cold open /app, choose the Puls Träning front desk, create a member with a unique email and valid Name, Phone, defaults (@happy, @registration).
    - expect: Redirects to the new member's profile showing name and email.
    - expect: A member row with joined_on equal to the seeded today exists (read-only check via withDb).
