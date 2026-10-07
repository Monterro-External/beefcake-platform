/**
 * The calendar file download: the signed-in member's upcoming booked classes.
 *
 * A route handler rather than a server action, because the answer is a file
 * the browser should download, as with the report export. Whose bookings come
 * from the session alone; the request carries no member id.
 */

import { NextResponse } from 'next/server';
import * as classesRepo from '@/db/repositories/classes';
import { calendarFile } from '@/domain/calendar-file';
import { clock } from '@/lib/clock';
import { getSession, tenantScopeFor } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  const member = session.member;
  if (member === null || session.tenant === null) {
    return NextResponse.json({ error: 'Not signed in as a member' }, { status: 403 });
  }

  const scope = tenantScopeFor(session);
  const now = clock().now;
  const file = calendarFile(classesRepo.calendarBookings(scope, member.id, now.toISOString()), now);

  return new NextResponse(file.text, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'attachment; filename="booked-classes.ics"',
      'cache-control': 'no-store',
    },
  });
}
