// spec: specs/dunning-search-filters.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect, recordEvidence } from '../evidence';
import {
  chipCount,
  chooseChip,
  dunningCard,
  dunningCardMemberIds,
  dunningChip,
  openOverview,
} from './dunning-search-filters';

test.use(recordEvidence);

const TENANT = 'Nordic Fitness Group';

test.describe('Search and filter in "In dunning now"', { tag: ['@acceptance', '@payments'] }, () => {
  test('AS-6 A reason that never occurs with Retrying is greyed out and cannot be chosen', { tag: ['@edge', '@BCPLA-36'] }, async ({
    page,
    context,
  }) => {
    await test.step('Given the front desk at Nordic Fitness Group is on the overview', async () => {
      await openOverview(page, context, 'front_desk', TENANT);
      await expect(dunningCard(page)).toBeVisible();
    });

    await test.step('When the front desk chooses the "Retrying" chip', async () => {
      await chooseChip(page, 'Status', 'Retrying', 'retrying');
    });

    await test.step('Then the "Account closed" and "Mandate cancelled" chips show 0 and are greyed out', async () => {
      for (const label of ['Account closed', 'Mandate cancelled']) {
        await expect(dunningChip(page, 'Reason', label)).toHaveAttribute('aria-disabled', 'true');
        expect(await chipCount(page, 'Reason', label), label).toBe(0);
        await expect(
          dunningCard(page).getByRole('group', { name: 'Reason', exact: true }).getByRole('link', { name: new RegExp(`^${label}`) }),
        ).toHaveCount(0);
      }
    });

    await test.step('And choosing the "Account closed" chip changes nothing', async () => {
      const address = page.url();
      const members = await dunningCardMemberIds(page);
      await dunningChip(page, 'Reason', 'Account closed').click();
      await page.waitForTimeout(500);
      expect(page.url()).toBe(address);
      expect(await dunningCardMemberIds(page)).toEqual(members);
    });
  });
});
