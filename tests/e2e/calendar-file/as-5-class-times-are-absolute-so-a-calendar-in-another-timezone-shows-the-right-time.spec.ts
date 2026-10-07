// spec: specs/calendar-file.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect, recordEvidence } from '../evidence';
import {
  book,
  downloadCalendarFile,
  eventsFor,
  freePlaces,
  heldClassIds,
  memberLogins,
  openSchedule,
  upcomingClasses,
  wallClock,
} from './calendar-file';

test.use(recordEvidence);

test.describe('Calendar file of a member\'s booked classes', { tag: ['@acceptance', '@booking', '@BCPLA-10'] }, () => {
  test.setTimeout(90_000);

  test('AS-5 Class times are absolute, so a calendar in another timezone shows the right time', { tag: '@edge' }, async ({
    page,
    context,
  }) => {
    const { klass } = await test.step('Given a member at Kuntoklubi Kallio is booked on a class at 18:00 Helsinki time', async () => {
      const found = memberLogins('Kuntoklubi Kallio')
        .map((login) => {
          const held = heldClassIds(login.memberId);
          const at18 = upcomingClasses(login).find(
            (candidate) =>
              !held.has(candidate.id) &&
              freePlaces(candidate) > 0 &&
              wallClock(candidate.startsAt, 'Europe/Helsinki') === '18:00',
          );
          return at18 === undefined ? null : { member: login, klass: at18 };
        })
        .find((pair) => pair !== null);
      if (found === undefined || found === null) throw new Error('No class at 18:00 Helsinki time to book at Kuntoklubi Kallio');
      await openSchedule(page, context, found.member);
      await book(page, found.klass);
      return found;
    });

    const file = await test.step('When the member downloads their calendar file', async () => {
      return downloadCalendarFile(page);
    });

    await test.step('Then the event starts at 18:00 Helsinki time, which is 17:00 Stockholm time', async () => {
      const [event] = eventsFor(file, klass);
      expect(event).toBeDefined();
      // The file says when in absolute time; each calendar shows it in its own zone.
      expect(file.text).toMatch(/\r\nDTSTART:\d{8}T\d{6}Z\r\n/);
      expect(wallClock(event?.startsAt ?? '', 'Europe/Helsinki')).toBe('18:00');
      expect(wallClock(event?.startsAt ?? '', 'Europe/Stockholm')).toBe('17:00');
    });
  });
});
