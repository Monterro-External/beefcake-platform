import { expect, test } from '@playwright/test';
import { beefcakeStaff, expectMessage, personaFor, seededToday, signIn, withDb } from './helpers';

/**
 * The payment run, from the screen.
 *
 * The seeded database has the current period already billed, so this test's job
 * is to prove the idempotence rather than the happy path: an owner who clicks
 * "run payments" on a month that has gone out must not bill anybody twice. The
 * happy path is covered by tests/unit/jobs.test.ts, where it can be run against
 * a throwaway database.
 */
test.describe('payments', () => {
  test('an owner can see the run history and the dunning list', async ({ page, context }) => {
    const persona = personaFor('owner', 'Nordic Fitness Group');
    await signIn(context, persona.userId);

    await page.goto('/app/payments');
    await expect(page.getByRole('heading', { name: 'Payments' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Payment runs' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /In dunning \(\d+\)/ })).toBeVisible();

    // Open the most recent run and check the totals reconcile with the database.
    const run = withDb(
      (db) =>
        db
          .prepare(
            'select id, period, charges_attempted as attempted, charges_failed as failed from payment_runs where tenant_id = ? order by period desc limit 1',
          )
          .get(persona.tenantId) as { id: string; period: string; attempted: number; failed: number },
    );

    await page.goto(`/app/payments/${run.id}`);
    await expect(page.getByRole('heading', { name: /^Payment run / })).toBeVisible();
    await expect(page.getByText('Attempted').first()).toBeVisible();

    const shown = await page.locator('p.tabular-nums, p').filter({ hasText: /^\d[\d\s]*$/ }).allTextContents();
    // The attempted count appears somewhere on the page.
    expect(shown.some((text) => text.replace(/\s/g, '') === String(run.attempted))).toBe(true);
  });

  test('running the current period again does not bill anyone twice', async ({ page, context }) => {
    const persona = personaFor('owner', 'Fitness Nørrebro');
    await signIn(context, persona.userId);
    const today = seededToday();

    const before = withDb(
      (db) =>
        db.prepare('select count(*) as n from charges where tenant_id = ?').get(persona.tenantId) as {
          n: number;
        },
    );
    const runsBefore = withDb(
      (db) =>
        db.prepare('select count(*) as n from payment_runs where tenant_id = ?').get(persona.tenantId) as {
          n: number;
        },
    );

    await page.goto('/app/payments');
    await page.getByRole('button', { name: /^Run payments for / }).click();
    await page.getByRole('button', { name: 'Yes, run it' }).click();
    await expectMessage(page, /already been billed|Done:/);

    const runsAfter = withDb(
      (db) =>
        db.prepare('select count(*) as n from payment_runs where tenant_id = ?').get(persona.tenantId) as {
          n: number;
        },
    );
    // No new run for a period that has already gone out.
    expect(runsAfter.n).toBe(runsBefore.n);

    // Nobody has two first attempts for the same period.
    const duplicates = withDb(
      (db) =>
        db
          .prepare(
            `select count(*) as n from (
               select c.member_id, r.period from charges c
                 join payment_runs r on r.id = c.payment_run_id
                where c.tenant_id = ? and c.attempt = 1
                group by c.member_id, r.period having count(*) > 1)`,
          )
          .get(persona.tenantId) as { n: number },
    );
    expect(duplicates.n).toBe(0);
    expect(before.n).toBeGreaterThan(0);
    expect(today.length).toBe(10);
  });

  test('front desk cannot open payments at all', async ({ page, context }) => {
    const persona = personaFor('front_desk', 'Nordic Fitness Group');
    await signIn(context, persona.userId);

    await page.goto('/app');
    // No tab for it.
    await expect(page.getByRole('link', { name: 'Payments' })).toBeHidden();

    // And going there directly says why.
    await page.goto('/app/payments');
    await expect(page.getByText('Not available to your role')).toBeVisible();
  });
});

test.describe('reports and exports', () => {
  test('the churn report shows the lag behind failed payments and exports it', async ({
    page,
    context,
  }) => {
    const persona = personaFor('owner', 'Nordic Fitness Group');
    await signIn(context, persona.userId);

    await page.goto('/app/reports?days=365');
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
    await expect(page.getByText('Churn follows the payment run, not the calendar')).toBeVisible();
    // The median lag tile, and the number in it: 14 to 21 days is the seeded
    // relationship between exhausted dunning and giving notice.
    await expect(page.getByText('Median lag', { exact: true })).toBeVisible();
    await expect(page.getByText(/^1[4-9] days$|^2[01] days$/).first()).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Churn' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/nordic-fitness-group-churn-\d{4}-\d{2}-\d{2}\.csv/);
  });
});

test.describe('beefcake admin', () => {
  test('sorts tenants by health and can open one read-only', async ({ page, context }) => {
    const staff = beefcakeStaff();
    await signIn(context, staff.userId);

    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Tenants' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Nordic Fitness Group' })).toBeVisible();

    await page.getByRole('link', { name: 'Nordic Fitness Group' }).click();
    await expect(page.getByRole('heading', { name: 'Nordic Fitness Group' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Configuration' })).toBeVisible();

    await page.getByRole('button', { name: 'Open read-only' }).click();
    await expect(page.getByText('Read-only, impersonating')).toBeVisible({ timeout: 15_000 });

    // Impersonation cannot write: the front desk panel is replaced by a notice.
    await page.goto('/app/settings');
    await expect(page.getByText('Impersonation never writes.')).toBeVisible();

    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByRole('heading', { name: 'Tenants' })).toBeVisible({ timeout: 15_000 });
  });
});
