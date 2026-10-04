# Member registration

**Spec:** none yet. Written before specs carried Gherkin; the Acceptance block below moves to a BCPLA Spec issue once Linear is connected.
**Seed:** `tests/e2e/seed.spec.ts`

## Change summary

Adds BDD-based browser verification for member registration, duplicate rejection
and tenant isolation. Pull requests run the scenarios automatically and receive
a BDD-based description with test results, timestamps and links to recorded
clicks, traces and the HTML report. Registration behaviour in the application
is unchanged.

## Acceptance

```gherkin
@registration
Feature: Member registration

  @happy
  Scenario: AS-1 A new member remains searchable with their subscription and access card
    Given a front desk user at Puls Träning
    And a person with valid contact details whose email is not registered with that tenant
    When the person is registered with a plan, home site and access card
    Then the member has an active subscription for the selected plan and home site
    And the member has an access card
    And the member can be found again with the saved details on later visits
    And exactly one welcome message is queued

  @error
  Scenario: AS-2 A duplicate email is rejected without changing existing records
    Given an email address already belongs to a member at Puls Träning
    When another registration uses that email address at the same tenant
    Then the registration is rejected with an explanation
    And the existing member is unchanged
    And no member, subscription, access card or welcome message is created

  @regression
  Scenario: AS-3 Registrations using the same email remain isolated between tenants
    Given a member registered with Nordic Fitness Group
    When Puls Träning registers a member with the same email address
    Then each tenant has its own member, subscription and access card
    And the first tenant's records are unchanged
    And each tenant can find and open only its own member
```

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
