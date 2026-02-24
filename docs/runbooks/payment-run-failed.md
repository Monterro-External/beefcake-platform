# Runbook: the payment run has not finished

You are here because it is 07:00, a run is not `completed`, or an operator has
called about being charged twice or not at all.

## First, establish which of the four this is

```bash
sqlite3 data/beefcake.db "
  select t.name, r.period, r.status, r.charges_attempted, r.charges_failed,
         r.started_at, r.finished_at
    from payment_runs r join tenants t on t.id = r.tenant_id
   where r.status != 'completed' or r.period = strftime('%Y-%m', 'now')
   order by r.started_at desc;"
```

| What you see | What it means | Go to |
|---|---|---|
| No row for this period | The run never started | [Never started](#never-started) |
| `status = 'running'`, `finished_at` null, started hours ago | The process died part way | [Died part way](#died-part-way) |
| `status = 'completed'`, high `charges_failed` | The run worked, the bank did not | [High failure rate](#high-failure-rate) |
| Two rows for the same tenant and period | Should be impossible: there is a unique key | [Duplicate runs](#duplicate-runs) |

## Never started

Check the job log first. A run that never started leaves no `payment_runs` row
but the scheduler still recorded an attempt:

```bash
sqlite3 data/beefcake.db "
  select job, status, started_at, finished_at, summary_json
    from job_runs where job = 'payment-run'
   order by started_at desc limit 5;"
```

A `failed` row with an error in `summary_json` is the answer. If there is no row
at all, the scheduler did not fire and this is an infrastructure problem, not a
Beefcake one.

Run it by hand once you know why:

```bash
npm run jobs:payment-run                       # every tenant
npm run jobs:payment-run -- --tenant ten_xxx   # one tenant
npm run jobs:payment-run -- --dry-run          # see what it would do first
```

The job is idempotent per tenant and period. Running it again on a period that
has already gone out charges nobody: it finds the completed run and only
processes retries that are due.

## Died part way

A run left in `running` means the process was killed or the machine went away
somewhere in the middle. Some members were charged and some were not.

**Do not create a second run.** The next invocation handles this: it discards the
partial attempt (its charges and receipts) and bills the period cleanly. That is
deliberate, because the alternative is a month that is half charged and no way to
tell which half.

```bash
npm run jobs:payment-run -- --tenant ten_xxx
```

Look for `partialRunsDiscarded 1` in the summary. Then confirm nobody has two
first attempts for the period:

```bash
sqlite3 data/beefcake.db "
  select c.member_id, count(*) from charges c
    join payment_runs r on r.id = c.payment_run_id
   where r.tenant_id = 'ten_xxx' and r.period = '2026-08' and c.attempt = 1
   group by c.member_id having count(*) > 1;"
```

Empty is correct. If it is not, stop and get somebody else: money has been taken
twice and that is a phone call to the operator, not a fix.

## High failure rate

A completed run with a failure rate well above the tenant's usual is either the
provider or the tenant's own members. Split it by code:

```bash
sqlite3 data/beefcake.db "
  select coalesce(failure_code, 'none') as code, count(*)
    from charges
   where payment_run_id = 'run_xxx'
   group by code order by 2 desc;"
```

- **Mostly `insufficient_funds`** is normal, especially before the 25th. The
  retry schedule handles it. Nothing to do.
- **Mostly `technical`** is us or the provider. Check `errors` for the same
  window (`where = 'integrations/payment'`). Retries will pick these up; if the
  provider is down, the retries will fail too, and you want to widen the retry
  interval for that tenant rather than burn all three attempts in six days.
- **A spike in `mandate_cancelled`** across many members at once is not a member
  problem. Mandates do not lapse in batches. Check whether a mandate file failed
  to load.

The failure rate is on the run detail screen at `/app/payments/<run id>`, broken
down the same way, and that screen is what to share with the operator.

## Duplicate runs

`payment_runs` has a unique index on `(tenant_id, period)`, so this cannot happen
through the job. If you are looking at two rows, somebody has been in the
database by hand. Work out which run's charges are real, and escalate: this is a
data-integrity incident.

## After any of the above

Tell the operator what happened before they ask. The screen they will look at is
`/app/payments`, and the number they will care about is the outstanding total in
dunning. Every member abandoned by dunning is a cancellation in two to three
weeks unless somebody calls them, so hand the CSM the list:

```bash
npm run export:signals -- --out /tmp/signals
# then read /tmp/signals/churn.csv and payment-runs.csv
```
