// spec: specs/dunning-search-filters.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect, recordEvidence } from '../evidence';
import { personaFor, signIn } from '../helpers';
import { dunningCard, dunningCardMembers, newestInOpenDunning } from './dunning-search-filters';

test.use(recordEvidence);

const TENANT = 'Nordic Fitness Group';

test.describe('Search and filter in "In dunning now"', { tag: ['@acceptance', '@payments'] }, () => {
  test('AS-11 Without a search or filter the overview card is as it is today', { tag: ['@regression', '@BCPLA-36'] }, async ({
    page,
    context,
  }) => {
    await test.step('Given the owner of Nordic Fitness Group is signed in', async () => {
      await signIn(context, personaFor('owner', TENANT).userId);
    });

    await test.step('When the owner opens the overview', async () => {
      await page.goto('/app');
      await expect(dunningCard(page)).toBeVisible();
    });

    await test.step('Then "In dunning now" shows the 8 newest charges in open dunning', async () => {
      expect(await dunningCardMembers(page)).toEqual(newestInOpenDunning(TENANT, 8));
    });

    await test.step('And the card offers "All payments"', async () => {
      await expect(dunningCard(page).getByRole('link', { name: 'All payments', exact: true })).toHaveAttribute(
        'href',
        '/app/payments',
      );
    });

    await test.step('And no count line is shown', async () => {
      await expect(dunningCard(page).getByText(/matching charges?/)).toHaveCount(0);
    });
  });
});
