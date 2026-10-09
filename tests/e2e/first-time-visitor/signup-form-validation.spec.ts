// spec: specs/first-time-visitor.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect } from '../evidence';
import { personaFor, signIn } from '../helpers';

test.describe('First-time visitor', { tag: '@registration' }, () => {
  test('Signup form blocks empty and malformed input', { tag: '@error' }, async ({ page, context }) => {
    await signIn(context, personaFor('front_desk', 'Puls Träning').userId);

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
      await page.getByLabel('Email').fill(`e2e.validation.${Date.now()}@example.se`);
      await page.getByLabel('Birth year').fill(String(new Date().getFullYear() - 13));
      await page.getByRole('button', { name: 'Sign up' }).click();
      await expect(page).toHaveURL(/\/app\/members\/new$/);
      await expect(page.getByLabel('Birth year')).not.toHaveJSProperty('validationMessage', '');
    });
  });
});
