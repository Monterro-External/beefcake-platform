import type { Page } from '@playwright/test';
import { seededToday, withDb } from '../helpers';
import { expect } from '../evidence';

// Shared steps for specs/member-registration.md.

export async function fillRegistration(page: Page, name: string, email: string) {
  await page.goto('/app/members');
  await page.getByRole('link', { name: 'New member', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New member', exact: true })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Phone', { exact: true }).fill('+46701234567');
  await page.getByLabel('Birth year').fill(String(Number(seededToday().slice(0, 4)) - 32));
  await page.getByLabel('Home gym').selectOption({ index: 0 });
  await page.getByLabel('Plan').selectOption({ index: 0 });
  await page.getByLabel('Issue an access card now').check();
  return {
    siteId: await page.getByLabel('Home gym').inputValue(),
    planId: await page.getByLabel('Plan').inputValue(),
  };
}

export async function submitRegistration(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Sign up', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

export async function searchAndOpen(page: Page, member: Registration): Promise<void> {
  await page.getByRole('textbox', { name: 'Search members' }).fill(member.email);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get('q') === member.email);
  const rows = page.getByRole('table').locator('tbody').getByRole('row');
  await expect(rows).toHaveCount(1);
  await expect(rows.getByText(member.email, { exact: true })).toBeVisible();
  await rows.getByRole('link', { name: member.name, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/app/members/${member.id}$`));
}

export async function expectProfile(page: Page, member: Registration): Promise<void> {
  await expect(page.getByRole('heading', { name: member.name, exact: true })).toBeVisible();
  await expect(page.getByText(member.email)).toBeVisible();
  await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();
  const membership = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Membership', exact: true }),
  });
  await expect(membership.getByText(member.planName, { exact: true })).toBeVisible();
  await expect(membership.getByText(member.siteName, { exact: true })).toBeVisible();
  if (member.cardId === null) throw new Error('Expected an issued access card');
  await expect(membership.getByText(member.cardId, { exact: true })).toBeVisible();
}

export interface Registration {
  id: string;
  name: string;
  email: string;
  phone: string;
  joinedOn: string;
  cardId: string | null;
  siteId: string;
  siteName: string;
  subscriptionId: string;
  startedOn: string;
  status: string;
  planId: string;
  planName: string;
}

export function registrationFor(tenantId: string, email: string): Registration {
  const member = withDb((db) => db.prepare(
    `select m.id, m.name, m.email, m.phone, m.joined_on as joinedOn, m.card_id as cardId,
            m.home_site_id as siteId, site.name as siteName, s.id as subscriptionId,
            s.started_on as startedOn, s.status, s.plan_id as planId, p.name as planName
       from members m
       join subscriptions s on s.member_id = m.id and s.tenant_id = m.tenant_id
       join plans p on p.id = s.plan_id and p.tenant_id = m.tenant_id
       join sites site on site.id = m.home_site_id and site.tenant_id = m.tenant_id
      where m.tenant_id = ? and m.email = ?`,
  ).get(tenantId, email) as Registration | undefined);
  if (member === undefined) throw new Error(`No registration for ${email} in ${tenantId}`);
  return member;
}

export function tenantCounts(tenantId: string) {
  return withDb((db) => db.prepare(
    `select
       (select count(*) from members where tenant_id = @tenantId) as members,
       (select count(*) from subscriptions where tenant_id = @tenantId) as subscriptions,
       (select count(*) from members where tenant_id = @tenantId and card_id is not null) as cards,
       (select count(*) from outbox where tenant_id = @tenantId and template = 'welcome') as welcomeMessages`,
  ).get({ tenantId }));
}
