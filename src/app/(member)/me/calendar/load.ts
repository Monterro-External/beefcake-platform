/**
 * The member's calendar file at `now`: the one loader behind both the download
 * and the schedule's decision to offer it, so the button never leads to no file.
 * Which bookings become events is the domain's rule (`calendarFile`).
 */

import * as classesRepo from '@/db/repositories/classes';
import type { TenantScope } from '@/db/repositories/scope';
import { type CalendarFile, type NothingToSend, calendarFile } from '@/domain/calendar-file';

export function loadCalendarFile(scope: TenantScope, memberId: string, now: Date): CalendarFile | NothingToSend {
  return calendarFile(classesRepo.calendarBookings(scope, memberId, now.toISOString()), now);
}
