# Runbook: a site's access sync is stuck

You are here because a door is letting the wrong people in or keeping the right
people out, or because the sync-lag alert fired.

The important thing to hold on to: a controller that has not synced is not
*broken*. It is running on the last allow-list it accepted. Everyone who was
valid then still gets in, including members who have since cancelled, and anyone
who joined since does not. That is the shape of every report you will get.

## Find out how far behind it is

```bash
npm run export:signals -- --out /tmp/signals
column -s, -t /tmp/signals/access-sync.csv
```

Or straight from the database:

```bash
sqlite3 data/beefcake.db "
  select t.name, s.name, s.access_provider,
         a.last_synced_at, a.last_success_at, a.pending_changes, a.last_error
    from sites s
    join tenants t on t.id = s.tenant_id
    left join access_sync_state a on a.site_id = s.id
   where a.last_success_at is null
      or a.last_success_at < datetime('now', '-48 hours')
   order by a.last_success_at;"
```

`/app/access` shows the same table to the operator, and `/admin/<tenant>` shows
it to us.

## Read the error

| `last_error` | Means | Do this |
|---|---|---|
| `controller unreachable (timeout after 30s)` | Network or the box is off | The site has to check the box. Nothing we can do remotely |
| `ERR_QUEUE_FULL: controller rejected delta, full resync required` | Provider B applied deltas until it ran out of room | Force a full push, below |
| null, but `last_success_at` is old | The job is not running for this site | Check `job_runs` |
| null and `last_synced_at` is also null | The site has never synced | New site: check it was commissioned |

```bash
sqlite3 data/beefcake.db "
  select status, started_at, finished_at, summary_json
    from job_runs where job = 'access-sync' order by started_at desc limit 5;"
```

## Push it now

```bash
npm run jobs:access-sync -- --tenant ten_xxx
npm run jobs:access-sync -- --tenant ten_xxx --dry-run   # count the grants first
```

The job pushes a list covering today plus three days, so one successful run
clears the backlog. Watch `sitesSynced` and `sitesFailed` in the summary.

If a provider B site keeps returning `ERR_QUEUE_FULL`, the controller needs a
full resync rather than another delta. Until we expose that, it is a vendor
support call.

## While it is behind

Two things are true and both need saying out loud to the operator:

1. **Ex-members may still get in.** Anyone whose membership ended after the last
   successful sync is still on the controller's list. If that matters (it usually
   does), the site can block the card at the door manually, and the front desk
   can see who is affected:

   ```bash
   sqlite3 data/beefcake.db "
     select m.name, m.card_id, s.ends_on
       from subscriptions s join members m on m.id = s.member_id
      where s.tenant_id = 'ten_xxx' and s.ends_on is not null
        and s.ends_on >= date((select last_success_at from access_sync_state where site_id = 'sit_xxx'))
      order by s.ends_on;"
   ```

2. **New members cannot get in.** Anyone who joined since the last successful
   sync is not on the list. The front desk has to let them in by hand. They will
   remember this, so it is worth a call rather than waiting for the complaint.

## Verify

After a successful push, `pending_changes` is 0 and `last_success_at` is now.
Then check that check-ins are landing on the right day, which is the thing that
goes wrong quietly:

```bash
sqlite3 data/beefcake.db "
  select local_day, count(*), min(at), max(at)
    from access_events
   where site_id = 'sit_xxx' and local_day >= date('now', '-3 day')
   group by local_day order by local_day;"
```

The site's timezone decides `local_day`, and the two vendors report timestamps
differently: provider A sends an offset, provider B sends bare local wall-clock
time. A day's events clustered at the wrong end of the day, or a day with
events but a neighbour with none, means the adapter and not the controller.
