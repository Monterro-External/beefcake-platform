// spec: specs/class-fill.md
// seed: tests/e2e/seed.spec.ts

import { expect, recordEvidence } from '../evidence';
import { openClassesPage, siteFillTile } from './class-fill';
import { HORNSTULL, test } from './hornstull';

test.use(recordEvidence);

test.describe('Class fill by site with unmarked bookings reported on their own', { tag: ['@acceptance', '@booking'] }, () => {
  test('AS-3 The site tile says no attendance was marked', { tag: ['@error', '@BCPLA-19'] }, async ({
    page,
    context,
    hornstull,
  }) => {
    await test.step('Given Puls Träning has a site Hornstull whose 2 classes in the last 30 days have only unmarked bookings', async () => {
      hornstull([
        { daysAgo: 3, capacity: 10, unmarked: 3 },
        { daysAgo: 10, capacity: 10, unmarked: 5 },
      ]);
    });

    await test.step('When the site manager of Puls Träning opens the classes page for Hornstull', async () => {
      await openClassesPage(page, context, HORNSTULL.tenantName, HORNSTULL.siteId);
    });

    await test.step('Then the site fill tile reads "No attendance marked · 2 classes"', async () => {
      await expect(siteFillTile(page)).toContainText('No attendance marked · 2 classes');
    });
  });
});
