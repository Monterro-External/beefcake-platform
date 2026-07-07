import { expect, test } from '@playwright/test';

test('the development landing page reports the state of the local database', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Beefcake', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: /Tenant app/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Member app/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Beefcake admin/ })).toBeVisible();
  // A seeded database is a precondition for every other end-to-end test, so the
  // smoke test asserts on the seed state panel rather than just the links.
  const state = page.getByRole('region').or(page.locator('section'));
  await expect(state.getByText('Local database')).toBeVisible();
  await expect(state.getByText('No seeded database found')).toBeHidden();
  await expect(state.getByText('Tenants', { exact: true })).toBeVisible();
});
