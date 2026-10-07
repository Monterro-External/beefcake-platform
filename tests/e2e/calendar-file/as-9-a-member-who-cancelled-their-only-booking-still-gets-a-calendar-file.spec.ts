// spec: specs/calendar-file.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect, recordEvidence } from '../evidence';
import { book, cancel, downloadCalendarFile, eventsFor, memberWithNothingBooked, openSchedule } from './calendar-file';

test.use(recordEvidence);

test.describe('Calendar file of a member\'s booked classes', { tag: ['@acceptance', '@booking', '@BCPLA-10'] }, () => {
  test.setTimeout(90_000);

  test('AS-9 A member who cancelled their only booking still gets a calendar file', { tag: '@edge' }, async ({
    page,
    context,
  }) => {
    // Ebba is a member login with nothing booked ahead, never Puls Träning's: AS-2 and AS-8 need that one
    // untouched. Earlier runs may have left her cancelled bookings, so she books a class she never booked.
    const { member: ebba, klass: zumba } = memberWithNothingBooked('Puls Träning');

    await test.step('Given Ebba has downloaded her calendar file with her only booking, Zumba at Solna', async () => {
      await openSchedule(page, context, ebba);
      await book(page, zumba);
      const file = await downloadCalendarFile(page);
      const booked = file.events.filter((event) => event.status === 'CONFIRMED');
      expect(booked).toHaveLength(1);
      expect(booked).toEqual(eventsFor(file, zumba));
    });

    await test.step('When Ebba cancels her booking on Zumba', async () => {
      await cancel(page, zumba);
    });

    await test.step('Then her schedule still offers the calendar file', async () => {
      await page.reload();
      await expect(page.getByRole('link', { name: 'Add my booked classes to your calendar' })).toBeVisible();
      await expect(page.getByText('Changed a booking? Download again to update your calendar.')).toBeVisible();
      await expect(page.getByText('You have no upcoming booked classes.')).toHaveCount(0);
    });

    await test.step('And the calendar file holds Zumba as a cancelled event', async () => {
      const file = await downloadCalendarFile(page);
      expect(eventsFor(file, zumba).map((event) => event.status)).toEqual(['CANCELLED']);
      expect(file.events.filter((event) => event.status === 'CONFIRMED')).toHaveLength(0);
    });
  });
});
