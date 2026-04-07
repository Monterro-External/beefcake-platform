/**
 * The class roster.
 *
 * Printed at the front desk before the class and used to mark attendance after
 * it. The waitlist is shown in order, because the first question when somebody
 * cancels is "who is next".
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq, inArray } from 'drizzle-orm';
import {
  Badge,
  Callout,
  Card,
  DefinitionList,
  EmptyState,
  PageHeader,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@/components/ui';
import { RosterActions } from './roster-actions';
import { activeTenant, can, getSession, tenantScopeFor } from '@/lib/session';
import { clock } from '@/lib/clock';
import { date as formatDate, humanise, instant, integer, percent, timeOfDay } from '@/lib/format';
import * as classesRepo from '@/db/repositories/classes';
import * as tenantsRepo from '@/db/repositories/tenants';
import { bookings as bookingsTable, members, users } from '@/db/schema';
import { guard } from '@/db/repositories/scope';
import { freeSpots, overlaps, waitlist } from '@/domain/waitlist';
import { localDay } from '@/domain/dates';
import { timezoneForCountry } from '@/jobs/runner';

export const dynamic = 'force-dynamic';

export default async function ClassPage({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const session = await getSession();
  const tenant = activeTenant(session);
  if (tenant === null) return null;

  const scope = tenantScopeFor(session);
  const time = clock();
  const locale = tenant.locale;

  const klass = classesRepo.getClass(scope, classId);
  if (klass === null) notFound();

  const sites = tenantsRepo.listSites(scope);
  const site = sites.find((candidate) => candidate.id === klass.siteId);
  const timezone = site?.timezone ?? timezoneForCountry(tenant.country);

  const bookingRows = classesRepo.listBookings(scope, klass.id);
  const snapshots = bookingRows.map(classesRepo.toBookingSnapshot);
  const memberRows =
    bookingRows.length === 0
      ? []
      : guard(
          scope,
          'members',
          scope.db
            .select()
            .from(members)
            .where(
              and(
                eq(members.tenantId, scope.tenantId),
                inArray(
                  members.id,
                  bookingRows.map((booking) => booking.memberId),
                ),
              ),
            )
            .all(),
        );
  const memberById = new Map(memberRows.map((member) => [member.id, member]));

  const instructor =
    klass.instructorId === null
      ? null
      : (scope.db
          .select()
          .from(users)
          .where(and(eq(users.tenantId, scope.tenantId), eq(users.id, klass.instructorId)))
          .get() ?? null);

  const snapshot = classesRepo.toClassSnapshot(klass);
  const spots = freeSpots(snapshot, snapshots);
  const queue = waitlist(snapshots);
  const attending = bookingRows.filter(
    (booking) => booking.status === 'booked' || booking.status === 'attended',
  );
  const inThePast = klass.startsAt < time.now.toISOString();

  // Other classes at this site that clash with this one. A member holding one of
  // these and sitting on this waitlist has it released when they are promoted.
  const sameDay = classesRepo.listClasses(scope, {
    siteId: klass.siteId,
    from: new Date(new Date(klass.startsAt).getTime() - 86_400_000).toISOString(),
    to: new Date(new Date(klass.endsAt).getTime() + 86_400_000).toISOString(),
  });
  const clashing = sameDay.filter(
    (other) => other.id !== klass.id && overlaps(snapshot, classesRepo.toClassSnapshot(other)),
  );

  const clashingBookings =
    queue.length === 0 || clashing.length === 0
      ? []
      : guard(
          scope,
          'bookings',
          scope.db
            .select()
            .from(bookingsTable)
            .where(
              and(
                eq(bookingsTable.tenantId, scope.tenantId),
                inArray(
                  bookingsTable.classId,
                  clashing.map((other) => other.id),
                ),
                inArray(
                  bookingsTable.memberId,
                  queue.map((booking) => booking.memberId),
                ),
                inArray(bookingsTable.status, ['booked', 'waitlisted']),
              ),
            )
            .all(),
        );
  const clashByMember = new Map<string, string[]>();
  const clashingNames = new Map(clashing.map((other) => [other.id, other.name]));
  for (const booking of clashingBookings) {
    const list = clashByMember.get(booking.memberId) ?? [];
    list.push(clashingNames.get(booking.classId) ?? booking.classId);
    clashByMember.set(booking.memberId, list);
  }

  const editable = can(session, 'classes.write');

  return (
    <>
      <PageHeader
        title={klass.name}
        subtitle={
          <>
            {site?.name} · {formatDate(localDay(new Date(klass.startsAt), timezone), locale)} ·{' '}
            {timeOfDay(klass.startsAt, timezone)}-{timeOfDay(klass.endsAt, timezone)}
            {instructor !== null && <> · {instructor.name}</>}
          </>
        }
        actions={
          <>
            {klass.cancelled && <Badge tone="bad">Cancelled</Badge>}
            <Link href={`/app/classes?day=${localDay(new Date(klass.startsAt), timezone)}&site=${klass.siteId}`} className="text-accent">
              Back to schedule
            </Link>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-4">
        <Card title="Class">
          <DefinitionList
            items={[
              { label: 'Capacity', value: integer(klass.capacity, locale) },
              { label: 'Booked', value: integer(attending.length, locale) },
              { label: 'Free spots', value: integer(spots, locale) },
              { label: 'Waitlist', value: integer(queue.length, locale) },
              {
                label: 'Fill',
                value: percent(klass.capacity === 0 ? 0 : attending.length / klass.capacity, 0, locale),
              },
            ]}
          />
        </Card>

        <Card title="Roster" className="lg:col-span-3">
          {bookingRows.length === 0 ? (
            <EmptyState title="Nobody booked" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Member</TH>
                  <TH>Status</TH>
                  <TH>Booked</TH>
                  {editable && !klass.cancelled && <TH align="right">Attendance</TH>}
                </TR>
              </THead>
              <tbody>
                {bookingRows
                  .filter((booking) => booking.status !== 'waitlisted')
                  .map((booking) => {
                    const member = memberById.get(booking.memberId);
                    return (
                      <TR key={booking.id}>
                        <TD>
                          <Link href={`/app/members/${booking.memberId}`} className="text-accent">
                            {member?.name ?? booking.memberId}
                          </Link>
                        </TD>
                        <TD>
                          <Badge
                            tone={
                              booking.status === 'attended'
                                ? 'good'
                                : booking.status === 'no_show'
                                  ? 'bad'
                                  : booking.status === 'cancelled'
                                    ? 'neutral'
                                    : 'info'
                            }
                          >
                            {humanise(booking.status)}
                          </Badge>
                        </TD>
                        <TD className="whitespace-nowrap text-ink-muted">
                          {instant(booking.createdAt, timezone, locale)}
                        </TD>
                        {editable && !klass.cancelled && (
                          <TD align="right">
                            {booking.status === 'booked' || booking.status === 'attended' || booking.status === 'no_show' ? (
                              <RosterActions
                                bookingId={booking.id}
                                status={booking.status}
                                inThePast={inThePast}
                              />
                            ) : null}
                          </TD>
                        )}
                      </TR>
                    );
                  })}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card title={`Waitlist (${queue.length})`}>
          {queue.length === 0 ? (
            <EmptyState title="Nobody waiting" hint="Promotion runs automatically when a spot frees up." />
          ) : (
            <>
              {spots > 0 && (
                <div className="mb-3">
                  <Callout tone="warn" title={`${spots} free spot(s) with people waiting`}>
                    The promotion job will move the top of the queue in when it next runs. Run it now
                    with <code>npm run jobs:waitlist-promote</code>.
                  </Callout>
                </div>
              )}
              <Table>
                <THead>
                  <TR>
                    <TH align="right">#</TH>
                    <TH>Member</TH>
                    <TH>Joined queue</TH>
                    <TH>Holding instead</TH>
                  </TR>
                </THead>
                <tbody>
                  {queue.map((booking) => {
                    const member = memberById.get(booking.memberId);
                    const held = clashByMember.get(booking.memberId) ?? [];
                    return (
                      <TR key={booking.id}>
                        <TD align="right" mono>
                          {booking.position}
                        </TD>
                        <TD>
                          <Link href={`/app/members/${booking.memberId}`} className="text-accent">
                            {member?.name ?? booking.memberId}
                          </Link>
                        </TD>
                        <TD className="whitespace-nowrap text-ink-muted">
                          {instant(booking.createdAt, timezone, locale)}
                        </TD>
                        <TD>
                          {held.length === 0 ? (
                            <span className="text-ink-muted">-</span>
                          ) : (
                            <span title="Released when this member is promoted">{held.join(', ')}</span>
                          )}
                        </TD>
                      </TR>
                    );
                  })}
                </tbody>
              </Table>
              <p className="mt-3 text-ink-muted">
                A member holding a clashing class is holding it as a fallback. Promotion releases it,
                which is what stops the other class reading as full when it is not.
              </p>
            </>
          )}
        </Card>
      </div>

      {klass.cancelled && (
        <div className="mt-4">
          <Callout tone="bad" title="This class was cancelled">
            Everyone booked was notified. Check the notification log under Settings.
          </Callout>
        </div>
      )}
    </>
  );
}
