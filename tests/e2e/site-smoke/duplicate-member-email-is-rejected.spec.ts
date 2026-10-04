// spec: specs/site-smoke-test-plan.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect } from '../evidence';
import { personaFor, signIn, withDb } from '../helpers';
import { fillRegistration, registrationFor, tenantCounts } from '../member-registration/registration';

test.describe('Development entry and tenant member workflow', { tag: '@smoke' }, () => {
  test('Duplicate member email is rejected without creating a record', { tag: '@error' }, async ({ page, context }) => {
    const receptionist = personaFor('front_desk', 'Puls Träning');
    await signIn(context, receptionist.userId);
    const existingEmail = withDb((db) => db
      .prepare(
        `select m.email from members m
           join subscriptions s on s.member_id = m.id and s.tenant_id = m.tenant_id
          where m.tenant_id = ? and s.status = 'active'
          order by m.id limit 1`,
      )
      .get(receptionist.tenantId) as { email: string });
    const existing = registrationFor(receptionist.tenantId, existingEmail.email);
    const before = tenantCounts(receptionist.tenantId);

    await test.step('From the seeded front-desk session, open `/app/members/new`.', async () => {
      await page.goto('/app/members/new');
      await expect(page.getByRole('heading', { name: 'New member', exact: true })).toBeVisible();
    });

    await test.step('Enter a new name and the email address of an existing active member at Puls Träning, then submit Sign up.', async () => {
      await fillRegistration(page, 'Smoke Duplicate Member', existing.email);
      await page.getByRole('button', { name: 'Sign up', exact: true }).click();

      await expect(page.getByText('Somebody at this gym already uses that email address.')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'New member', exact: true })).toBeVisible();
      expect(tenantCounts(receptionist.tenantId)).toEqual(before);
      expect(registrationFor(receptionist.tenantId, existing.email)).toEqual(existing);
    });
  });
});
