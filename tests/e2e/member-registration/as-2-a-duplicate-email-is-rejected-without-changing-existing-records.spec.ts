// spec: specs/member-registration.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect, recordEvidence } from '../evidence';
import { personaFor, signIn, withDb } from '../helpers';
import { fillRegistration, registrationFor, tenantCounts } from './registration';

test.use(recordEvidence);

test.describe('Member registration', { tag: ['@acceptance', '@registration', '@BCPLA-17'] }, () => {
  test.setTimeout(90_000);

  test('AS-2 A duplicate email is rejected without changing existing records', { tag: '@error' }, async ({ page, context }) => {
    const receptionist = personaFor('front_desk', 'Puls Träning');
    await signIn(context, receptionist.userId);
    const existingEmail = withDb((db) => db
      .prepare('select email from members where tenant_id = ? order by id limit 1')
      .get(receptionist.tenantId) as { email: string });
    const existing = registrationFor(receptionist.tenantId, existingEmail.email);
    const before = tenantCounts(receptionist.tenantId);

    await test.step('Given an email already registered with this tenant', async () => {
      await fillRegistration(page, 'CI Duplicate Member', existing.email);
    });

    await test.step('When another registration uses the same email', async () => {
      await page.getByRole('button', { name: 'Sign up', exact: true }).click();
    });

    await test.step('Then the duplicate is explained and nothing is created or changed', async () => {
      await expect(page.getByText('Somebody at this gym already uses that email address.')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'New member', exact: true })).toBeVisible();
      expect(tenantCounts(receptionist.tenantId)).toEqual(before);
      expect(registrationFor(receptionist.tenantId, existing.email)).toEqual(existing);
    });
  });
});
