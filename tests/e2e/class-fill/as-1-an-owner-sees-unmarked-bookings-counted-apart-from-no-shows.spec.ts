// spec: specs/class-fill.md
// seed: tests/e2e/seed.spec.ts

import { expect, recordEvidence } from '../evidence';
import { classFillRow, openClassFillReport } from './class-fill';
import { HORNSTULL, test } from './hornstull';

test.use(recordEvidence);

test.describe('Class fill by site with unmarked bookings reported on their own', { tag: ['@acceptance', '@booking'] }, () => {
  test('AS-1 An owner sees unmarked bookings counted apart from no-shows', { tag: ['@happy', '@BCPLA-19'] }, async ({
    page,
    context,
    hornstull,
  }) => {
    const klass = await test.step('Given Puls Träning has a site Hornstull whose only class in the last 30 days has 10 places', async () => {
      // Written to the database with its roster in the next step.
      return { daysAgo: 3, capacity: 10 };
    });

    await test.step('And that class has 4 attended bookings, 1 no-show and 3 unmarked bookings', async () => {
      hornstull([{ ...klass, attended: 4, noShow: 1, unmarked: 3 }]);
    });

    await test.step('When the owner of Puls Träning opens the class fill report for the last 30 days', async () => {
      await openClassFillReport(page, context, HORNSTULL.tenantName, 30);
    });

    await test.step('Then Hornstull shows 8 booked, 3 unmarked, 80% fill and 20% no-show', async () => {
      const row = await classFillRow(page, HORNSTULL.name);
      expect(row).toMatchObject({ Classes: '1', Booked: '8', Unmarked: '3', Fill: '80 %', 'No-show': '20 %' });
    });
  });
});
