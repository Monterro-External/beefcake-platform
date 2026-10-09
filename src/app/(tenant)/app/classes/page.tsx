/**
 * The class schedule.
 *
 * A day at a time, per site, because that is how a site manager thinks about it:
 * "what is on tonight and is anything empty". Fill and waitlist are on the same
 * row as the class, so the two decisions (add a class, drop a class) are visible
 * without opening anything.
 */

import Link from 'next/link';
import {
  Badge,
  Card,
  EmptyState,
  Meter,
  PageHeader,
  Select,
  StatTile,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@/components/ui';
import { DayPicker } from './day-picker';
import { activeTenant, getSession, tenantScopeFor } from '@/lib/session';
import { clock } from '@/lib/clock';
import { date as formatDate, humanise, integer, noShowPercent, percent, timeOfDay } from '@/lib/format';
import * as classesRepo from '@/db/repositories/classes';
import * as tenantsRepo from '@/db/repositories/tenants';
import * as reports from '@/export/reports';
import { type PlainDate, addDays, assertPlainDate, isPlainDate, startOfDay } from '@/domain/dates';
import { timezoneForCountry } from '@/jobs/runner';

export const dynamic = 'force-dynamic';

export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string; site?: string }>;
}) {
  const params = await searchParams;
  const session = await getSession();
  const tenant = activeTenant(session);
  if (tenant === null) return null;

  const scope = tenantScopeFor(session);
  const time = clock();
  const tenantTimezone = timezoneForCountry(tenant.country);
  const today = time.today(tenantTimezone);
  const locale = tenant.locale;

  const sites = tenantsRepo.listSites(scope);
  const siteId = params.site !== undefined && params.site !== '' ? params.site : (sites[0]?.id ?? '');
  const site = sites.find((candidate) => candidate.id === siteId) ?? sites[0];
  const timezone = site?.timezone ?? tenantTimezone;

  const day: PlainDate =
    params.day !== undefined && isPlainDate(params.day) ? assertPlainDate(params.day) : today;

  const from = startOfDay(day, timezone).toISOString();
  const to = startOfDay(addDays(day, 1), timezone).toISOString();
  const dayClasses = site === undefined ? [] : classesRepo.listClasses(scope, { siteId: site.id, from, to });
  const counts = classesRepo.bookingCounts(
    scope,
    dayClasses.map((klass) => klass.id),
  );

  const fill = reports.classFillBySite(scope, reports.windowOfDays(today, 30), time.now);
  const siteFill = fill.find((row) => row.siteId === site?.id);

  const dayCapacity = dayClasses
    .filter((klass) => !klass.cancelled)
    .reduce((acc, klass) => acc + klass.capacity, 0);
  const dayBooked = dayClasses.reduce((acc, klass) => acc + (counts.get(klass.id)?.booked ?? 0), 0);
  const dayWaitlisted = dayClasses.reduce(
    (acc, klass) => acc + (counts.get(klass.id)?.waitlisted ?? 0),
    0,
  );

  return (
    <>
      <PageHeader
        title="Classes"
        subtitle={`${site?.name ?? 'No sites'} · ${formatDate(day, locale)}`}
        actions={
          <form className="flex items-center gap-2">
            <Select name="site" defaultValue={siteId} aria-label="Site">
              {sites.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
            <input type="hidden" name="day" value={day} />
            <button
              type="submit"
              className="rounded border border-line bg-surface-raised px-2.5 py-1.5 font-medium hover:bg-accent-soft"
            >
              Show
            </button>
          </form>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Classes today"
          value={integer(dayClasses.filter((klass) => !klass.cancelled).length, locale)}
          hint={
            dayClasses.some((klass) => klass.cancelled)
              ? `${dayClasses.filter((klass) => klass.cancelled).length} cancelled`
              : undefined
          }
        />
        <StatTile
          label="Places booked"
          value={`${integer(dayBooked, locale)} / ${integer(dayCapacity, locale)}`}
          hint={dayCapacity === 0 ? undefined : percent(dayBooked / dayCapacity, 0, locale)}
        />
        <StatTile
          label="On waitlists"
          value={integer(dayWaitlisted, locale)}
          tone={dayWaitlisted > 0 ? 'warn' : 'neutral'}
          hint={dayWaitlisted > 0 ? 'Promoted automatically as spots free up' : undefined}
        />
        <StatTile
          label="Site fill, 30 days"
          value={siteFill === undefined ? '-' : percent(siteFill.fillRate, 0, locale)}
          hint={
            siteFill === undefined
              ? undefined
              : `${noShowPercent(siteFill.noShowRate, locale)} no-show over ${integer(siteFill.classes, locale)} classes`
          }
        />
      </div>

      <div className="mb-4">
        <DayPicker day={day} today={today} siteId={siteId} />
      </div>

      <Card title={`Schedule, ${formatDate(day, locale)}`}>
        {dayClasses.length === 0 ? (
          <EmptyState
            title="Nothing on this day"
            hint="The seeded timetable covers the last eight weeks and the next two."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Time</TH>
                <TH>Class</TH>
                <TH align="right">Booked</TH>
                <TH>Fill</TH>
                <TH align="right">Waitlist</TH>
                <TH />
              </TR>
            </THead>
            <tbody>
              {dayClasses.map((klass) => {
                const count = counts.get(klass.id) ?? { booked: 0, waitlisted: 0 };
                const rate = klass.capacity === 0 ? 0 : count.booked / klass.capacity;
                return (
                  <TR key={klass.id} data-class-id={klass.id} className={klass.cancelled ? 'opacity-50' : undefined}>
                    <TD mono className="whitespace-nowrap">
                      {timeOfDay(klass.startsAt, timezone)}
                      <span className="text-ink-muted">-{timeOfDay(klass.endsAt, timezone)}</span>
                    </TD>
                    <TD>
                      <Link href={`/app/classes/${klass.id}`} className="font-medium text-accent">
                        {klass.name}
                      </Link>
                      {klass.cancelled && (
                        <>
                          {' '}
                          <Badge tone="bad">Cancelled</Badge>
                        </>
                      )}
                    </TD>
                    <TD align="right" mono>
                      {count.booked} / {klass.capacity}
                    </TD>
                    <TD className="w-40">
                      <div className="flex items-center gap-2">
                        <Meter
                          value={rate}
                          tone={rate >= 1 ? 'good' : rate < 0.4 ? 'warn' : 'info'}
                        />
                        <span className="w-10 text-right tabular-nums text-ink-muted">
                          {percent(rate, 0, locale)}
                        </span>
                      </div>
                    </TD>
                    <TD align="right">
                      {count.waitlisted > 0 ? (
                        <Badge tone="warn">{count.waitlisted}</Badge>
                      ) : (
                        <span className="text-ink-muted">-</span>
                      )}
                    </TD>
                    <TD align="right">
                      <Link href={`/app/classes/${klass.id}`} className="text-accent">
                        Roster
                      </Link>
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="mt-4">
        <Card title="Fill by site, last 30 days">
          {fill.length === 0 ? (
            <EmptyState title="No classes in the window" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Site</TH>
                  <TH align="right">Classes</TH>
                  <TH align="right">Places</TH>
                  <TH align="right">Booked</TH>
                  <TH>Fill</TH>
                  <TH align="right">No-show</TH>
                  <TH align="right">Waitlisted</TH>
                </TR>
              </THead>
              <tbody>
                {fill.map((row) => (
                  <TR key={row.siteId}>
                    <TD>{row.siteName}</TD>
                    <TD align="right">{integer(row.classes, locale)}</TD>
                    <TD align="right">{integer(row.capacity, locale)}</TD>
                    <TD align="right">{integer(row.booked, locale)}</TD>
                    <TD className="w-40">
                      <Meter
                        value={row.fillRate}
                        tone={row.fillRate > 0.85 ? 'good' : row.fillRate < 0.5 ? 'warn' : 'info'}
                      />
                    </TD>
                    <TD align="right">{noShowPercent(row.noShowRate, locale)}</TD>
                    <TD align="right">{integer(row.waitlisted, locale)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
          <p className="mt-3 text-ink-muted">
            A class that is {humanise('waitlisted').toLowerCase()} week after week is a class to run
            twice. One under 40% is a slot to move.
          </p>
        </Card>
      </div>
    </>
  );
}
