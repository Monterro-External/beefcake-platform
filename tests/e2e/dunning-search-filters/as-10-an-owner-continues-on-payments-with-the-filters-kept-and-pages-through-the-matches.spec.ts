// spec: specs/dunning-search-filters.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect, recordEvidence } from '../evidence';
import {
  chooseChip,
  dunningCard,
  dunningChip,
  openDunningCharges,
  openOverview,
  paymentsDunningHeading,
  paymentsDunningList,
  paymentsDunningMemberIds,
} from './dunning-search-filters';

test.use(recordEvidence);

const TENANT = 'Nordic Fitness Group';

test.describe('Search and filter in "In dunning now"', { tag: ['@acceptance', '@payments'] }, () => {
  test('AS-10 An owner continues on Payments with the filters kept and pages through the matches', { tag: ['@happy', '@BCPLA-36'] }, async ({
    page,
    context,
  }) => {
    const abandoned = openDunningCharges(TENANT).filter((charge) => charge.status === 'abandoned');

    await test.step('Given the owner of Nordic Fitness Group has chosen the "Abandoned" chip on the overview', async () => {
      expect(abandoned.length).toBeGreaterThan(50);
      await openOverview(page, context, 'owner', TENANT);
      await chooseChip(page, 'Status', 'Abandoned', 'abandoned');
    });

    await test.step('When the owner chooses "See all on Payments"', async () => {
      await dunningCard(page).getByRole('link', { name: 'See all on Payments', exact: true }).click();
      await expect(page).toHaveURL(/\/app\/payments\?status=abandoned(#dunning)?$/);
    });

    await test.step('Then Payments shows "In dunning" with the number of matching charges and members', async () => {
      const members = new Set(abandoned.map((charge) => charge.memberId)).size;
      await expect(paymentsDunningHeading(page)).toHaveText(/^In dunning \(.+ matching · .+ members\)$/);
      const text = (await paymentsDunningHeading(page).textContent()) ?? '';
      const match = /^In dunning \((.+) matching · (.+) members\)$/.exec(text);
      expect(Number(match?.[1]?.replace(/\D/g, ''))).toBe(abandoned.length);
      expect(Number(match?.[2]?.replace(/\D/g, ''))).toBe(members);
      expect(await paymentsDunningMemberIds(page)).toEqual(abandoned.slice(0, 50).map((charge) => charge.memberId));
    });

    await test.step('And the "Abandoned" chip is still chosen', async () => {
      await expect(dunningChip(page, 'Status', 'Abandoned', paymentsDunningList(page))).toHaveAttribute(
        'aria-current',
        'true',
      );
    });

    await test.step('And the owner can page to the next 50 matching charges', async () => {
      await paymentsDunningList(page).getByRole('link', { name: 'Next', exact: true }).click();
      await expect(page).toHaveURL(/[?&]page=2(&|#|$)/);
      await expect(page).toHaveURL(/[?&]status=abandoned(&|#|$)/);
      await expect
        .poll(() => paymentsDunningMemberIds(page))
        .toEqual(abandoned.slice(50, 100).map((charge) => charge.memberId));
      // A change of filter starts again at page 1.
      const chip = dunningChip(page, 'Status', 'Retrying', paymentsDunningList(page));
      await expect(chip).toHaveAttribute('href', /^\/app\/payments\?status=retrying$/);
    });
  });
});
