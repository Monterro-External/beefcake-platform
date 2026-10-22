// spec: specs/dunning-search-filters.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect, recordEvidence } from '../evidence';
import {
  dunningCard,
  dunningCardMemberIds,
  dunningCardRows,
  memberWithOldAbandonedCharge,
  openOverview,
  searchDunning,
} from './dunning-search-filters';

test.use(recordEvidence);

const TENANT = 'Puls Träning';

test.describe('Search and filter in "In dunning now"', { tag: ['@acceptance', '@payments'] }, () => {
  test('AS-2 A search finds a member whose charge is older than the rows shown', { tag: ['@edge', '@BCPLA-36'] }, async ({
    page,
    context,
  }) => {
    let member: ReturnType<typeof memberWithOldAbandonedCharge>;

    await test.step('Given the front desk at Puls Träning is on the overview', async () => {
      await openOverview(page, context, 'front_desk', TENANT);
      await expect(dunningCard(page)).toBeVisible();
    });

    await test.step('And a member of Puls Träning has an abandoned charge older than the 8 newest in open dunning', async () => {
      member = memberWithOldAbandonedCharge(TENANT);
      await expect(dunningCardRows(page)).toHaveCount(8);
      expect(await dunningCardMemberIds(page)).not.toContain(member.memberId);
    });

    await test.step("When the front desk searches \"In dunning now\" for that member's card number", async () => {
      await searchDunning(page, member.cardId);
    });

    await test.step("Then the list shows that member's abandoned charge", async () => {
      const row = dunningCardRows(page).filter({ has: page.locator(`a[href="/app/members/${member.memberId}"]`) });
      await expect(row.filter({ hasText: 'no further attempts' }).first()).toBeVisible();
      await expect(dunningCardRows(page)).toHaveCount(member.charges);
    });
  });
});
