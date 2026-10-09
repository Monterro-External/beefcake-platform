// spec: specs/first-time-visitor.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect } from '../evidence';
import { chooseInSwitcher } from '../helpers';

test.describe('First-time visitor', { tag: '@registration' }, () => {
  test('Signup form blocks empty and malformed input', { tag: '@error' }, async ({ page }) => {
    await test.step('Cold open /app and choose the Puls Träning front desk.', async () => {
      await page.goto('/app');
      const name = await chooseInSwitcher(page, 'Puls Träning', 'front desk');
      await expect(page.getByRole('banner').getByText(`${name} · Front desk`)).toBeVisible();
    });

    await test.step('Open /app/members/new and click Sign up with all fields empty.', async () => {
      await page.goto('/app/members/new');
      await expect(page.getByRole('heading', { name: 'New member' })).toBeVisible();
      await page.getByRole('button', { name: 'Sign up' }).click();
      await expect(page).toHaveURL(/\/app\/members\/new$/);
      await expect(page.getByLabel('Name')).not.toHaveJSProperty('validationMessage', '');
    });

    await test.step('Enter Name "Testperson", Email "not-an-email", click Sign up.', async () => {
      await page.getByLabel('Name').fill('Testperson');
      await page.getByLabel('Email').fill('not-an-email');
      await page.getByRole('button', { name: 'Sign up' }).click();
      await expect(page).toHaveURL(/\/app\/members\/new$/);
      await expect(page.getByLabel('Email')).not.toHaveJSProperty('validationMessage', '');
    });

    await test.step('Enter a valid email and a birth year under the minimum age, click Sign up.', async () => {
      // The form's max comes from the seeded app clock, not the host's, so read it.
      const birthYear = page.getByLabel('Birth year');
      const max = Number(await birthYear.getAttribute('max'));
      expect(max).toBeGreaterThan(0);
      await page.getByLabel('Email').fill(`e2e.validation.${Date.now()}@example.se`);
      await birthYear.fill(String(max + 1));
      await page.getByRole('button', { name: 'Sign up' }).click();
      await expect(page).toHaveURL(/\/app\/members\/new$/);
      await expect(birthYear).not.toHaveJSProperty('validationMessage', '');
    });
  });
});
