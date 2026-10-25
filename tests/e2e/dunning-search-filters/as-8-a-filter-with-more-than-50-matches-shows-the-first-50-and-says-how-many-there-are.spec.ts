// spec: specs/dunning-search-filters.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect, recordEvidence } from '../evidence';
import {
  chooseChip,
  dunningCard,
  dunningCardMemberIds,
  dunningCountLine,
  openDunningCharges,
  openOverview,
} from './dunning-search-filters';

test.use(recordEvidence);

const TENANT = 'Nordic Fitness Group';

test.describe('Search and filter in "In dunning now"', { tag: ['@acceptance', '@payments'] }, () => {
  test('AS-8 A filter with more than 50 matches shows the first 50 and says how many there are', { tag: ['@edge', '@BCPLA-36'] }, async ({
    page,
    context,
  }) => {
    const abandoned = openDunningCharges(TENANT).filter((charge) => charge.status === 'abandoned');

    await test.step('Given the front desk at Nordic Fitness Group is on the overview', async () => {
      expect(abandoned.length).toBeGreaterThan(50);
      await openOverview(page, context, 'front_desk', TENANT);
      await expect(dunningCard(page)).toBeVisible();
    });

    await test.step('When the front desk chooses the "Abandoned" chip', async () => {
      await chooseChip(page, 'Status', 'Abandoned', 'abandoned');
    });

    await test.step('Then the list shows 50 charges, newest attempt first', async () => {
      await expect
        .poll(() => dunningCardMemberIds(page))
        .toEqual(abandoned.slice(0, 50).map((charge) => charge.memberId));
    });

    await test.step('And the count line reads "Showing 50 of" the number of abandoned charges, followed by the number of members', async () => {
      const members = new Set(abandoned.map((charge) => charge.memberId)).size;
      const text = (await dunningCountLine(page).textContent()) ?? '';
      const match = /^Showing 50 of (.+) matching charges · (.+) members$/.exec(text);
      expect(match, text).not.toBeNull();
      expect(Number(match?.[1]?.replace(/\D/g, ''))).toBe(abandoned.length);
      expect(Number(match?.[2]?.replace(/\D/g, ''))).toBe(members);
    });
  });
});
