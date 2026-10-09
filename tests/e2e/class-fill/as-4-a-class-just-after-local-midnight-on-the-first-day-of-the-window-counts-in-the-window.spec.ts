// spec: specs/class-fill.md
// seed: tests/e2e/seed.spec.ts

import { expect, recordEvidence } from '../evidence';
import { classFillRow, openClassFillReport } from './class-fill';
import { HORNSTULL, test } from './hornstull';

test.use(recordEvidence);

test.describe('Class fill by site with unmarked bookings reported on their own', { tag: ['@acceptance', '@booking'] }, () => {
  test('AS-4 A class just after local midnight on the first day of the window counts in the window', { tag: ['@edge', '@BCPLA-19'] }, async ({
    page,
    context,
    hornstull,
  }) => {
    // The last 30 days run from 30 days before the seeded today up to today.
    const classes: { daysAgo: number; at: string; capacity: number; attended: number }[] = [];

    await test.step('Given Puls Träning has a site Hornstull in Europe/Stockholm', async () => {
      expect(HORNSTULL.timezone).toBe('Europe/Stockholm');
    });

    await test.step('And Hornstull has a class at 00:30 local time on the first day of the last 30 days', async () => {
      classes.push({ daysAgo: 30, at: '00:30', capacity: 10, attended: 2 });
    });

    await test.step('And Hornstull has a class at 23:30 local time on the day before', async () => {
      classes.push({ daysAgo: 31, at: '23:30', capacity: 20, attended: 5 });
      hornstull(classes);
    });

    await test.step('When the owner of Puls Träning opens the class fill report for the last 30 days', async () => {
      await openClassFillReport(page, context, HORNSTULL.tenantName, 30);
    });

    await test.step('Then Hornstull shows 1 class', async () => {
      const row = await classFillRow(page, HORNSTULL.name);
      expect(row).toMatchObject({ Classes: '1', Booked: '2' });
    });
  });
});
