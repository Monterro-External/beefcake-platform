// spec: specs/class-fill.md
// seed: tests/e2e/seed.spec.ts

import { expect, recordEvidence } from '../evidence';
import { downloadClassFillExport, openClassFillReport, type ClassFillExport } from './class-fill';
import { HORNSTULL, test } from './hornstull';

test.use(recordEvidence);

test.describe('Class fill by site with unmarked bookings reported on their own', { tag: ['@acceptance', '@booking'] }, () => {
  test('AS-5 The class fill export keeps its columns and adds the new counts at the end', { tag: ['@regression', '@BCPLA-19'] }, async ({
    page,
    context,
    hornstull,
  }) => {
    let file: ClassFillExport | undefined;

    await test.step('Given Puls Träning has a site Hornstull whose only class in the last 30 days has 3 unmarked bookings and none marked', async () => {
      hornstull([{ daysAgo: 3, capacity: 10, unmarked: 3 }]);
    });

    await test.step('When the owner of Puls Träning exports the class fill report for the last 30 days', async () => {
      await openClassFillReport(page, context, HORNSTULL.tenantName, 30);
      file = await downloadClassFillExport(page);
    });

    await test.step("Then the file's columns are site_id, site_name, classes, capacity, booked, attended, waitlisted, fill_rate, no_show_rate, no_show, unmarked, upcoming", async () => {
      expect(file?.header).toEqual([
        'site_id',
        'site_name',
        'classes',
        'capacity',
        'booked',
        'attended',
        'waitlisted',
        'fill_rate',
        'no_show_rate',
        'no_show',
        'unmarked',
        'upcoming',
      ]);
    });

    await test.step("And Hornstull's no_show_rate cell is empty and its unmarked cell is 3", async () => {
      const rows = (file?.rows ?? []).filter((row) => row.site_name === HORNSTULL.name);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ no_show_rate: '', unmarked: '3' });
    });
  });
});
