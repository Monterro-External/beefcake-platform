// spec: specs/class-fill.md
// seed: tests/e2e/seed.spec.ts

import { expect, recordEvidence } from '../evidence';
import { classFillRow, openClassFillReport } from './class-fill';
import { HORNSTULL, test } from './hornstull';

test.use(recordEvidence);

test.describe('Class fill by site with unmarked bookings reported on their own', { tag: ['@acceptance', '@booking'] }, () => {
  test('AS-2 A site where no attendance was marked shows no no-show rate', { tag: ['@error', '@BCPLA-19'] }, async ({
    page,
    context,
    hornstull,
  }) => {
    await test.step('Given Puls Träning has a site Hornstull whose only class in the last 30 days has 3 unmarked bookings and none marked', async () => {
      hornstull([{ daysAgo: 3, capacity: 10, unmarked: 3 }]);
    });

    await test.step('When the owner of Puls Träning opens the class fill report for the last 30 days', async () => {
      await openClassFillReport(page, context, HORNSTULL.tenantName, 30);
    });

    await test.step('Then Hornstull shows 3 unmarked and "–" as its no-show rate', async () => {
      const row = await classFillRow(page, HORNSTULL.name);
      expect(row).toMatchObject({ Unmarked: '3', 'No-show': '–' });
    });
  });
});
