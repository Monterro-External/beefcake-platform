// spec: specs/dunning-search-filters.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect, recordEvidence } from '../evidence';
import {
  chooseChip,
  dunningCard,
  dunningChip,
  dunningCountLine,
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
    const inDunning = openDunningCharges(TENANT);
    const abandoned = inDunning.filter((charge) => charge.status === 'abandoned');

    await test.step('Given the owner of Nordic Fitness Group has chosen the "Abandoned" chip on the overview', async () => {
      expect(abandoned.length).toBeGreaterThan(50);
      await openOverview(page, context, 'owner', TENANT);
      await chooseChip(page, 'Status', 'Abandoned', 'abandoned');
      // The card shows the matches; the payment run's "In dunning" figure stays
      // the 8 newest of everyone in open dunning, "8+" when capped.
      await expect(dunningCountLine(page)).toHaveText(/^Showing 50 of .+ matching charges · .+ members$/);
      const summary = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Payment run', exact: true }) });
      const figure = summary.locator('dt', { hasText: /^In dunning$/ }).locator('xpath=following-sibling::dd[1]');
      await expect(figure).toHaveText(inDunning.length >= 8 ? '8+' : String(inDunning.length));
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
      // A page past the last match shows the last page.
      const lastPage = Math.ceil(abandoned.length / 50);
      await page.goto('/app/payments?status=abandoned&page=999');
      await expect(paymentsDunningList(page).getByText(`${(lastPage - 1) * 50 + 1}-${abandoned.length} of ${abandoned.length}`, { exact: true })).toBeVisible();
      expect(await paymentsDunningMemberIds(page)).toEqual(abandoned.slice((lastPage - 1) * 50).map((charge) => charge.memberId));
    });
  });
});
