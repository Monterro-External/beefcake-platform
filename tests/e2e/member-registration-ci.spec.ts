import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { personaFor, seededToday, signIn, withDb } from './helpers';

test.use({
  actionTimeout: 15_000,
  viewport: { width: 1280, height: 720 },
  video: {
    mode: 'on',
    size: { width: 1280, height: 720 },
    show: {
      actions: { duration: 600, cursor: 'pointer', position: 'top-right', fontSize: 14 },
      test: { level: 'step', position: 'bottom-left', fontSize: 12 },
    },
  },
  trace: 'on',
  // Make the recorded interactions easier to follow without fixed waits in tests.
  launchOptions: { slowMo: 150 },
});

// Acceptance scenarios: docs/testing/member-registration-bdd.md.
// Each test arranges its own data and can run alone or be retried.
test.describe('member registration acceptance scenarios', () => {
  test.setTimeout(90_000);

  test('AS-1: a new member remains searchable with their subscription and access card', async ({ page, context }) => {
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

  test('AS-2: a duplicate email is rejected without changing existing records', async ({ page, context }) => {
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

  test('AS-3: registrations using the same email remain isolated between tenants', async ({ page, context }) => {
    const puls = personaFor('front_desk', 'Puls Träning');
    const nordic = personaFor('front_desk', 'Nordic Fitness Group');
    const email = `e2e.isolation.${randomUUID()}@example.se`;

    const firstMember = await test.step('Given a member registered with Nordic Fitness Group', async () => {
      await signIn(context, nordic.userId);
      await fillRegistration(page, 'CI Nordic Member', email);
      await submitRegistration(page, 'CI Nordic Member');
      return registrationFor(nordic.tenantId, email);
    });
    const firstTenantCounts = tenantCounts(nordic.tenantId);

    const secondMember = await test.step('When Puls Träning registers the same email', async () => {
      await signIn(context, puls.userId);
      await fillRegistration(page, 'CI Puls Member', email);
      await submitRegistration(page, 'CI Puls Member');
      return registrationFor(puls.tenantId, email);
    });

    await test.step('Then each tenant has independent records and the first tenant is unchanged', async () => {
      expect(secondMember.id).not.toBe(firstMember.id);
      expect(secondMember.subscriptionId).not.toBe(firstMember.subscriptionId);
      expect(firstMember.cardId).toMatch(/^card_/);
      expect(secondMember.cardId).toMatch(/^card_/);
      expect(secondMember.cardId).not.toBe(firstMember.cardId);
      expect(registrationFor(nordic.tenantId, email)).toEqual(firstMember);
      expect(tenantCounts(nordic.tenantId)).toEqual(firstTenantCounts);
    });

    for (const [persona, ownMember, otherMember] of [
      [puls, secondMember, firstMember],
      [nordic, firstMember, secondMember],
    ] as const) {
      await test.step(`And ${persona.tenantName} can find and access only its own member`, async () => {
        await signIn(context, persona.userId);
        await page.goto('/app/members');
        await searchAndOpen(page, ownMember);
        await expectProfile(page, ownMember);

        await page.goto(`/app/members/${otherMember.id}`);
        await expect(page.getByRole('heading', { name: '404', exact: true })).toBeVisible();
        await expect(page.getByText(otherMember.email)).toBeHidden();
        await expect(page.getByRole('heading', { name: otherMember.name, exact: true })).toBeHidden();
      });
    }
  });
});

async function fillRegistration(page: Page, name: string, email: string) {
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

async function submitRegistration(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Sign up', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible({ timeout: 15_000 });
}

async function searchAndOpen(page: Page, member: Registration): Promise<void> {
  await page.getByRole('textbox', { name: 'Search members' }).fill(member.email);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get('q') === member.email);
  const rows = page.getByRole('table').locator('tbody').getByRole('row');
  await expect(rows).toHaveCount(1);
  await expect(rows.getByText(member.email, { exact: true })).toBeVisible();
  await rows.getByRole('link', { name: member.name, exact: true }).click();
  // CI renders routes on demand in Next's dev server; allow the same budget as signup.
  await expect(page).toHaveURL(new RegExp(`/app/members/${member.id}$`), { timeout: 15_000 });
}

async function expectProfile(page: Page, member: Registration): Promise<void> {
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

interface Registration {
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

function registrationFor(tenantId: string, email: string): Registration {
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

function tenantCounts(tenantId: string) {
  return withDb((db) => db.prepare(
    `select
       (select count(*) from members where tenant_id = @tenantId) as members,
       (select count(*) from subscriptions where tenant_id = @tenantId) as subscriptions,
       (select count(*) from members where tenant_id = @tenantId and card_id is not null) as cards,
       (select count(*) from outbox where tenant_id = @tenantId and template = 'welcome') as welcomeMessages`,
  ).get({ tenantId }));
}
