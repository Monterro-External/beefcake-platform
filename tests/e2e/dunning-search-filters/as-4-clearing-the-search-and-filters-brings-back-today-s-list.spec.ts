// spec: specs/dunning-search-filters.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect, recordEvidence } from '../evidence';
import {
  dunningCard,
  dunningCardMembers,
  dunningCountLine,
  newestInOpenDunning,
  openOverview,
  searchDunning,
} from './dunning-search-filters';

test.use(recordEvidence);

const TENANT = 'Puls Träning';

test.describe('Search and filter in "In dunning now"', { tag: ['@acceptance', '@payments'] }, () => {
  test('AS-4 Clearing the search and filters brings back today\'s list', { tag: ['@happy', '@BCPLA-36'] }, async ({
    page,
    context,
  }) => {
    await test.step('Given the front desk at Puls Träning has searched "In dunning now" for "zz-not-a-member"', async () => {
      await openOverview(page, context, 'front_desk', TENANT);
      await searchDunning(page, 'zz-not-a-member');
      await expect(dunningCard(page).getByText('No one matching "zz-not-a-member" is in dunning now.')).toBeVisible();
    });

    await test.step('When the front desk chooses "Clear search and filters"', async () => {
      await dunningCard(page).getByRole('link', { name: 'Clear search and filters', exact: true }).click();
      await expect(page).toHaveURL(/\/app$/);
    });

    await test.step('Then "In dunning now" shows the 8 newest charges in open dunning', async () => {
      await expect.poll(() => dunningCardMembers(page)).toEqual(newestInOpenDunning(TENANT, 8));
      await expect(dunningCountLine(page)).toHaveCount(0);
      await expect(dunningCard(page).getByRole('searchbox', { name: 'Search members in dunning' })).toHaveValue('');
    });
  });
});
