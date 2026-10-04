# Member registration

**Spec:** [BCPLA-17](https://linear.app/monterro-demo/issue/BCPLA-17/spec-member-registration). The Gherkin lives there.
**Seed:** `tests/e2e/seed.spec.ts`

## Change summary

Adds BDD-based browser verification for member registration, duplicate rejection
and tenant isolation. Pull requests run the scenarios automatically and receive
a BDD-based description with test results, timestamps and links to recorded
clicks, traces and the HTML report. Registration behaviour in the application
is unchanged.

## Test plan

### 1. Member registration

**Seed:** `tests/e2e/seed.spec.ts`

#### 1.1 AS-1 A new member remains searchable with their subscription and access card

**Steps:**
1. Sign in as the front desk user at Puls Träning.
2. Open Members and choose "New member".
3. Fill in name, a unique email, phone `+46701234567`, birth year, home gym and plan; tick "Issue an access card now".
4. Choose "Sign up".
5. Open Members, search for the email and open the member; reload the page.

**Expected:**
- The profile shows the member as Active with the chosen plan, home gym and card number.
- The search returns exactly one row for the email, and the details survive a reload.
- Exactly one welcome message for the email is queued in the outbox.

#### 1.2 AS-2 A duplicate email is rejected without changing existing records

**Steps:**
1. Sign in as the front desk user at Puls Träning.
2. Open "New member" and fill in the form with the email of an existing member.
3. Choose "Sign up".

**Expected:**
- The form stays open with "Somebody at this gym already uses that email address."
- Member, subscription, access card and welcome-message counts for the tenant are unchanged.

#### 1.3 AS-3 Registrations using the same email remain isolated between tenants

**Steps:**
1. Sign in as the front desk user at Nordic Fitness Group and register a member with a unique email.
2. Sign in as the front desk user at Puls Träning and register a member with the same email.
3. As each tenant, search for the email and open the member.
4. As each tenant, open the other tenant's member URL directly.

**Expected:**
- The two members, subscriptions and access cards are different.
- Nordic Fitness Group's records are unchanged by the second registration.
- Each tenant finds only its own member; the other tenant's member URL shows 404.
