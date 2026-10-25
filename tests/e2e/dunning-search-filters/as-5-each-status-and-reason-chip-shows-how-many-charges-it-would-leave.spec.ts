// spec: specs/dunning-search-filters.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect, recordEvidence } from '../evidence';
import {
  REASON_CHIPS,
  chipCount,
  chooseChip,
  dunningCard,
  dunningCardStatuses,
  openDunningCharges,
  openOverview,
} from './dunning-search-filters';

test.use(recordEvidence);

const TENANT = 'Nordic Fitness Group';

test.describe('Search and filter in "In dunning now"', { tag: ['@acceptance', '@payments'] }, () => {
  test('AS-5 Each status and reason chip shows how many charges it would leave', { tag: ['@happy', '@BCPLA-36'] }, async ({
    page,
    context,
  }) => {
    await test.step('Given the front desk at Nordic Fitness Group is on the overview', async () => {
      await openOverview(page, context, 'front_desk', TENANT);
      await expect(dunningCard(page)).toBeVisible();
    });

    await test.step('When the front desk chooses the "Abandoned" chip', async () => {
      await chooseChip(page, 'Status', 'Abandoned', 'abandoned');
    });

    await test.step('Then only abandoned charges are listed', async () => {
      // The table's badge still says "Given up" for abandoned (BCPRO-112).
      const statuses = await dunningCardStatuses(page);
      expect(statuses.length).toBeGreaterThan(0);
      expect(new Set(statuses)).toEqual(new Set(['Given up']));
    });

    await test.step('And each reason chip shows how many abandoned charges have that reason', async () => {
      const abandoned = openDunningCharges(TENANT).filter((charge) => charge.status === 'abandoned');
      for (const [code, label] of Object.entries(REASON_CHIPS)) {
        const expected = abandoned.filter((charge) => charge.failureCode === code).length;
        expect(await chipCount(page, 'Reason', label), label).toBe(expected);
      }
    });
  });
});
