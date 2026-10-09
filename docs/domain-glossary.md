# Domain glossary

The words we use for things, and what they mean precisely. Support, product and
engineering all use this list, so if a term here does not match what a customer
calls it, fix the term rather than translating in your head.

`docs/agents/rules.md` has the short version. This is the one with the edge cases.

## The three layers

```
Beefcake (vendor)  →  tenant (gym operator)  →  member (the operator's customer)
```

**Beefcake** is us. We have staff, not members. A Beefcake employee in the
database has role `beefcake_admin` and no `tenant_id`.

**Tenant** is a gym operator: our paying customer, one row in `tenants`. Carries
a country, a currency, a locale and a segment. Everything a tenant owns has that
tenant's id on it. Operators call themselves "the chain", "the club" or just
their own name; in code and in tickets they are the tenant.

**Operator** is the same party as the tenant, in the commercial register: who we
sell to, what the market looks like, what a customer is worth. Strategy and sales
material say operator. Anything a ticket, a spec or the code says about the party
says tenant, and a ticket written in the commercial register fails the grill's
vocabulary check.

**Member** is the operator's customer, the person who trains. A member belongs to
exactly one tenant and has one home site. Members never see the word tenant.

The distinction matters when something goes wrong, because the pain travels
upwards: a bug hurts a member, the site manager hears about it at the desk, the
owner calls our support, and repeated pain churns the tenant.

## Segments

| Segment | Count | Shape | Behaviour |
|---|---|---|---|
| `long_tail` | ~250 | One site, 300 to 900 members | Low ARR each, quick to raise a ticket, quick to leave |
| `mid` | ~80 | 2 to 5 sites, 1,000 to 3,500 members | Cares about multi-site reporting |
| `key_account` | 10 | 6 to 15 sites, up to 22,000 members | ~35% of ARR, has a finance team that checks our numbers |

## Sites and hardware

**Site** is one physical gym. A tenant has one or more. A site carries its own
timezone, which is the timezone used for every calendar decision about events at
that site, and its own access hardware vendor.

**Access provider** is the door-controller vendor for a site, either
`access-provider-a` or `access-provider-b`. They are named generically because
the difference that matters is technical, not commercial: provider A reports
check-in timestamps as ISO-8601 with an offset, provider B reports a bare local
wall-clock string with no timezone information at all.

**Controller** is the box on the wall by the door. It holds an offline
**allow-list** so the door keeps working when the network does not. The nightly
access sync job pushes that list.

## Plans and subscriptions

**Plan** is a priced product a tenant sells. Name, price, interval, binding
months, site scope. Plans belong to a tenant and are never shared between them,
so "the Bas plan" is ambiguous without saying whose.

**Site scope** is either `home_site` (this plan only opens the member's own gym)
or `all_sites` (any of the tenant's gyms). This is the single most common upsell.

**Subscription** is a member on a plan. The `status` column holds the *intent*
someone expressed: `pending`, `active`, `cancelling`, `cancelled`. Whether a
subscription is **frozen** is a fact about the `freezes` table, and whether it has
**ended** is a fact about `ends_on` and today's date. Both are computed, never
stored. `effectiveStatus()` in `src/domain/subscriptions.ts` is the function that
combines them, and it is what the UI shows.

**Binding period** (`binding_until`) is the date until which the member committed
to stay. It blocks a **downgrade** and never blocks an **upgrade**. A freeze
pushes it out by the length of the freeze, because a frozen month is not a month
of membership.

**Notice period** is the number of days between a member giving notice and their
subscription ending. A tenant setting, 30 days by default, 60 at some operators.

**Cancellation** has three dates and they are all different:

| Date | Means |
|---|---|
| `cancelled_on` | The day the member gave notice |
| `notice_ends_on` | `cancelled_on` plus the notice period |
| `ends_on` | The last day of membership: the later of `notice_ends_on` and `binding_until`, rounded up to the end of the billing period if the tenant bills that way |

Access is granted up to and including `ends_on`. There is no grace after that.

**Freeze** (*uppehåll* in Swedish, *frys* in Norwegian, *tauko* in Finnish) is a
paused subscription for a whole number of months. Not billed, no access, binding
extended. Stored as an inclusive `starts_on` to `ends_on` pair; the member is
back on `ends_on` plus one day.

Say *freeze*, never "pause the account".

The month-end rule is the part that gets broken. A freeze covers whole months, so
one that starts on the last day of a month has to resume on the first day of a
month:

| Freeze starts | One month later, ends | Resumes |
|---|---|---|
| 15 March | 14 April | 15 April |
| 31 January | 28 February | 1 March |
| 31 January (leap year) | 29 February | 1 March |
| 31 March | 30 April | 1 May |
| 30 April | 31 May | 1 June |

Front desk books a lot of freezes "from the end of the month", so this path is
busy, and it is busiest in January and over the summer.

## Money and billing

**Billing period** is a calendar month, named `YYYY-MM`.

**Payment run** is the monthly batch that charges every member of one tenant. It
goes out on the **25th** and bills the calendar month it is in, in arrears. The
25th is not arbitrary: most Swedish and Norwegian salaries land on the 25th, and
a direct debit attempted the day before payday fails.

**Charge** is one attempt to take money for one member for one period. A retry is
a **new row** with a higher `attempt`, not an update, so the history of a
struggling account is readable.

Charge statuses:

| Status | Means |
|---|---|
| `pending` | Created, not yet sent |
| `succeeded` | Taken. `settled_at` is when the money actually arrives, two banking days later |
| `failed` | This attempt failed and another one is scheduled |
| `retrying` | Failed, and the next attempt is still in the future. This is live work |
| `abandoned` | Dunning gave up. Nobody is going to try again |

**Mandate** is the member's standing authorisation to be debited: Autogiro in
Sweden, AvtaleGiro in Norway. No mandate, no charge, and a cancelled mandate
fails identically forever, which is why it is a terminal failure.

**Failure code** is what the provider told us:

| Code | Retryable | Typical cause |
|---|---|---|
| `insufficient_funds` | Yes | Money arrives on payday |
| `technical` | Yes | Provider had a bad minute |
| `rejected_by_bank` | Yes | Usually transient at the receiving bank |
| `mandate_cancelled` | No | The member revoked the authorisation |
| `account_closed` | No | The account is gone |

**Dunning** is the retry sequence after a failed charge: by default three
attempts, three days apart. Every attempt costs a fee and sends a notification
the member reads as spam, so the cap and the interval both matter commercially.

**Abandoned** is the end of dunning, and it is the most important event in the
company's data. Two to three weeks after a member is abandoned, they cancel. That
lag is why a payment reliability problem shows up in the churn report a month
after it started, and why the churn report and the failed-payments report have to
be read together. Say *abandoned*, never "given up on".

A **cancellation** is voluntary: the member gave notice. A member lost after
dunning abandoned is **involuntary churn**, even though a cancellation follows
it. Keep the two apart: involuntary churn is a payment reliability problem, and
a cancellation is not.

**Proration** is splitting a period's price by days. A member who upgrades on the
12th of a 31-day month is charged 11 days of the old plan and 20 days of the new
one. The day of the change belongs to the new plan.

**Receipt** is the document a member can download for a successful charge. Its
currency is the tenant's currency, always, regardless of who is reading it.

## Classes

**Class** is one instance of a session at a site: name, instructor, start, end,
capacity. Not a template; the weekly timetable produces class rows.

**Cancelled class** is a class the tenant has called off. It stays on the
timetable, and its bookings no longer give a place in a class that runs. Not to
be confused with a booking's `cancelled` status, which is one member's place
ending: the member cancelled it, or promotion released it.

**Booking** is a member on a class. Statuses: `booked`, `waitlisted`,
`cancelled`, `attended`, `no_show`. A member has at most one booking per class.

**Waitlist** is the ordered queue on a full class. `position` is 1-based and 1 is
next. Positions are closed up when somebody leaves the queue, so there are never
gaps.

**Promotion** is moving a waitlisted member into a freed spot. It is not just a
status change: a member waiting for the 18:00 spin class has usually booked the
18:15 circuit class as a fallback, and promoting them has to release that
fallback booking. Otherwise the site manager sees a class that looks full while
half the room does not turn up, which is the complaint they actually raise.

**Calendar file** is a member's download of their upcoming booked classes, for
their own calendar app. It is a snapshot at download, not a feed: nothing changes
in the member's calendar until they download again. Upcoming means booked and
not yet started. Each booking keeps one identity across downloads. A booking on a
class that has not started appears as cancelled when the member cancelled it,
when promotion released it, or when it is on a cancelled class, so a re-import
removes it rather than leaving the old class behind. A member gets a file as
long as it holds at least one entry, even if every entry is cancelled; only a
member with nothing to send gets no file.

**Fill rate** is places taken divided by capacity: every booking that holds a
place, whether upcoming, unmarked, attended or a no-show. Waitlisted and
cancelled bookings hold no place. **No-show rate** is no-shows divided by
attended bookings plus no-shows. A site that has marked nothing in the period
has no no-show rate, not a rate of zero. Both are per site and per period, a
class falling in the period of its site-local day, and both are what an owner
uses to decide whether to keep a timetable slot.

**Unmarked booking** is a booking on a class that has started whose attendance
was never recorded, so it is neither attended nor a no-show. Staff mark the
roster one booking at a time, so a class can hold both marked and unmarked
bookings. An unmarked booking counts in neither side of the no-show rate and is
reported on its own, because an entry nobody marked says nothing about the
member.

## Access

**Access event** is a swipe at a door: instant, site-local day, granted or
denied, and a reason. The site-local day is decided by the hardware adapter, so a
timezone bug in an adapter is a reporting bug.

Reasons a swipe is denied:

| Reason | Means |
|---|---|
| `frozen` | Mid-freeze, outside the grace window |
| `subscription_ended` | Past `ends_on`. No grace, ever |
| `not_started` | Before the subscription starts |
| `no_subscription` | No subscription at all |
| `unknown_card` | Card is not on the system |
| `member_blocked` | Blocked by the operator, usually an unpaid balance |
| `site_not_included` | A `home_site` plan at a different gym |

**Grace hours** (`access_grace_hours`, 48 by default) is how long access is still
granted **after a freeze starts**. It exists because a member who freezes at the
front desk at 17:00 is standing there in gym clothes, and locking them out of
that evening's session is the kind of thing that produces a one-star review.

It does not apply to cancellations. A cancelled subscription already ran to the
end of a generous notice period; after `ends_on` the card is dead. An ex-member in
the building at 22:00 is a security incident, and owners are unforgiving about it.

**Access sync** is the nightly job that pushes each site's allow-list to its
controller. **Sync lag** is how long since a site last synced successfully. A
site that has not synced is running on a stale list, which is both a security and
a support problem, so lag is an input to the tenant health score.

## Signals

**Event** is a row in `events`: who did what, per tenant. This is the
product-usage stream, and it is exported for the commercial side, so action names
are a public contract. Add a new action rather than repurposing an old one.

**Error** is a row in `errors`: something went wrong, with a module and usually a
tenant attached, so support can answer "is it just us" without a log search.

**Outbox** is every notification we would have sent. In development and CI
nothing leaves the machine; the fake email and SMS gateways write here, and the
notification log in the app reads it back.

**Health score** is 0 to 100 per tenant, computed from platform inputs only:
failed payment rate, 90-day churn, class fill, error rate, access sync lag and
member app adoption. Its job is to sort 340 tenants so a CSM knows who to call,
not to be a model. Support ticket volume and NPS live in other systems and are
joined in downstream, so they must never be folded into this number.
