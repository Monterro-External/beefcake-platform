# Site Smoke Test Plan

## Application Overview

A small smoke plan for Beefcake's development entry page and tenant member-management flow. The repository's seed test starts with a fresh seeded database and a front-desk persona at Puls Träning. Browser inspection was blocked because the configured development server exited during planner setup, so scenarios are grounded in the existing routes and end-to-end tests.

## Test Scenarios

### 1. Development entry and tenant member workflow

**Seed:** `tests/e2e/seed.spec.ts`

#### 1.1. Entry page links to each application surface

**File:** `tests/e2e/site-smoke/entry-page-links-to-surfaces.spec.ts`

**Steps:**
  1. Navigate to `/`.
    - expect: The page shows the Beefcake heading.
    - expect: Links for Tenant app, Member app, and Beefcake admin are visible.
  2. Inspect the Local database section.
    - expect: The seeded database state is shown, including the tenant count.
    - expect: The page does not show the No seeded database found message.
  3. Open the Tenant app link.
    - expect: The tenant application opens successfully.

#### 1.2. Front desk opens the new-member form

**File:** `tests/e2e/site-smoke/front-desk-opens-member-form.spec.ts`

**Steps:**
  1. Navigate to `/app/members`.
    - expect: The member-management page loads for the seeded tenant.
  2. Choose the New member action.
    - expect: The New member form is displayed with Name, Email, and Phone fields and a Sign up button.

#### 1.3. Duplicate member email is rejected without creating a record

**File:** `tests/e2e/site-smoke/duplicate-member-email-is-rejected.spec.ts`

**Steps:**
  1. From the seeded front-desk session, open `/app/members/new`.
    - expect: The New member form is displayed.
  2. Enter a new name and the email address of an existing active member at Puls Träning, then submit Sign up.
    - expect: An error explains that the gym already uses that email.
    - expect: The form remains visible and the existing member's records are unchanged.
