// spec: specs/calendar-file.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect, recordEvidence } from '../evidence';
import { signIn } from '../helpers';
import { memberWithNothingToSend } from './calendar-file';

test.use(recordEvidence);

test.describe('Calendar file of a member\'s booked classes', { tag: ['@acceptance', '@booking', '@BCPLA-10'] }, () => {
  test('AS-8 Opening the calendar file address with nothing to send leads back to the schedule', { tag: '@negative' }, async ({
    page,
    context,
  }) => {
    const ebba = await test.step('Given Ebba, a member at Puls Träning, has no bookings on classes that have not started', async () => {
      // The seed's Ebba holds bookings; its member login with nothing booked ahead plays her here.
      const login = memberWithNothingToSend('Puls Träning');
      await context.clearCookies();
      await signIn(context, login.userId);
      return login;
    });

    await test.step('When Ebba opens the calendar file address directly', async () => {
      // A download would make this navigation fail; landing on a page means no file was served.
      await page.goto('/me/calendar');
    });

    await test.step('Then she is on her schedule', async () => {
      await expect(page).toHaveURL(/\/me$/);
      await expect(page.getByRole('heading', { name: `Hej ${ebba.name.split(' ')[0]}` })).toBeVisible();
    });

    await test.step('And she sees "You have no upcoming booked classes."', async () => {
      await expect(page.getByText('You have no upcoming booked classes.')).toBeVisible();
    });
  });
});
