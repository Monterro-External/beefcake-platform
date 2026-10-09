// spec: specs/class-fill.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect, recordEvidence } from '../evidence';
import { type Hornstull, addHornstull, classFillCell, openClassFillReport } from './class-fill';

test.use(recordEvidence);

test.describe('Class fill by site with unmarked bookings reported on their own', { tag: ['@acceptance', '@booking', '@BCPLA-19'] }, () => {
  let hornstull: Hornstull | undefined;
  test.afterEach(() => hornstull?.remove());

  test('AS-1 An owner sees unmarked bookings counted apart from no-shows', { tag: ['@happy'] }, async ({ page, context }) => {
    await test.step('Given Puls Träning has a site Hornstull whose only class in the last 30 days has 10 places', async () => {
      // The class is added with its bookings in the next step.
    });

    await test.step('And that class has 4 attended bookings, 1 no-show and 3 unmarked bookings', async () => {
      hornstull = addHornstull('Puls Träning', [
        {
          daysAgo: 3,
          capacity: 10,
          statuses: ['attended', 'attended', 'attended', 'attended', 'no_show', 'booked', 'booked', 'booked'],
        },
      ]);
    });

    await test.step('When the owner of Puls Träning opens the class fill report for the last 30 days', async () => {
      await openClassFillReport(page, context, 'Puls Träning');
    });

    await test.step('Then Hornstull shows 8 booked, 3 unmarked, 80% fill and 20% no-show', async () => {
      await expect(await classFillCell(page, 'Hornstull', 'Booked')).toHaveText('8');
      await expect(await classFillCell(page, 'Hornstull', 'Unmarked')).toHaveText('3');
      await expect(await classFillCell(page, 'Hornstull', 'Fill')).toHaveText(/^80\s%$/);
      await expect(await classFillCell(page, 'Hornstull', 'No-show')).toHaveText(/^20\s%$/);
    });
  });
});
