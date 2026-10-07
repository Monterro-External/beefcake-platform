/**
 * The calendar file: a member's upcoming booked classes, for their own calendar
 * app. See "Calendar file" in docs/domain-glossary.md.
 *
 * A snapshot at the instant of download, not a feed. Times are absolute
 * instants (UTC), so the member's calendar shows each class at the right moment
 * whatever timezone it runs in; the site's timezone already decided the instant
 * when the class was put on the timetable.
 *
 * Pure: the bookings and the instant of download come in, the file goes out.
 */

export type CalendarBookingStatus = 'booked' | 'waitlisted' | 'cancelled' | 'attended' | 'no_show';

/** One of the member's bookings with what the file needs of its class and site. */
export interface CalendarBooking {
  readonly bookingId: string;
  readonly status: CalendarBookingStatus;
  readonly className: string;
  /** ISO-8601 instants. */
  readonly startsAt: string;
  readonly endsAt: string;
  /** The tenant called the class off. */
  readonly classCancelled: boolean;
  readonly instructorName: string | null;
  readonly site: {
    readonly name: string;
    readonly addressLine: string | null;
    readonly city: string | null;
  };
}

export interface CalendarEvent {
  /** Derived from the booking, so every download gives the booking the same event. */
  readonly uid: string;
  readonly status: 'confirmed';
  readonly summary: string;
  readonly location: string;
  /** The instructor; empty when the class has none. */
  readonly description: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export interface CalendarFile {
  readonly nothingToSend: false;
  readonly events: readonly CalendarEvent[];
  /** The iCalendar (RFC 5545) text: what the member downloads. */
  readonly text: string;
}

/**
 * No entry to send: the schedule says "You have no upcoming booked classes."
 * and no file is written, so an empty one can never be served.
 */
export interface NothingToSend {
  readonly nothingToSend: true;
  readonly events: readonly [];
}

export function calendarFile(bookings: readonly CalendarBooking[], now: Date): CalendarFile | NothingToSend {
  const events = bookings
    .filter((booking) => !hasStarted(booking, now) && isEntry(booking))
    .map(toEvent)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  if (events.length === 0) return { nothingToSend: true, events: [] };
  return { nothingToSend: false, events, text: toICalendar(events, now) };
}

/** A class starting at the instant of download has started. */
function hasStarted(booking: CalendarBooking, now: Date): boolean {
  return new Date(booking.startsAt).getTime() <= now.getTime();
}

/** A place in a class that runs. */
function isEntry(booking: CalendarBooking): boolean {
  return booking.status === 'booked' && !booking.classCancelled;
}

function toEvent(booking: CalendarBooking): CalendarEvent {
  const { site } = booking;
  return {
    uid: `${booking.bookingId}@beefcake`,
    status: 'confirmed',
    summary: booking.className,
    location: [site.name, site.addressLine, site.city]
      .filter((part) => part !== null && part !== '')
      .join(', '),
    description: booking.instructorName ?? '',
    startsAt: new Date(booking.startsAt),
    endsAt: new Date(booking.endsAt),
  };
}

// ---------------------------------------------------------------------------
// iCalendar (RFC 5545), written by hand: a handful of properties is all we send.
// ---------------------------------------------------------------------------

function toICalendar(events: readonly CalendarEvent[], now: Date): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Beefcake//Calendar file//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...events.flatMap((event) => [
      'BEGIN:VEVENT',
      `UID:${text(event.uid)}`,
      `DTSTAMP:${utc(now)}`,
      `DTSTART:${utc(event.startsAt)}`,
      `DTEND:${utc(event.endsAt)}`,
      `SUMMARY:${text(event.summary)}`,
      `LOCATION:${text(event.location)}`,
      `DESCRIPTION:${text(event.description)}`,
      `STATUS:${event.status.toUpperCase()}`,
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ];
  return lines.map((line) => `${fold(line)}\r\n`).join('');
}

const utf8 = new TextEncoder();

/**
 * Lines longer than 75 octets continue on the next line after a space. Counted
 * in UTF-8 octets, never splitting a character: Swedish and Finnish class names
 * are full of them.
 */
function fold(line: string): string {
  const parts: string[] = [];
  let current = '';
  let octets = 0;
  for (const char of line) {
    const size = utf8.encode(char).length;
    // Continuation lines start with a space, which counts towards their 75.
    const limit = parts.length === 0 ? 75 : 74;
    if (octets + size > limit) {
      parts.push(current);
      current = '';
      octets = 0;
    }
    current += char;
    octets += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/** An absolute instant in UTC: `20261025T170000Z`. */
function utc(at: Date): string {
  return at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/** A TEXT value, escaped. */
function text(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
