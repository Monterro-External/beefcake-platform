// spec: specs/class-fill.md
// seed: tests/e2e/seed.spec.ts

import { expect, recordEvidence } from '../evidence';
import { classFillExport, openDashboard, readClassFillTile } from './class-fill';
import { HORNSTULL, test } from './hornstull';

test.use(recordEvidence);

test.describe('Class fill by site with unmarked bookings reported on their own', { tag: ['@acceptance', '@booking'] }, () => {
  test('AS-6 The dashboard class fill tile agrees with the class fill report', { tag: ['@regression', '@BCPLA-19'] }, async ({
    page,
    context,
    hornstull,
  }) => {
    await test.step('Given Puls Träning has a site Hornstull whose only class in the last 30 days has 10 places and 3 unmarked bookings', async () => {
      hornstull([{ daysAgo: 3, capacity: 10, unmarked: 3 }]);
    });

    await test.step('When the owner of Puls Träning opens the dashboard', async () => {
      await openDashboard(page, context, HORNSTULL.tenantName);
    });

    await test.step("Then the 30-day class fill tile shows the same fill as the class fill report's total", async () => {
      const tile = await readClassFillTile(page);
      const report = await classFillExport(page, 30);
      const sum = (column: string) => report.reduce((acc, row) => acc + Number(row[column]), 0);

      // Hornstull's unmarked bookings hold places in the report the tile is read against.
      expect(report.find((row) => row.site_id === HORNSTULL.siteId)).toMatchObject({ capacity: '10', booked: '3' });
      expect({ booked: tile.booked, capacity: tile.capacity }).toEqual({ booked: sum('booked'), capacity: sum('capacity') });
      expect(tile.fill).toBe(`${Math.round((100 * sum('booked')) / sum('capacity'))} %`);
    });
  });
});
