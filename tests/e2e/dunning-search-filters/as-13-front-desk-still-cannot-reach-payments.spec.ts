// spec: specs/dunning-search-filters.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect, recordEvidence } from '../evidence';
import { dunningCard, openOverview } from './dunning-search-filters';

test.use(recordEvidence);

const TENANT = 'Puls Träning';

test.describe('Search and filter in "In dunning now"', { tag: ['@acceptance', '@payments'] }, () => {
  test('AS-13 Front desk still cannot reach payments', { tag: ['@negative', '@BCPLA-36'] }, async ({ page, context }) => {
    await test.step('Given the front desk at Puls Träning is on the overview', async () => {
      await openOverview(page, context, 'front_desk', TENANT);
      await expect(dunningCard(page)).toBeVisible();
      await expect(dunningCard(page).getByRole('table').locator('tbody').getByRole('row')).toHaveCount(8);
    });

    await test.step('Then "In dunning now" offers no "All payments" link', async () => {
      await expect(dunningCard(page).getByRole('link', { name: 'All payments' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Payments', exact: true })).toHaveCount(0);
    });

    await test.step('And the payments summary with its "In dunning" figure is not shown', async () => {
      await expect(page.getByRole('heading', { name: 'Payment run', exact: true })).toHaveCount(0);
      await expect(page.getByText('In dunning', { exact: true })).toHaveCount(0);
      await expect(page.locator('a[href="/app/payments#dunning"]')).toHaveCount(0);
    });

    await test.step('When the front desk opens Payments', async () => {
      await page.goto('/app/payments');
    });

    await test.step('Then Payments is not available to the front desk', async () => {
      await expect(page.getByText('Not available to your role')).toBeVisible();
      await expect(page.getByRole('heading', { name: /^In dunning/ })).toHaveCount(0);
    });
  });
});
