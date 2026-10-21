import { readFileSync } from 'node:fs';
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

export interface ClassFillExport {
  readonly header: readonly string[];
  /** One record per site, as column name → cell text. */
  readonly rows: readonly Record<string, string>[];
}

/** Press the class fill card's CSV link and read the file the browser saved. */
export async function downloadClassFillExport(page: Page): Promise<ClassFillExport> {
  const downloading = page.waitForEvent('download');
  await classFillCard(page).getByRole('link', { name: 'CSV' }).click();
  const download = await downloading;
  return parseCsv(readFileSync(await download.path(), 'utf8'));
}

function parseCsv(text: string): ClassFillExport {
  const [headerLine = '', ...lines] = text.trimEnd().split(/\r?\n/);
  const header = splitCsvLine(headerLine);
  return {
    header,
    rows: lines.map((line) => {
      const cells = splitCsvLine(line);
      return Object.fromEntries(header.map((name, i) => [name, cells[i] ?? '']));
    }),
  };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted && char === '"' && line[i + 1] === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      out.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  out.push(cell);
  return out;
}

/** Act as the owner of this tenant and open the dashboard. */
export async function openDashboard(page: Page, context: BrowserContext, tenantName: string): Promise<void> {
  const owner = personaFor('owner', tenantName);
  await context.clearCookies();
  await signIn(context, owner.userId);
  await page.goto('/app');
  await expect(classFillTile(page)).toBeVisible();
}

export function classFillTile(page: Page) {
  return page.getByText('Class fill, 30 days', { exact: true }).locator('..');
}

/** The dashboard's 30-day class fill tile: its fill and the places behind it ("8 of 30 places"). */
export async function readClassFillTile(page: Page): Promise<{ fill: string; booked: number; capacity: number }> {
  const [, fill = '', hint = ''] = (await classFillTile(page).locator('p').allTextContents()).map(squash);
  const places = /^([\d ]+) of ([\d ]+) places$/.exec(hint);
  if (places === null) throw new Error(`Unexpected class fill tile hint: ${hint}`);
  return { fill, booked: whole(places[1] ?? ''), capacity: whole(places[2] ?? '') };
}

/** The class fill report for the last `days` days as the owner exports it, one record per site by column name. */
export async function classFillExport(page: Page, days = 30): Promise<Record<string, string>[]> {
  const response = await page.request.get(`/app/reports/export/classes?days=${days}`);
  expect(response.ok()).toBe(true);
  return [...parseCsv(await response.text()).rows];
}

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();
const whole = (text: string): number => Number.parseInt(text.replace(/\D/g, ''), 10);
