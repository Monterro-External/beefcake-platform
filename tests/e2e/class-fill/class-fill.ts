import type { BrowserContext, Page } from '@playwright/test';
import { expect } from '../evidence';
import { personaFor, signIn } from '../helpers';

// Shared steps for specs/class-fill.md.

/** Act as the owner of this tenant and open the reports page for the last `days` days. */
export async function openClassFillReport(
  page: Page,
  context: BrowserContext,
  tenantName: string,
  days = 30,
): Promise<void> {
  const owner = personaFor('owner', tenantName);
  await context.clearCookies();
  await signIn(context, owner.userId);
  await page.goto(`/app/reports?days=${days}`);
  await expect(classFillCard(page)).toBeVisible();
}

export function classFillCard(page: Page) {
  return page.locator('section').filter({ has: page.getByRole('heading', { name: 'Class fill by site' }) });
}

/** One site's row of the class fill table, as column header → cell text. */
export async function classFillRow(page: Page, siteName: string): Promise<Record<string, string>> {
  const table = classFillCard(page).getByRole('table');
  const row = table.getByRole('row').filter({ has: page.getByRole('cell', { name: siteName, exact: true }) });
  await expect(row).toHaveCount(1);
  const headers = await table.getByRole('columnheader').allTextContents();
  const cells = await row.getByRole('cell').allTextContents();
  return Object.fromEntries(headers.map((header, i) => [header.trim(), (cells[i] ?? '').replace(/\s+/g, ' ').trim()]));
}

/** Act as the site manager of this tenant and open the classes page for one site. */
export async function openClassesPage(
  page: Page,
  context: BrowserContext,
  tenantName: string,
  siteId: string,
): Promise<void> {
  const siteManager = personaFor('site_manager', tenantName);
  await context.clearCookies();
  await signIn(context, siteManager.userId);
  await page.goto(`/app/classes?site=${encodeURIComponent(siteId)}`);
  await expect(siteFillTile(page)).toBeVisible();
}

/** The "Site fill, 30 days" tile on the classes page: its label, value and hint. */
export function siteFillTile(page: Page) {
  return page.getByText('Site fill, 30 days', { exact: true }).locator('..');
}
