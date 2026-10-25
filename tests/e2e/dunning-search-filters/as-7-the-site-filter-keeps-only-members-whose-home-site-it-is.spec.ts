// spec: specs/dunning-search-filters.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect, recordEvidence } from '../evidence';
import {
  busiestDunningSite,
  dunningCard,
  dunningCardMemberIds,
  homeSites,
  openDunningCharges,
  openOverview,
} from './dunning-search-filters';

test.use(recordEvidence);

const TENANT = 'Puls Träning';

test.describe('Search and filter in "In dunning now"', { tag: ['@acceptance', '@payments'] }, () => {
  test('AS-7 The site filter keeps only members whose home site it is', { tag: ['@happy', '@BCPLA-36'] }, async ({
    page,
    context,
  }) => {
    const site = busiestDunningSite(TENANT);

    await test.step('Given the front desk at Puls Träning is on the overview', async () => {
      await openOverview(page, context, 'front_desk', TENANT);
      await expect(dunningCard(page)).toBeVisible();
    });

    await test.step("When the front desk chooses one of Puls Träning's sites in the site filter", async () => {
      await dunningCard(page).getByRole('combobox', { name: 'Site', exact: true }).selectOption({ label: site.name });
      await expect(page).toHaveURL(new RegExp(`[?&]site=${site.id}(&|$)`));
    });

    await test.step('Then every listed charge belongs to a member whose home site is that site', async () => {
      const expected = openDunningCharges(TENANT)
        .filter((charge) => charge.siteId === site.id)
        .slice(0, 50)
        .map((charge) => charge.memberId);
      await expect.poll(() => dunningCardMemberIds(page)).toEqual(expected);
      const listed = await dunningCardMemberIds(page);
      expect(new Set(homeSites(listed).values())).toEqual(new Set([site.id]));
    });
  });
});
