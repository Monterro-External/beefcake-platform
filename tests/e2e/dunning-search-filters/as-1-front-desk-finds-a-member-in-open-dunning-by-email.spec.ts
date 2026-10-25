// spec: specs/dunning-search-filters.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect, recordEvidence } from '../evidence';
import {
  type DunningMember,
  dunningCard,
  dunningCardMemberIds,
  dunningCountLine,
  memberInOpenDunning,
  openOverview,
  searchDunning,
} from './dunning-search-filters';

test.use(recordEvidence);

const TENANT = 'Puls Träning';

test.describe('Search and filter in "In dunning now"', { tag: ['@acceptance', '@payments'] }, () => {
  test('AS-1 Front desk finds a member in open dunning by email', { tag: ['@happy', '@BCPLA-36'] }, async ({
    page,
    context,
  }) => {
    let member: DunningMember;

    await test.step('Given the front desk at Puls Träning is on the overview', async () => {
      await openOverview(page, context, 'front_desk', TENANT);
      await expect(dunningCard(page)).toBeVisible();
    });

    await test.step('And a member of Puls Träning has a charge in open dunning', async () => {
      member = memberInOpenDunning(TENANT);
      expect(member.charges).toBeGreaterThan(0);
    });

    await test.step("When the front desk searches \"In dunning now\" for that member's email", async () => {
      await searchDunning(page, member.email);
    });

    await test.step("Then the list shows only that member's charges in open dunning", async () => {
      await expect.poll(() => dunningCardMemberIds(page)).toEqual(Array(member.charges).fill(member.memberId));
    });

    await test.step('And the count line names how many matching charges and members there are', async () => {
      const charges = `${member.charges} matching ${member.charges === 1 ? 'charge' : 'charges'}`;
      await expect(dunningCountLine(page)).toHaveText(`${charges} · 1 member`);
    });
  });
});
