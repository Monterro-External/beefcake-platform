// spec: specs/calendar-file.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect, recordEvidence } from '../evidence';
import {
  book,
  cancel,
  classRow,
  downloadCalendarFile,
  eventsFor,
  findPromotionSetup,
  joinWaitlist,
  openSchedule,
  runPromotion,
} from './calendar-file';

test.use(recordEvidence);

test.describe('Calendar file of a member\'s booked classes', { tag: ['@acceptance', '@booking', '@BCPLA-10'] }, () => {
  test.setTimeout(120_000);

  test('AS-6 After promotion, the next calendar file holds the promoted class and marks the released fallback booking cancelled', { tag: '@edge' }, async ({
    page,
    context,
  }) => {
    // Oskar is `waiting`; `other` takes the last place on Spinning 45 and later gives it back.
    const { waiting, other, full, fallback } = findPromotionSetup();

    const first = await test.step('Given Oskar has downloaded his calendar file with his fallback booking on Core at 18:15 at Solna', async () => {
      await openSchedule(page, context, waiting);
      await book(page, fallback);
      const file = await downloadCalendarFile(page);
      expect(eventsFor(file, fallback).map((event) => event.status)).toEqual(['CONFIRMED']);
      return file;
    });

    await test.step('And Oskar is on the waitlist for Spinning 45 at 18:00 at Solna', async () => {
      // Another member takes the last place, so the class is full with nobody waiting.
      await openSchedule(page, context, other);
      await book(page, full);
      await openSchedule(page, context, waiting);
      await joinWaitlist(page, full);
      await expect(classRow(page, full).getByText('Waiting #1')).toBeVisible();
    });

    await test.step('When promotion moves Oskar onto Spinning 45', async () => {
      await openSchedule(page, context, other);
      await cancel(page, full);
      runPromotion(waiting.tenantId);
      await openSchedule(page, context, waiting);
      await expect(classRow(page, full).getByText('Booked', { exact: true })).toBeVisible();
    });

    const second = await test.step('And Oskar downloads his calendar file again', async () => {
      return downloadCalendarFile(page);
    });

    await test.step('Then the calendar file holds Spinning 45', async () => {
      expect(eventsFor(second, full).map((event) => event.status)).toEqual(['CONFIRMED']);
    });

    await test.step('And it holds Core as a cancelled event', async () => {
      const events = eventsFor(second, fallback);
      expect(events.map((event) => event.status)).toEqual(['CANCELLED']);
      // The same event as in the first file, so the calendar cancels it rather than adding one.
      expect(events[0]?.uid).toBe(eventsFor(first, fallback)[0]?.uid);
    });
  });
});
