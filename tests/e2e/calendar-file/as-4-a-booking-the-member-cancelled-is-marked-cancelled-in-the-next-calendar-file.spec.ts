// spec: specs/calendar-file.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect, recordEvidence } from '../evidence';
import {
  book,
  cancel,
  downloadCalendarFile,
  eventsFor,
  freePlaces,
  heldClassIds,
  memberNamed,
  openSchedule,
  upcomingClasses,
} from './calendar-file';

test.use(recordEvidence);

test.describe('Calendar file of a member\'s booked classes', { tag: ['@acceptance', '@booking', '@BCPLA-10'] }, () => {
  test.setTimeout(90_000);

  test('AS-4 A booking the member cancelled is marked cancelled in the next calendar file', { tag: '@edge' }, async ({
    page,
    context,
  }) => {
    // The seed's Oskar trains at Täby; Elin Sandberg books at Solna, so she plays Oskar here.
    const oskar = memberNamed('Puls Träning', 'Elin Sandberg');

    const { yoga, first } = await test.step('Given Oskar has downloaded his calendar file with his booking on Yoga Flow at Solna', async () => {
      const held = heldClassIds(oskar.memberId);
      const klass = upcomingClasses(oskar)
        .filter((candidate) => !held.has(candidate.id) && freePlaces(candidate) > 0)
        .sort((a, b) => Number(b.name === 'Yoga Flow') - Number(a.name === 'Yoga Flow'))[0];
      if (klass === undefined) throw new Error('No Solna class with a place left for Oskar');
      await openSchedule(page, context, oskar);
      await book(page, klass);
      const file = await downloadCalendarFile(page);
      expect(eventsFor(file, klass).map((event) => event.status)).toEqual(['CONFIRMED']);
      return { yoga: klass, first: file };
    });

    await test.step('When Oskar cancels his booking on Yoga Flow', async () => {
      await cancel(page, yoga);
    });

    const second = await test.step('And Oskar downloads his calendar file again', async () => {
      return downloadCalendarFile(page);
    });

    await test.step('Then the calendar file holds Yoga Flow as a cancelled event', async () => {
      expect(eventsFor(second, yoga).map((event) => event.status)).toEqual(['CANCELLED']);
    });

    await test.step('And that event has the same identity as in the first file', async () => {
      expect(eventsFor(second, yoga)[0]?.uid).toBe(eventsFor(first, yoga)[0]?.uid);
    });
  });
});
