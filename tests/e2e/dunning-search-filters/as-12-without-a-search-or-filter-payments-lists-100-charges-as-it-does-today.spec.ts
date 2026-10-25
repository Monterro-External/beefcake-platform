// spec: specs/dunning-search-filters.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect, recordEvidence } from '../evidence';
import { personaFor, signIn } from '../helpers';
import {
  openDunningCharges,
  paymentsDunningHeading,
  paymentsDunningList,
  paymentsDunningMemberIds,
} from './dunning-search-filters';

test.use(recordEvidence);

const TENANT = 'Nordic Fitness Group';

test.describe('Search and filter in "In dunning now"', { tag: ['@acceptance', '@payments'] }, () => {
  test('AS-12 Without a search or filter Payments lists 100 charges as it does today', { tag: ['@regression', '@BCPLA-36'] }, async ({
    page,
    context,
  }) => {
    const open = openDunningCharges(TENANT);

    await test.step('Given the owner of Nordic Fitness Group is signed in', async () => {
      expect(open.length).toBeGreaterThan(100);
      await signIn(context, personaFor('owner', TENANT).userId);
    });

    await test.step('When the owner opens Payments', async () => {
      await page.goto('/app/payments');
      await expect(page.getByRole('heading', { name: 'Payments', level: 1 })).toBeVisible();
    });

    await test.step('Then the dunning list is headed "In dunning (100)"', async () => {
      await expect(paymentsDunningHeading(page)).toHaveText('In dunning (100)');
    });

    await test.step('And it shows the 100 newest charges in open dunning', async () => {
      expect(await paymentsDunningMemberIds(page)).toEqual(open.slice(0, 100).map((charge) => charge.memberId));
      await expect(paymentsDunningList(page).getByText(/matching charges?/)).toHaveCount(0);
      await expect(paymentsDunningList(page).getByRole('link', { name: 'Next', exact: true })).toHaveCount(0);
    });
  });
});
