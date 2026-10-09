// spec: specs/class-fill.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect, recordEvidence } from '../evidence';
import { type Hornstull, addHornstull, classFillCell, openClassFillReport } from './class-fill';

test.use(recordEvidence);

test.describe('Class fill by site with unmarked bookings reported on their own', { tag: ['@acceptance', '@booking', '@BCPLA-19'] }, () => {
  let hornstull: Hornstull | undefined;
  test.afterEach(() => hornstull?.remove());

  test('AS-2 A site where no attendance was marked shows no no-show rate', { tag: ['@error'] }, async ({ page, context }) => {
    await test.step('Given Puls Träning has a site Hornstull whose only class in the last 30 days has 3 unmarked bookings and none marked', async () => {
      hornstull = addHornstull('Puls Träning', [{ daysAgo: 3, capacity: 10, statuses: ['booked', 'booked', 'booked'] }]);
    });

    await test.step('When the owner of Puls Träning opens the class fill report for the last 30 days', async () => {
      await openClassFillReport(page, context, 'Puls Träning');
    });

    await test.step('Then Hornstull shows 3 unmarked and "–" as its no-show rate', async () => {
      await expect(await classFillCell(page, 'Hornstull', 'Unmarked')).toHaveText('3');
      await expect(await classFillCell(page, 'Hornstull', 'No-show')).toHaveText('–');
    });
  });
});
