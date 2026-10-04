// spec: specs/member-registration.md
// seed: tests/e2e/seed.spec.ts

import { randomUUID } from 'node:crypto';
import { test } from '@playwright/test';
import { expect, recordEvidence } from '../evidence';
import { personaFor, signIn } from '../helpers';
import {
  expectProfile, fillRegistration, registrationFor, searchAndOpen, submitRegistration, tenantCounts,
} from './registration';

test.use(recordEvidence);

test.describe('Member registration', { tag: ['@acceptance', '@registration', '@BCPLA-17'] }, () => {
  test.setTimeout(90_000);

  test('AS-3 Registrations using the same email remain isolated between tenants', { tag: '@regression' }, async ({ page, context }) => {
    const puls = personaFor('front_desk', 'Puls Träning');
    const nordic = personaFor('front_desk', 'Nordic Fitness Group');
    const email = `e2e.isolation.${randomUUID()}@example.se`;

    const firstMember = await test.step('Given a member registered with Nordic Fitness Group', async () => {
      await signIn(context, nordic.userId);
      await fillRegistration(page, 'CI Nordic Member', email);
      await submitRegistration(page, 'CI Nordic Member');
      return registrationFor(nordic.tenantId, email);
    });
    const firstTenantCounts = tenantCounts(nordic.tenantId);

    const secondMember = await test.step('When Puls Träning registers the same email', async () => {
      await signIn(context, puls.userId);
      await fillRegistration(page, 'CI Puls Member', email);
      await submitRegistration(page, 'CI Puls Member');
      return registrationFor(puls.tenantId, email);
    });

    await test.step('Then each tenant has independent records and the first tenant is unchanged', async () => {
      expect(secondMember.id).not.toBe(firstMember.id);
      expect(secondMember.subscriptionId).not.toBe(firstMember.subscriptionId);
      expect(firstMember.cardId).toMatch(/^card_/);
      expect(secondMember.cardId).toMatch(/^card_/);
      expect(secondMember.cardId).not.toBe(firstMember.cardId);
      expect(registrationFor(nordic.tenantId, email)).toEqual(firstMember);
      expect(tenantCounts(nordic.tenantId)).toEqual(firstTenantCounts);
    });

    for (const [persona, ownMember, otherMember] of [
      [puls, secondMember, firstMember],
      [nordic, firstMember, secondMember],
    ] as const) {
      await test.step(`And ${persona.tenantName} can find and access only its own member`, async () => {
        await signIn(context, persona.userId);
        await page.goto('/app/members');
        await searchAndOpen(page, ownMember);
        await expectProfile(page, ownMember);

        await page.goto(`/app/members/${otherMember.id}`);
        await expect(page.getByRole('heading', { name: '404', exact: true })).toBeVisible();
        await expect(page.getByText(otherMember.email)).toBeHidden();
        await expect(page.getByRole('heading', { name: otherMember.name, exact: true })).toBeHidden();
      });
    }
  });
});
