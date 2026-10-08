// spec: specs/calendar-file.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect, recordEvidence } from '../evidence';
import {
  book,
  bookingStatus,
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

  test('AS-3 A waitlisted class stays out of the calendar file, and promotion still releases the fallback booking', { tag: '@regression' }, async ({
    page,
    context,
  }) => {
    const { waiting, other, full, fallback } = findPromotionSetup();

    await test.step('Given Oskar is on the waitlist for Spinning 45 at 18:00 at Solna', async () => {
      // Another member takes the last place, so the class is full with nobody waiting.
      await openSchedule(page, context, other);
      await book(page, full);
      await openSchedule(page, context, waiting);
      await joinWaitlist(page, full);
      await expect(classRow(page, full).getByText('Waiting #1')).toBeVisible();
    });

    await test.step('And Oskar is booked on Core at 18:15 at Solna as a fallback', async () => {
      await book(page, fallback);
    });

    const file = await test.step('When Oskar downloads his calendar file', async () => {
      return downloadCalendarFile(page);
    });

    await test.step('Then the calendar file holds Core and not Spinning 45', async () => {
      expect(eventsFor(file, fallback)).toHaveLength(1);
      expect(eventsFor(file, full)).toHaveLength(0);
    });

    await test.step('When a place on Spinning 45 frees up and promotion runs', async () => {
      await openSchedule(page, context, other);
      await cancel(page, full);
      runPromotion(waiting.tenantId);
    });

    await test.step('Then Oskar is booked on Spinning 45', async () => {
      await openSchedule(page, context, waiting);
      await expect(classRow(page, full).getByText('Booked', { exact: true })).toBeVisible();
      expect(bookingStatus(full.id, waiting.memberId)).toBe('booked');
    });

    await test.step('And his booking on Core is cancelled', async () => {
      await expect(classRow(page, fallback).getByRole('button', { name: 'Book', exact: true })).toBeVisible();
      expect(bookingStatus(fallback.id, waiting.memberId)).toBe('cancelled');
    });
  });
});
