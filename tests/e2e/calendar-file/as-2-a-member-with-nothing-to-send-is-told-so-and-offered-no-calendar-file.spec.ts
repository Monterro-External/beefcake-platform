// spec: specs/calendar-file.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect, recordEvidence } from '../evidence';
import { memberWithNothingToSend, openSchedule } from './calendar-file';

test.use(recordEvidence);

test.describe('Calendar file of a member\'s booked classes', { tag: ['@acceptance', '@booking', '@BCPLA-10'] }, () => {
  test('AS-2 A member with nothing to send is told so and offered no calendar file', { tag: ['@error', '@smoke'] }, async ({
    page,
    context,
  }) => {
    const ebba = await test.step('Given Ebba, a member at Puls Träning, has no bookings on classes that have not started', async () => {
      // The seed's Ebba holds bookings; its member login with nothing booked ahead plays her here.
      return memberWithNothingToSend('Puls Träning');
    });

    await test.step('When Ebba opens her schedule', async () => {
      await openSchedule(page, context, ebba);
    });

    await test.step('Then she sees "You have no upcoming booked classes."', async () => {
      await expect(page.getByText('You have no upcoming booked classes.')).toBeVisible();
    });

    await test.step('And she is offered no calendar file', async () => {
      await expect(page.getByRole('link', { name: 'Add my booked classes to your calendar' })).toHaveCount(0);
      await expect(page.getByText('Changed a booking? Download again to update your calendar.')).toHaveCount(0);
    });
  });
});
