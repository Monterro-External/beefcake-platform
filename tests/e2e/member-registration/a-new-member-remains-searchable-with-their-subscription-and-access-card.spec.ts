// spec: specs/member-registration.md
// seed: tests/e2e/seed.spec.ts

import { randomUUID } from 'node:crypto';
import { test } from '@playwright/test';
import { expect, recordEvidence } from '../evidence';
import { personaFor, seededToday, signIn, withDb } from '../helpers';
import { expectProfile, fillRegistration, registrationFor, searchAndOpen, submitRegistration } from './registration';

test.use(recordEvidence);

test.describe('Member registration', { tag: '@acceptance' }, () => {
  test.setTimeout(90_000);

  test('A new member remains searchable with their subscription and access card', async ({ page, context }) => {
    const receptionist = personaFor('front_desk', 'Puls Träning');
    const email = `e2e.registration.${randomUUID()}@example.se`;
    await signIn(context, receptionist.userId);

    const selection = await test.step('Given a new person at Puls Träning', async () => {
      return fillRegistration(page, 'CI Registration Member', email);
    });

    const member = await test.step('When the person is registered with a plan and access card', async () => {
      await submitRegistration(page, 'CI Registration Member');
      return registrationFor(receptionist.tenantId, email);
    });

    await test.step('Then the selected membership and access card are active', async () => {
      expect(member.siteId).toBe(selection.siteId);
      expect(member.planId).toBe(selection.planId);
      expect(member.joinedOn).toBe(seededToday());
      expect(member.startedOn).toBe(seededToday());
      expect(member.status).toBe('active');
      expect(member.phone).toBe('+46701234567');
      expect(member.cardId).toMatch(/^card_/);
      await expectProfile(page, member);
    });

    await test.step('And the member can be found again with the saved details', async () => {
      await page.getByRole('navigation').getByRole('link', { name: 'Members', exact: true }).click();
      await searchAndOpen(page, member);
      await page.reload();
      await expectProfile(page, member);
      expect(registrationFor(receptionist.tenantId, email)).toEqual(member);
    });

    await test.step('And exactly one welcome message is queued', async () => {
      const messages = withDb((db) => db
        .prepare("select status from outbox where tenant_id = ? and template = 'welcome' and recipient = ?")
        .all(receptionist.tenantId, email));
      expect(messages).toEqual([{ status: 'queued' }]);
    });
  });
});
