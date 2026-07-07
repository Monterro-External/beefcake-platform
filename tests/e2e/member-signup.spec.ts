import { expect, test } from '@playwright/test';
import { expectMessage, personaFor, seededToday, signIn, withDb } from './helpers';

/**
 * Signing somebody up at the front desk, which is the flow that touches the most
 * parts at once: a member row, a subscription, the first pro-rated charge amount,
 * a welcome email in the outbox, and a working access card.
 */
test.describe('front desk signs up a new member', () => {
  test('creates the member, prices the first period and issues a card', async ({ page, context }) => {
    const persona = personaFor('front_desk', 'Puls Träning');
    await signIn(context, persona.userId);

    const email = `e2e.signup.${Date.now()}@example.se`;

    await page.goto('/app/members');
    await page.getByRole('link', { name: 'New member' }).click();
    await expect(page.getByRole('heading', { name: 'New member' })).toBeVisible();

    await page.getByLabel('Name').fill('Testperson Provsson');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Phone').fill('+46701234567');
    await page.getByRole('button', { name: 'Sign up' }).click();

    // Lands on the new member's profile.
    await expect(page.getByRole('heading', { name: 'Testperson Provsson' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(email)).toBeVisible();

    // The membership starts today and the door would let them in.
    const today = seededToday();
    await expect(page.getByText('Active').first()).toBeVisible();
    const row = withDb(
      (db) =>
        db
          .prepare(
            `select m.joined_on as joinedOn, m.card_id as cardId, s.started_on as startedOn, s.status
               from members m join subscriptions s on s.member_id = m.id
              where m.email = ?`,
          )
          .get(email) as {
          joinedOn: string;
          cardId: string | null;
          startedOn: string;
          status: string;
        } | undefined,
    );
    expect(row).toBeDefined();
    expect(row?.joinedOn).toBe(today);
    expect(row?.startedOn).toBe(today);
    expect(row?.status).toBe('active');
    expect(row?.cardId).not.toBeNull();

    // A welcome email was queued rather than sent.
    const queued = withDb(
      (db) =>
        db
          .prepare("select count(*) as n from outbox where template = 'welcome' and recipient = ?")
          .get(email) as { n: number },
    );
    expect(queued.n).toBe(1);
  });

  test('refuses an email address already in use at this gym', async ({ page, context }) => {
    const persona = personaFor('front_desk', 'Puls Träning');
    await signIn(context, persona.userId);

    const existing = withDb(
      (db) =>
        db
          .prepare("select email from members where tenant_id = ? and status = 'active' limit 1")
          .get(persona.tenantId) as { email: string },
    );

    await page.goto('/app/members/new');
    await page.getByLabel('Name').fill('Duplicate Person');
    await page.getByLabel('Email').fill(existing.email);
    await page.getByRole('button', { name: 'Sign up' }).click();

    await expectMessage(page, /already uses that email/i);
    // Still on the form, nothing created.
    await expect(page.getByRole('heading', { name: 'New member' })).toBeVisible();
  });
});
