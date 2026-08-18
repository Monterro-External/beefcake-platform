# Runbook: onboarding a new operator

From signed contract to a gym that can take a member's money and open its own
door. Half a day of work spread over a week, mostly waiting on the bank.

## Before you start, get these from the operator

- Legal name and org number, for receipts
- Country, which decides currency, locale, timezone and payment method
- Every site: name, address, and which door-controller vendor is on the wall
- Their plans: name, price, binding months, whether the plan covers one gym or
  all of them
- Notice period, if it is not 30 days
- Who the owner is, and one manager per site

Ask about the plans properly. Half of the onboarding problems we have are an
operator who described three plans and actually sells five, and the two they
forgot are the cheap ones everybody is on.

## 1. Create the tenant

There is no self-serve signup: an operator is created by us. Currency, locale and
timezone come from the country and are not independently editable, because a
Swedish operator invoicing in NOK is a support ticket, not a feature.

```sql
insert into tenants (id, name, org_number, country, currency, locale, segment, plan_tier, status, created_at)
values ('ten_...', 'Name AB', '556000-0000', 'SE', 'SEK', 'sv-SE', 'long_tail', 'starter', 'active', '2026-08-26T09:00:00.000Z');
```

Segment matters later: it is what the CS team sorts by, and it decides who gets
called when their health score drops.

## 2. Sites, one row each

Each site carries its **own timezone** and its **own access vendor**. Both are
load-bearing:

- The timezone decides which calendar day a check-in is filed under, and every
  access report groups by that.
- The vendor decides which adapter normalises their check-in timestamps. Getting
  it wrong produces check-ins on the wrong day, which nobody notices for weeks.

Confirm the vendor by looking at the box, not by asking. Operators frequently do
not know.

## 3. Plans

Prices are integer minor units plus a currency. 399,00 kr is `39900` and `SEK`.
Set `sites_scope` to `home_site` or `all_sites`, and `binding_months` to 0 unless
the operator actually sells a binding period.

Do not leave a plan out because it is being retired: existing members are on it,
and a subscription pointing at a plan that does not exist breaks their payment
run.

## 4. Settings, only where they differ

Everything has a platform default, and most operators should keep it. Write a
`tenant_settings` row only where this operator genuinely differs:

| Key | Default | Set it when |
|---|---|---|
| `notice_period_days` | 30 | Their contract says 60 or 90 |
| `retry_attempts` | 3 | Their bank or their finance team asked |
| `retry_interval_days` | 3 | As above |
| `access_grace_hours` | 48 | They want a tighter door than we default to |
| `max_freeze_months` | 3 | Their terms differ |

Every row you write is a row that stops tracking the platform default forever.
Leave it alone if you can.

## 5. Payment mandates

The slow part. Members need a mandate before they can be charged: Autogiro in
Sweden, AvtaleGiro in Norway, a stored card in Finland and Denmark. Migrating
operators bring an existing member base, which means a bulk mandate transfer with
their old provider, and that takes days.

Until the mandates are live, **do not run a payment run for them**. Every member
without a mandate fails with `mandate_cancelled`, which is terminal, so it burns
no retries but does send a failure notification to every member on their first
day with us. That is the worst possible introduction.

Check before the first run:

```sql
select count(*) from members where tenant_id = 'ten_...' and card_id is null;
```

## 6. Members and access cards

Import the member base, then issue cards. Card numbers are unique across the
whole estate, not per operator, because a card is a physical object that could be
carried into any of our customers' gyms.

Then push the door lists and confirm they landed:

```bash
npm run jobs:access-sync -- --tenant ten_... --dry-run
npm run jobs:access-sync -- --tenant ten_...
```

`sitesFailed 0` and `pending_changes 0` per site, or go to
`docs/runbooks/access-sync-stuck.md`.

## 7. First payment run

Run it by hand, for that tenant only, and watch it:

```bash
npm run jobs:payment-run -- --tenant ten_... --dry-run
npm run jobs:payment-run -- --tenant ten_...
```

A first-attempt failure rate above about 10% means the mandate transfer is
incomplete. Stop, do not let the retries run, and go back to step 5. The retries
will not fix a missing mandate and each one notifies the member.

## 8. Hand over

- Walk the owner through `/app`, starting at the overview.
- Walk one site manager through `/app/classes` and one front desk user through
  `/app/members`. Front desk is where the software is actually used.
- Tell them the payment run goes out on the 25th and what the notice period is
  set to. Those two facts generate most of their first month's questions.
- Set a reminder to look at their health score in three weeks. A new operator
  with a failed-payment rate that has not settled by then has a mandate problem
  nobody escalated.
