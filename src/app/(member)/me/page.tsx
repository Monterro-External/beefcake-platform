/**
 * The member's class schedule.
 *
 * A week at their home site, with what they are already booked onto marked, and
 * one button per class. Full classes offer the waitlist rather than hiding, so
 * the member knows a spot may open up.
 */

import {
  Badge,
  Callout,
  Card,
  EmptyState,
  PageHeader,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@/components/ui';
import { BookButton } from './book-button';
import { getSession, tenantScopeFor } from '@/lib/session';
import { clock } from '@/lib/clock';
import { date as formatDate, humanise, integer, timeOfDay } from '@/lib/format';
import * as classesRepo from '@/db/repositories/classes';
import * as subscriptionsRepo from '@/db/repositories/subscriptions';
import * as tenantsRepo from '@/db/repositories/tenants';
import { bookings } from '@/db/schema';
import { guard } from '@/db/repositories/scope';
import { and, eq, inArray } from 'drizzle-orm';
import { type PlainDate, addDays, localDay, startOfDay } from '@/domain/dates';
import { effectiveStatus } from '@/domain/subscriptions';
import { calendarFile } from '@/domain/calendar-file';
import { timezoneForCountry } from '@/jobs/runner';

export const dynamic = 'force-dynamic';

const HORIZON_DAYS = 7;

export default async function MemberSchedule() {
  const session = await getSession();
  const member = session.member;
  const tenant = session.tenant;
  if (member === null || tenant === null) return null;

  const scope = tenantScopeFor(session);
  const time = clock();
  const locale = tenant.locale;
  const sites = tenantsRepo.listSites(scope);
  const homeSite = sites.find((site) => site.id === member.homeSiteId);
  const timezone = homeSite?.timezone ?? timezoneForCountry(tenant.country);
  const today = time.today(timezone);

  const subscription = subscriptionsRepo.currentSubscription(scope, member.id);
  const plan = subscription === null ? null : subscriptionsRepo.getPlan(scope, subscription.planId);
  const freezes =
    subscription === null
      ? []
      : subscriptionsRepo
          .listFreezes(scope, subscription.id)
          .map((freeze) => ({
            startsOn: freeze.startsOn as PlainDate,
            endsOn: freeze.endsOn as PlainDate,
          }));
  const state =
    subscription === null
      ? 'pending'
      : effectiveStatus(subscriptionsRepo.toRecord(subscription), freezes, today);

  // A plan for all sites can book anywhere; the default is the member's own gym.
  const bookableSites =
    plan?.sitesScope === 'all_sites' ? sites : sites.filter((site) => site.id === member.homeSiteId);

  const from = time.now.toISOString();
  const to = startOfDay(addDays(today, HORIZON_DAYS), timezone).toISOString();
  const upcoming = classesRepo
    .listClasses(scope, { from, to, limit: 400 })
    .filter((klass) => bookableSites.some((site) => site.id === klass.siteId) && !klass.cancelled);

  const counts = classesRepo.bookingCounts(
    scope,
    upcoming.map((klass) => klass.id),
  );

  const mine =
    upcoming.length === 0
      ? []
      : guard(
          scope,
          'bookings',
          scope.db
            .select()
            .from(bookings)
            .where(
              and(
                eq(bookings.tenantId, scope.tenantId),
                eq(bookings.memberId, member.id),
                inArray(
                  bookings.classId,
                  upcoming.map((klass) => klass.id),
                ),
              ),
            )
            .all(),
        );
  const myBooking = new Map(
    mine.filter((booking) => booking.status !== 'cancelled').map((booking) => [booking.classId, booking]),
  );

  const byDay = new Map<PlainDate, typeof upcoming>();
  for (const klass of upcoming) {
    const day = localDay(new Date(klass.startsAt), timezone);
    const list = byDay.get(day) ?? [];
    list.push(klass);
    byDay.set(day, list);
  }

  // The same decision the download makes, so the button never leads to no file.
  const nothingToSend = calendarFile(
    classesRepo.calendarBookings(scope, member.id, time.now.toISOString()),
    time.now,
  ).nothingToSend;

  const canBook = state === 'active' || state === 'cancelling';
  const siteNames = new Map(sites.map((site) => [site.id, site.name]));

  return (
    <>
      <PageHeader
        title={`Hej ${member.name.split(' ')[0]}`}
        subtitle={
          plan === null ? (
            'No membership'
          ) : (
            <>
              {plan.name} at {homeSite?.name} · {humanise(state)}
            </>
          )
        }
        actions={<Badge tone={canBook ? 'good' : 'warn'}>{humanise(state)}</Badge>}
      />

      {state === 'frozen' && (
        <div className="mb-4">
          <Callout tone="warn" title="Your membership is frozen">
            You cannot book while frozen. Your card starts working again the day the freeze ends.
          </Callout>
        </div>
      )}
      {state === 'ended' && (
        <div className="mb-4">
          <Callout tone="bad" title="Your membership has ended">
            Talk to the front desk to start again.
          </Callout>
        </div>
      )}
      {state === 'cancelling' && subscription?.endsOn != null && (
        <div className="mb-4">
          <Callout tone="warn" title="You have given notice">
            You can train and book until {formatDate(subscription.endsOn as PlainDate, locale)}.
          </Callout>
        </div>
      )}

      <section aria-label="Calendar file" className="mb-4 flex flex-wrap items-center gap-3">
        {nothingToSend ? (
          <span className="text-ink-muted">You have no upcoming booked classes.</span>
        ) : (
          <>
            {/* A plain anchor: the answer is a file download, not a page to route to. */}
            <a
              href="/me/calendar"
              download
              className="inline-flex items-center justify-center gap-1.5 rounded border border-line bg-surface-raised px-2.5 py-1.5 font-medium hover:bg-accent-soft"
            >
              Add my booked classes to your calendar
            </a>
            <span className="text-ink-muted">Changed a booking? Download again to update your calendar.</span>
          </>
        )}
      </section>

      {byDay.size === 0 ? (
        <Card>
          <EmptyState
            title="No classes in the next week"
            hint="The timetable is published a fortnight ahead."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {[...byDay].map(([day, dayClasses]) => (
            <Card
              key={day}
              title={`${formatDate(day, locale)}${day === today ? ' · today' : ''}`}
            >
              <Table>
                <THead>
                  <TR>
                    <TH>Time</TH>
                    <TH>Class</TH>
                    {bookableSites.length > 1 && <TH>Site</TH>}
                    <TH align="right">Places</TH>
                    <TH align="right" />
                  </TR>
                </THead>
                <tbody>
                  {dayClasses.map((klass) => {
                    const count = counts.get(klass.id) ?? { booked: 0, waitlisted: 0 };
                    const free = Math.max(0, klass.capacity - count.booked);
                    const booking = myBooking.get(klass.id);
                    const siteTimezone =
                      sites.find((site) => site.id === klass.siteId)?.timezone ?? timezone;
                    return (
                      <TR key={klass.id} data-class-id={klass.id}>
                        <TD mono className="whitespace-nowrap">
                          {timeOfDay(klass.startsAt, siteTimezone)}
                        </TD>
                        <TD className="font-medium">{klass.name}</TD>
                        {bookableSites.length > 1 && (
                          <TD className="text-ink-muted">{siteNames.get(klass.siteId)}</TD>
                        )}
                        <TD align="right">
                          {free > 0 ? (
                            <span className="tabular-nums">
                              {integer(free, locale)} free
                            </span>
                          ) : (
                            <Badge tone="warn">
                              Full{count.waitlisted > 0 ? ` · ${count.waitlisted} waiting` : ''}
                            </Badge>
                          )}
                        </TD>
                        <TD align="right">
                          {booking !== undefined ? (
                            <BookButton
                              classId={klass.id}
                              memberId={member.id}
                              bookingId={booking.id}
                              state={booking.status === 'waitlisted' ? 'waitlisted' : 'booked'}
                              position={booking.position}
                              disabled={!canBook}
                            />
                          ) : (
                            <BookButton
                              classId={klass.id}
                              memberId={member.id}
                              bookingId={null}
                              state={free > 0 ? 'free' : 'full'}
                              position={null}
                              disabled={!canBook}
                            />
                          )}
                        </TD>
                      </TR>
                    );
                  })}
                </tbody>
              </Table>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
