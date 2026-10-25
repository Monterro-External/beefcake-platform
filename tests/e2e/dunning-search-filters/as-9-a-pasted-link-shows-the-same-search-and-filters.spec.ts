// spec: specs/dunning-search-filters.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect, recordEvidence } from '../evidence';
import { signIn } from '../helpers';
import {
  chooseChip,
  colleagueOf,
  dunningCard,
  dunningCardMemberIds,
  dunningChip,
  openDunningCharges,
  openOverview,
  searchDunning,
} from './dunning-search-filters';

test.use(recordEvidence);

const TENANT = 'Nordic Fitness Group';

test.describe('Search and filter in "In dunning now"', { tag: ['@acceptance', '@payments'] }, () => {
  test('AS-9 A pasted link shows the same search and filters', { tag: ['@happy', '@BCPLA-36'] }, async ({
    page,
    context,
  }) => {
    const retrying = openDunningCharges(TENANT).find((charge) => charge.status === 'retrying');
    let address = '';
    let listed: string[] = [];

    await test.step('Given the front desk at Nordic Fitness Group has chosen the "Retrying" chip and searched for a member\'s email', async () => {
      if (retrying === undefined) throw new Error(`Nobody at ${TENANT} is retrying`);
      await openOverview(page, context, 'front_desk', TENANT);
      await chooseChip(page, 'Status', 'Retrying', 'retrying');
      await searchDunning(page, retrying.email);
      await expect(page).toHaveURL(/[?&]status=retrying(&|$)/);
      await expect.poll(() => dunningCardMemberIds(page)).toContain(retrying.memberId);
      address = page.url();
      listed = await dunningCardMemberIds(page);
    });

    await test.step('When a colleague at the front desk opens the same address', async () => {
      await context.clearCookies();
      await signIn(context, colleagueOf('front_desk', TENANT).userId);
      await page.goto(address);
      await expect(dunningCard(page)).toBeVisible();
    });

    await test.step('Then the colleague sees the same search, the same chip chosen and the same charges', async () => {
      await expect(dunningCard(page).getByRole('searchbox', { name: 'Search members in dunning' })).toHaveValue(
        retrying?.email ?? '',
      );
      await expect(dunningChip(page, 'Status', 'Retrying')).toHaveAttribute('aria-current', 'true');
      expect(await dunningCardMemberIds(page)).toEqual(listed);
    });
  });
});
