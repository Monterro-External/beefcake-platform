// spec: specs/first-time-visitor.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect } from '../evidence';
import { chooseInSwitcher, seededToday, withDb } from '../helpers';

test.describe('First-time visitor', { tag: '@registration' }, () => {
  test('Visitor signs up a new member after choosing a persona', { tag: '@happy' }, async ({ page }) => {
    const email = `e2e.visitor.${Date.now()}@example.se`;

    await test.step('Cold open /app and choose the Puls Träning front desk.', async () => {
      await page.goto('/app');
      const name = await chooseInSwitcher(page, 'Puls Träning', 'front desk');
      await expect(page.getByRole('banner').getByText(`${name} · Front desk`)).toBeVisible();
    });

    await test.step('Create a member with a unique email, valid Name and Phone, defaults.', async () => {
      await page.goto('/app/members/new');
      await page.getByLabel('Name').fill('Testperson Besökare');
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Phone').fill('+46701234567');
      await page.getByRole('button', { name: 'Sign up' }).click();
      await expect(page.getByRole('heading', { name: 'Testperson Besökare' })).toBeVisible();
      await expect(page.getByText(email)).toBeVisible();
    });

    await test.step('Check the member row in the database.', async () => {
      const row = withDb(
        (db) => db.prepare('select joined_on as joinedOn from members where email = ?').get(email) as { joinedOn: string } | undefined,
      );
      expect(row?.joinedOn).toBe(seededToday());
    });
  });
});
