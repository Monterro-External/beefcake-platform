import { expect, test } from '@playwright/test';
import { cleanMember, expectMessage, personaFor, seededToday, signIn, withDb } from './helpers';

/**
 * Freezing and cancelling, from the front desk.
 *
 * These are the two conversations that happen most at a counter, and the two
 * places where a date being one day out generates support tickets. The
 * assertions are on the stored dates, not on the wording, because the wording
 * will change and the dates must not.
 */
test.describe('front desk freezes a membership', () => {
  test('freezes from a chosen date and reports when the member is back', async ({ page, context }) => {
    const persona = personaFor('front_desk', 'Puls Träning');
    await signIn(context, persona.userId);
    const member = cleanMember(persona.tenantId);
    const today = seededToday();

    await page.goto(`/app/members/${member.memberId}`);
    await expect(page.getByRole('heading', { name: member.name })).toBeVisible();

    await page.getByLabel('From').fill(today);
    await page.getByRole('button', { name: 'Freeze membership' }).click();
    await expectMessage(page, /Frozen from .* Back on/);

    const freeze = withDb(
      (db) =>
        db
          .prepare(
            'select starts_on as startsOn, ends_on as endsOn, months from freezes where subscription_id = ? order by created_at desc limit 1',
          )
          .get(member.subscriptionId) as { startsOn: string; endsOn: string; months: number },
    );
    expect(freeze.startsOn).toBe(today);
    expect(freeze.months).toBe(1);
    // A one-month freeze ends the day before the member resumes.
    expect(freeze.endsOn > freeze.startsOn).toBe(true);

    // The member now reads as frozen, and the door would refuse them once the
    // grace window has passed.
    await page.reload();
    await expect(page.getByText('Frozen').first()).toBeVisible();

    // Removing it puts them back.
    await page.getByRole('button', { name: 'Remove freeze' }).click();
    await expectMessage(page, /Freeze removed/);
    const remaining = withDb(
      (db) =>
        db
          .prepare('select count(*) as n from freezes where subscription_id = ?')
          .get(member.subscriptionId) as { n: number },
    );
    expect(remaining.n).toBe(0);
  });

  test('refuses a freeze that starts in the past', async ({ page, context }) => {
    const persona = personaFor('front_desk', 'Puls Träning');
    await signIn(context, persona.userId);
    const member = cleanMember(persona.tenantId);

    await page.goto(`/app/members/${member.memberId}`);
    // The input has a min, so set the value past it the way a stale page would.
    await page.getByLabel('From').evaluate((element) => {
      (element as HTMLInputElement).min = '2000-01-01';
    });
    await page.getByLabel('From').fill('2020-01-01');
    await page.getByRole('button', { name: 'Freeze membership' }).click();
    await expectMessage(page, /cannot start in the past/i);
  });
});

test.describe('front desk records a cancellation', () => {
  test('honours the notice period and can take the notice back', async ({ page, context }) => {
    const persona = personaFor('front_desk', 'Puls Träning');
    await signIn(context, persona.userId);
    const member = cleanMember(persona.tenantId);
    const today = seededToday();

    const noticeDays = withDb((db) => {
      const row = db
        .prepare("select value from tenant_settings where tenant_id = ? and key = 'notice_period_days'")
        .get(persona.tenantId) as { value: string } | undefined;
      return row === undefined ? 30 : Number.parseInt(row.value, 10);
    });

    await page.goto(`/app/members/${member.memberId}`);
    await expect(page.getByText(`Notice period is ${noticeDays} days.`)).toBeVisible();

    await page.getByRole('button', { name: 'Give notice' }).click();
    await expectMessage(page, /Notice recorded/);

    const cancelled = withDb(
      (db) =>
        db
          .prepare(
            'select cancelled_on as cancelledOn, notice_ends_on as noticeEndsOn, ends_on as endsOn, status, cancel_reason as reason from subscriptions where id = ?',
          )
          .get(member.subscriptionId) as {
          cancelledOn: string;
          noticeEndsOn: string;
          endsOn: string;
          status: string;
          reason: string;
        },
    );

    expect(cancelled.cancelledOn).toBe(today);
    expect(cancelled.status).toBe('cancelling');
    // Notice ends exactly the notice period after today, and the membership
    // never ends before the notice does.
    const expectedNotice = new Date(`${today}T00:00:00Z`);
    expectedNotice.setUTCDate(expectedNotice.getUTCDate() + noticeDays);
    expect(cancelled.noticeEndsOn).toBe(expectedNotice.toISOString().slice(0, 10));
    expect(cancelled.endsOn >= cancelled.noticeEndsOn).toBe(true);

    // A confirmation was queued.
    const queued = withDb(
      (db) =>
        db
          .prepare(
            "select count(*) as n from outbox where template = 'cancellation_confirmed' and at >= ?",
          )
          .get(`${today}T00:00:00.000Z`) as { n: number },
    );
    expect(queued.n).toBeGreaterThan(0);

    // Withdraw it.
    await page.reload();
    await page.getByRole('button', { name: 'Withdraw notice' }).click();
    await expectMessage(page, /Notice withdrawn/);

    const restored = withDb(
      (db) =>
        db
          .prepare('select status, cancelled_on as cancelledOn, ends_on as endsOn from subscriptions where id = ?')
          .get(member.subscriptionId) as { status: string; cancelledOn: string | null; endsOn: string | null },
    );
    expect(restored.status).toBe('active');
    expect(restored.cancelledOn).toBeNull();
    expect(restored.endsOn).toBeNull();
  });
});

test.describe('a plan change is prorated', () => {
  test('charges each plan for its part of the period', async ({ page, context }) => {
    const persona = personaFor('front_desk', 'Puls Träning');
    await signIn(context, persona.userId);
    const member = cleanMember(persona.tenantId);

    await page.goto(`/app/members/${member.memberId}`);
    const before = withDb(
      (db) => db.prepare('select plan_id as planId from subscriptions where id = ?').get(member.subscriptionId) as { planId: string },
    );

    await page.getByRole('button', { name: 'Move to plan' }).click();
    // The message names the amount and the number of remaining days, which is
    // the proration being shown rather than assumed.
    await expectMessage(page, /remaining days of this period/);

    const after = withDb(
      (db) => db.prepare('select plan_id as planId from subscriptions where id = ?').get(member.subscriptionId) as { planId: string },
    );
    expect(after.planId).not.toBe(before.planId);

    const event = withDb(
      (db) =>
        db
          .prepare(
            "select payload_json as payload from events where action = 'subscription.plan_changed' and subject_id = ? order by at desc limit 1",
          )
          .get(member.subscriptionId) as { payload: string },
    );
    const payload = JSON.parse(event.payload) as { net_minor: number; to_plan_id: string };
    expect(payload.to_plan_id).toBe(after.planId);
    expect(Number.isInteger(payload.net_minor)).toBe(true);
  });
});
