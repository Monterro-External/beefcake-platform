# Search and filter in "In dunning now"

**Spec:** [BCPLA-36](https://linear.app/monterro-demo/issue/BCPLA-36). The Gherkin lives there.
**Seed:** `tests/e2e/seed.spec.ts`

## Change summary

Open dunning is every `retrying` and `abandoned` charge of the tenant, newest
attempt first, one row per charge. A new permission, `dunning.read` (owner,
site manager, front desk), shows the overview card "In dunning now";
`payments.read` (owner, site manager) still guards Payments, the card's "All
payments" link and the "Payment run" summary with its "In dunning" figure.
Front desk sees the card tenant-wide with the same columns and no row actions.

A search field ("Name, email, phone or card number"), a Site dropdown ("All
sites") and Status and Reason chips sit above the card and the Payments list
"In dunning (n)". The search and filters live in the address (`q`, `status`,
`reason`, `site`). Unfiltered, both lists are as today: the card shows 8 rows
and "All payments", Payments 100 rows under "In dunning (100)", and neither
shows a count line. Filtered, the card shows up to 50 rows and a count line,
and Payments pages the matches 50 at a time.

Built so far: AS-11 and AS-13 (BCPLA-37); AS-1 to AS-4 (BCPLA-38). The other scenarios are listed as
the plan and are filled in by the tickets that build them. The search rule,
chip counts, distinct member count, unknown values, tenant isolation and the
500 ms limit at full scale are unit tests on the open-dunning report
(`tests/unit/`).

Tests read the expected rows from the seeded database rather than hardcoding
ids. Counts are compared as digits only, since the tenant locale groups
thousands with a space. The table's status badge still says "Given up" for
`abandoned` (BCPRO-112 is out of scope); the chips say "Abandoned".

## Test plan

### 1. Search and filter in "In dunning now"

**Seed:** `tests/e2e/seed.spec.ts`

#### 1.1 AS-1 Front desk finds a member in open dunning by email

**Steps:**
1. Sign in as the front desk at Puls Träning and open `/app`.
2. Look up a Puls Träning member with a charge in open dunning and search the card for their email.

**Expected:**
- Only that member's charges in open dunning are listed.
- The count line names the matching charges and members.

#### 1.2 AS-2 A search finds a member whose charge is older than the rows shown

**Steps:**
1. Sign in as the front desk at Puls Träning and open `/app`.
2. Look up a member with a card number whose abandoned charge is older than the 8 newest in open dunning, and search the card for the card number.

**Expected:**
- That member's abandoned charge is listed.

#### 1.3 AS-3 A search for someone not in open dunning says so without suggesting they have paid

**Steps:**
1. Sign in as the front desk at Puls Träning and open `/app`.
2. Search the card for "zz-not-a-member".

**Expected:**
- The card says "No one matching "zz-not-a-member" is in dunning now." and offers "Clear search and filters".

#### 1.4 AS-4 Clearing the search and filters brings back today's list

**Steps:**
1. Sign in as the front desk at Puls Träning and open `/app?q=zz-not-a-member`.
2. Choose "Clear search and filters".

**Expected:**
- The card shows the 8 newest charges in open dunning and no count line.

#### 1.5 AS-5 Each status and reason chip shows how many charges it would leave

**Steps:**
1. Sign in as the front desk at Nordic Fitness Group and open `/app`.
2. Choose the "Abandoned" chip.

**Expected:**
- Only abandoned charges are listed.
- Each reason chip shows the number of abandoned charges with that reason.

#### 1.6 AS-6 A reason that never occurs with Retrying is greyed out and cannot be chosen

**Steps:**
1. Sign in as the front desk at Nordic Fitness Group and open `/app`.
2. Choose the "Retrying" chip.
3. Try to choose the "Account closed" chip.

**Expected:**
- "Account closed" and "Mandate cancelled" show 0 and are greyed out, not links.
- The address and the list are unchanged after the attempt.

#### 1.7 AS-7 The site filter keeps only members whose home site it is

**Steps:**
1. Sign in as the front desk at Puls Träning and open `/app`.
2. Choose one of Puls Träning's sites in the Site dropdown.

**Expected:**
- Every listed charge belongs to a member whose home site is that site.

#### 1.8 AS-8 A filter with more than 50 matches shows the first 50 and says how many there are

**Steps:**
1. Sign in as the front desk at Nordic Fitness Group and open `/app`.
2. Choose the "Abandoned" chip.

**Expected:**
- 50 charges are listed, newest attempt first.
- The count line reads "Showing 50 of" the number of abandoned charges, then the number of members.

#### 1.9 AS-9 A pasted link shows the same search and filters

**Steps:**
1. Sign in as the front desk at Nordic Fitness Group, choose the "Retrying" chip and search for a retrying member's email.
2. Sign in as another front desk at Nordic Fitness Group and open the same address.

**Expected:**
- The colleague sees the same search, the "Retrying" chip chosen and the same charges.

#### 1.10 AS-10 An owner continues on Payments with the filters kept and pages through the matches

**Steps:**
1. Sign in as the owner of Nordic Fitness Group, open `/app` and choose the "Abandoned" chip.
2. Choose "See all on Payments".
3. Choose the next page.

**Expected:**
- Payments is headed "In dunning (N matching · M members)" and the "Abandoned" chip is still chosen.
- The next page lists the next 50 matching charges.

#### 1.11 AS-11 Without a search or filter the overview card is as it is today

**Steps:**
1. Sign in as the owner of Nordic Fitness Group.
2. Open `/app`.

**Expected:**
- "In dunning now" lists the members of the 8 newest charges in open dunning, newest attempt first.
- The card offers "All payments" (`/app/payments`).
- No count line is shown.

#### 1.12 AS-12 Without a search or filter Payments lists 100 charges as it does today

**Steps:**
1. Sign in as the owner of Nordic Fitness Group.
2. Open `/app/payments`.

**Expected:**
- The dunning list is headed "In dunning (100)" and lists the 100 newest charges in open dunning.

#### 1.13 AS-13 Front desk still cannot reach payments

**Steps:**
1. Sign in as the front desk at Puls Träning and open `/app`.
2. Read "In dunning now" and the rest of the overview.
3. Open `/app/payments`.

**Expected:**
- "In dunning now" is shown with 8 rows and no "All payments" link; there is no Payments tab.
- The "Payment run" summary and its "In dunning" figure are not shown.
- `/app/payments` says "Not available to your role" and shows no dunning list.
