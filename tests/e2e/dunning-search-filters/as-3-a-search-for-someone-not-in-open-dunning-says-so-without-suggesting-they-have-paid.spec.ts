// spec: specs/dunning-search-filters.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect, recordEvidence } from '../evidence';
import { dunningCard, dunningCardRows, openOverview, searchDunning } from './dunning-search-filters';

test.use(recordEvidence);

const TENANT = 'Puls Träning';

test.describe('Search and filter in "In dunning now"', { tag: ['@acceptance', '@payments'] }, () => {
  test('AS-3 A search for someone not in open dunning says so without suggesting they have paid', { tag: ['@error', '@BCPLA-36'] }, async ({
    page,
    context,
  }) => {
    await test.step('Given the front desk at Puls Träning is on the overview', async () => {
      await openOverview(page, context, 'front_desk', TENANT);
      await expect(dunningCard(page)).toBeVisible();
    });

    await test.step('When the front desk searches "In dunning now" for "zz-not-a-member"', async () => {
      await searchDunning(page, 'zz-not-a-member');
    });

    await test.step('Then the list says "No one matching "zz-not-a-member" is in dunning now."', async () => {
      await expect(dunningCard(page).getByText('No one matching "zz-not-a-member" is in dunning now.', { exact: true })).toBeVisible();
      await expect(dunningCardRows(page)).toHaveCount(0);
      await expect(dunningCard(page).getByText('Nothing outstanding.')).toHaveCount(0);
    });

    await test.step('And the list offers "Clear search and filters"', async () => {
      await expect(dunningCard(page).getByRole('link', { name: 'Clear search and filters', exact: true })).toBeVisible();
    });
  });
});
