import { describe, expect, it } from 'vitest';
import { type CalendarBooking, type CalendarFile, type NothingToSend, calendarFile } from '@/domain/calendar-file';
import { type PlainDate, type Timezone, atLocalTime } from '@/domain/dates';

const solna = {
  name: 'Solna',
  addressLine: 'Hamngatan 37',
  city: 'Solna',
};

// Download at 10:00 Stockholm time on 26 August 2026.
const downloadedAt = new Date('2026-08-26T08:00:00.000Z');

function booking(over: Partial<CalendarBooking> = {}): CalendarBooking {
  return {
    bookingId: 'bkg_0000001',
    status: 'booked',
    className: 'Yoga Flow',
    startsAt: '2026-08-27T16:00:00.000Z',
    endsAt: '2026-08-27T17:00:00.000Z',
    classCancelled: false,
    instructorName: 'Maja Lind',
    site: solna,
    updatedAt: '2026-08-20T09:30:00.000Z',
    ...over,
  };
}

/** The downloaded text; a test that reads it expects something to send. */
function textOf(file: CalendarFile | NothingToSend): string {
  if (file.nothingToSend) throw new Error('Expected a calendar file, got nothing to send');
  return file.text;
}

describe('which bookings are in the calendar file', () => {
  it('a booked class that has not started becomes an event with name, site, address, start, end and instructor', () => {
    const file = calendarFile([booking()], downloadedAt);

    expect(file.events).toEqual([
      {
        uid: 'bkg_0000001@beefcake',
        status: 'confirmed',
        summary: 'Yoga Flow',
        location: 'Solna, Hamngatan 37, Solna',
        description: 'Maja Lind',
        startsAt: new Date('2026-08-27T16:00:00.000Z'),
        endsAt: new Date('2026-08-27T17:00:00.000Z'),
        lastModified: new Date('2026-08-20T09:30:00.000Z'),
        sequence: 209381400,
      },
    ]);
  });

  it('a class the member is only waitlisted on is left out', () => {
    const file = calendarFile(
      [booking({ bookingId: 'bkg_waiting', status: 'waitlisted' }), booking({ bookingId: 'bkg_core' })],
      downloadedAt,
    );

    expect(file.events.map((event) => event.uid)).toEqual(['bkg_core@beefcake']);
  });

  it('a class that has already started is left out', () => {
    const file = calendarFile(
      [
        booking({
          bookingId: 'bkg_running',
          startsAt: '2026-08-26T07:30:00.000Z',
          endsAt: '2026-08-26T08:30:00.000Z',
        }),
      ],
      downloadedAt,
    );

    expect(file.events).toEqual([]);
  });

  it('a class starting at the very instant of download has started and is left out', () => {
    const file = calendarFile(
      [
        booking({
          startsAt: '2026-08-26T08:00:00.000Z',
          endsAt: '2026-08-26T09:00:00.000Z',
        }),
      ],
      downloadedAt,
    );

    expect(file.events).toEqual([]);
  });

  it('a class about to start, a minute after download, is still in the file', () => {
    const file = calendarFile(
      [
        booking({
          startsAt: '2026-08-26T08:01:00.000Z',
          endsAt: '2026-08-26T09:00:00.000Z',
        }),
      ],
      downloadedAt,
    );

    expect(file.events.map((event) => event.startsAt)).toEqual([new Date('2026-08-26T08:01:00.000Z')]);
  });

  it('a member with nothing booked has nothing to send, so no file is written', () => {
    const file = calendarFile([], downloadedAt);

    expect(file.nothingToSend).toBe(true);
    expect(file.events).toEqual([]);
    expect('text' in file).toBe(false);
  });

  it('a member whose only bookings are waitlisted or have started has nothing to send', () => {
    const file = calendarFile(
      [
        booking({ bookingId: 'bkg_waiting', status: 'waitlisted' }),
        booking({
          bookingId: 'bkg_started',
          startsAt: '2026-08-26T07:30:00.000Z',
          endsAt: '2026-08-26T08:15:00.000Z',
        }),
      ],
      downloadedAt,
    );

    expect(file.nothingToSend).toBe(true);
  });

  it('a member with one booked class that has not started has something to send', () => {
    expect(calendarFile([booking()], downloadedAt).nothingToSend).toBe(false);
  });

  it('a booking on a class the tenant cancelled becomes a cancelled event', () => {
    const file = calendarFile([booking({ bookingId: 'bkg_called_off', classCancelled: true })], downloadedAt);

    expect(file.events.map((event) => [event.uid, event.status])).toEqual([['bkg_called_off@beefcake', 'cancelled']]);
  });

  it('a booking the member cancelled on a class that has not started becomes a cancelled event', () => {
    const file = calendarFile([booking({ bookingId: 'bkg_cancelled', status: 'cancelled' })], downloadedAt);

    expect(file.events.map((event) => [event.uid, event.status])).toEqual([['bkg_cancelled@beefcake', 'cancelled']]);
  });

  it('a fallback booking promotion released becomes a cancelled event next to the promoted class', () => {
    const file = calendarFile(
      [
        booking({ bookingId: 'bkg_spinning', className: 'Spinning 45', status: 'booked' }),
        booking({
          bookingId: 'bkg_core',
          className: 'Core',
          status: 'cancelled',
          startsAt: '2026-08-27T16:15:00.000Z',
          endsAt: '2026-08-27T17:00:00.000Z',
        }),
      ],
      downloadedAt,
    );

    expect(file.events.map((event) => [event.summary, event.status])).toEqual([
      ['Spinning 45', 'confirmed'],
      ['Core', 'cancelled'],
    ]);
  });

  it('a cancelled booking on a class that has started is left out', () => {
    const file = calendarFile(
      [
        booking({
          status: 'cancelled',
          startsAt: '2026-08-26T07:30:00.000Z',
          endsAt: '2026-08-26T08:30:00.000Z',
        }),
        booking({
          bookingId: 'bkg_called_off_started',
          classCancelled: true,
          startsAt: '2026-08-26T07:00:00.000Z',
          endsAt: '2026-08-26T07:45:00.000Z',
        }),
      ],
      downloadedAt,
    );

    expect(file.nothingToSend).toBe(true);
  });

  it('a waitlisted place on a cancelled class is left out, as it was never in the calendar', () => {
    const file = calendarFile([booking({ status: 'waitlisted', classCancelled: true })], downloadedAt);

    expect(file.nothingToSend).toBe(true);
  });

  it('a member whose only entries are cancelled still has something to send', () => {
    const file = calendarFile(
      [booking({ status: 'cancelled' }), booking({ bookingId: 'bkg_called_off', classCancelled: true })],
      downloadedAt,
    );

    expect(file.nothingToSend).toBe(false);
    expect(textOf(file).match(/\r\nSTATUS:CANCELLED\r\n/g)).toHaveLength(2);
  });

  it('events come in the order the classes start', () => {
    const file = calendarFile(
      [
        booking({
          bookingId: 'bkg_late',
          startsAt: '2026-08-28T16:00:00.000Z',
          endsAt: '2026-08-28T17:00:00.000Z',
        }),
        booking({
          bookingId: 'bkg_early',
          startsAt: '2026-08-27T05:00:00.000Z',
          endsAt: '2026-08-27T05:45:00.000Z',
        }),
      ],
      downloadedAt,
    );

    expect(file.events.map((event) => event.uid)).toEqual(['bkg_early@beefcake', 'bkg_late@beefcake']);
  });
});

describe('what an event says', () => {
  it('a class without an instructor gets an empty description', () => {
    const file = calendarFile([booking({ instructorName: null })], downloadedAt);

    expect(file.events[0]?.description).toBe('');
  });

  it('a site without a stored address is located by its name alone', () => {
    const file = calendarFile(
      [booking({ site: { name: 'Solna', addressLine: null, city: null } })],
      downloadedAt,
    );

    expect(file.events[0]?.location).toBe('Solna');
  });

  it('the same booking keeps the same identity in every download', () => {
    const first = calendarFile([booking({ bookingId: 'bkg_0000042' })], downloadedAt);
    const second = calendarFile(
      [booking({ bookingId: 'bkg_0000042' }), booking({ bookingId: 'bkg_0000043' })],
      new Date('2026-08-27T06:00:00.000Z'),
    );

    expect(second.events.find((event) => event.uid === first.events[0]?.uid)).toBeDefined();
    expect(new Set(second.events.map((event) => event.uid)).size).toBe(2);
  });

  it('a booking keeps its identity when it is cancelled, so a re-import cancels the event instead of adding one', () => {
    const first = calendarFile([booking({ bookingId: 'bkg_0000042' })], downloadedAt);
    const second = calendarFile(
      [booking({ bookingId: 'bkg_0000042', status: 'cancelled', updatedAt: '2026-08-26T09:00:00.000Z' })],
      new Date('2026-08-26T09:05:00.000Z'),
    );

    expect(second.events.map((event) => [event.uid, event.status])).toEqual([['bkg_0000042@beefcake', 'cancelled']]);
    expect(second.events[0]?.uid).toBe(first.events[0]?.uid);
  });
});

describe('the file a calendar app imports', () => {
  it('is an iCalendar file with one event per booked class, stamped with the instant of download and the last change to the booking', () => {
    const file = calendarFile([booking()], downloadedAt);

    expect(textOf(file)).toBe(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Beefcake//Calendar file//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        'UID:bkg_0000001@beefcake',
        'DTSTAMP:20260826T080000Z',
        'DTSTART:20260827T160000Z',
        'DTEND:20260827T170000Z',
        'LAST-MODIFIED:20260820T093000Z',
        'SEQUENCE:209381400',
        'SUMMARY:Yoga Flow',
        'LOCATION:Solna\\, Hamngatan 37\\, Solna',
        'DESCRIPTION:Maja Lind',
        'STATUS:CONFIRMED',
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
    );
  });

  function lineOf(file: CalendarFile | NothingToSend, uid: string, property: string): string | undefined {
    const event = textOf(file).split('BEGIN:VEVENT').find((block) => block.includes(`UID:${uid}\r\n`));
    return event?.split('\r\n').find((line) => line.startsWith(`${property}:`));
  }

  function sequenceOf(file: CalendarFile | NothingToSend, uid = 'bkg_0000001@beefcake'): number {
    return Number(lineOf(file, uid, 'SEQUENCE')?.slice('SEQUENCE:'.length));
  }

  it('a cancelled event says when the booking was cancelled', () => {
    const file = calendarFile(
      [booking({ status: 'cancelled', updatedAt: '2026-08-25T18:45:10.250Z' })],
      downloadedAt,
    );

    expect(lineOf(file, 'bkg_0000001@beefcake', 'STATUS')).toBe('STATUS:CANCELLED');
    expect(lineOf(file, 'bkg_0000001@beefcake', 'LAST-MODIFIED')).toBe('LAST-MODIFIED:20260825T184510Z');
  });

  it('an unchanged booking has the same sequence in every download, whenever it is downloaded', () => {
    const first = calendarFile([booking()], downloadedAt);
    const second = calendarFile([booking()], new Date('2026-08-27T06:00:00.000Z'));

    expect(sequenceOf(second)).toBe(sequenceOf(first));
  });

  it('cancelling and then rebooking raise the sequence each time, so Apple Calendar and Outlook apply the update', () => {
    const booked = calendarFile([booking({ updatedAt: '2026-08-20T09:30:00.000Z' })], downloadedAt);
    const cancelled = calendarFile(
      [booking({ status: 'cancelled', updatedAt: '2026-08-20T09:30:01.000Z' })],
      downloadedAt,
    );
    const rebooked = calendarFile([booking({ updatedAt: '2026-08-25T07:00:00.000Z' })], downloadedAt);

    expect(sequenceOf(cancelled)).toBeGreaterThan(sequenceOf(booked));
    expect(sequenceOf(rebooked)).toBeGreaterThan(sequenceOf(cancelled));
  });

  it('a class the tenant cancels raises the sequence, although the booking itself did not change', () => {
    const before = calendarFile([booking()], downloadedAt);
    const after = calendarFile([booking({ classCancelled: true })], downloadedAt);

    expect(sequenceOf(after)).toBeGreaterThan(sequenceOf(before));
  });

  function startLineFor(day: PlainDate, timezone: Timezone, hour: number, minute = 0): string | undefined {
    const startsAt = atLocalTime(day, timezone, hour, minute);
    const endsAt = new Date(startsAt.getTime() + 45 * 60_000);
    const file = calendarFile(
      [booking({ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() })],
      downloadedAt,
    );
    return textOf(file).split('\r\n').find((line) => line.startsWith('DTSTART'));
  }

  it.each([
    ['Europe/Stockholm', 'DTSTART:20260827T160000Z'],
    ['Europe/Oslo', 'DTSTART:20260827T160000Z'],
    ['Europe/Copenhagen', 'DTSTART:20260827T160000Z'],
    ['Europe/Helsinki', 'DTSTART:20260827T150000Z'],
  ] as const)('a class at 18:00 in %s is written as an absolute instant, %s', (timezone, expected) => {
    expect(startLineFor('2026-08-27' as PlainDate, timezone, 18)).toBe(expected);
  });

  it('a class at 18:00 Helsinki time is 17:00 on a calendar running on Stockholm time', () => {
    const line = startLineFor('2026-08-27' as PlainDate, 'Europe/Helsinki', 18);
    const instant = new Date(
      (line ?? '').replace(/^DTSTART:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'),
    );
    const shownIn = (timeZone: string) =>
      new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }).format(instant);

    expect(shownIn('Europe/Helsinki')).toBe('18:00');
    expect(shownIn('Europe/Stockholm')).toBe('17:00');
  });

  it('a class at 18:00 on the daylight saving changeover, 25 October 2026, keeps its local start time', () => {
    // Summer time ends at 03:00 that morning: 18:00 is UTC+1 that evening, UTC+2 the evening before.
    expect(startLineFor('2026-10-24' as PlainDate, 'Europe/Stockholm', 18)).toBe('DTSTART:20261024T160000Z');
    expect(startLineFor('2026-10-25' as PlainDate, 'Europe/Stockholm', 18)).toBe('DTSTART:20261025T170000Z');
    expect(startLineFor('2026-10-25' as PlainDate, 'Europe/Helsinki', 18)).toBe('DTSTART:20261025T160000Z');
  });

  it('a class just after midnight on the first of the month is written on the last day of the previous month in UTC', () => {
    expect(startLineFor('2026-09-01' as PlainDate, 'Europe/Helsinki', 0, 30)).toBe(
      'DTSTART:20260831T213000Z',
    );
  });

  it('a class on a leap day is written on 29 February', () => {
    expect(startLineFor('2028-02-29' as PlainDate, 'Europe/Copenhagen', 18)).toBe('DTSTART:20280229T170000Z');
    expect(startLineFor('2028-03-01' as PlainDate, 'Europe/Oslo', 0, 15)).toBe('DTSTART:20280229T231500Z');
  });

  it('commas, semicolons, backslashes and line breaks in text are escaped', () => {
    const file = calendarFile(
      [booking({ className: 'Rygg; Nacke\\Core', instructorName: 'Anna, Bo\nCecilia' })],
      downloadedAt,
    );

    expect(textOf(file)).toContain('SUMMARY:Rygg\\; Nacke\\\\Core\r\n');
    expect(textOf(file)).toContain('DESCRIPTION:Anna\\, Bo\\nCecilia\r\n');
  });

  it('a line longer than 75 octets is folded without splitting a character', () => {
    const file = calendarFile(
      [
        booking({
          className: 'Löpteknik för nybörjare och återkommande löpare med fokus på hållning och steg',
        }),
      ],
      downloadedAt,
    );
    const lines = textOf(file).split('\r\n');
    const summary = lines.findIndex((line) => line.startsWith('SUMMARY:'));

    for (const line of lines) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    expect(lines[summary + 1]?.startsWith(' ')).toBe(true);
    expect(textOf(file).replace(/\r\n /g, '')).toContain(
      'SUMMARY:Löpteknik för nybörjare och återkommande löpare med fokus på hållning och steg\r\n',
    );
  });
});
