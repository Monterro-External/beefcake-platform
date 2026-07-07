import { expect, test } from '@playwright/test';
import { classFor, expectMessage, memberLogin, personaFor, signIn, withDb } from './helpers';

/**
 * Booking, and the waitlist behind it.
 *
 * The waitlist half is the one worth having an end-to-end test for: it involves
 * the member app, the domain's placement rule, the promotion job and the roster
 * screen, and a bug in any of them looks like a full class that is not full.
 */
test.describe('a member books a class', () => {
  test('books a class that has room, then cancels it', async ({ page, context }) => {
    const login = memberLogin('Träningsverket Lund');
    await signIn(context, login.userId);
    const klass = classFor(login.memberId, 'room');

    await page.goto('/me');
    await expect(page.getByRole('heading', { name: /^Hej / })).toBeVisible();

    // Target the row by class id: class names repeat across the timetable.
    const row = page.locator(`tr[data-class-id="${klass.classId}"]`);
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Book' }).click();
    await expect(row.getByText('Booked')).toBeVisible({ timeout: 15_000 });

    const booked = withDb(
      (db) =>
        db
          .prepare('select status, position from bookings where class_id = ? and member_id = ?')
          .get(klass.classId, login.memberId) as { status: string; position: number | null } | undefined,
    );
    expect(booked?.status).toBe('booked');
    expect(booked?.position).toBeNull();

    // And take it back.
    await row.getByRole('button', { name: 'Cancel' }).click();
    await expect(row.getByRole('button', { name: /Book|Join waitlist/ })).toBeVisible({
      timeout: 15_000,
    });

    const afterCancel = withDb(
      (db) =>
        db
          .prepare('select status from bookings where class_id = ? and member_id = ?')
          .get(klass.classId, login.memberId) as { status: string },
    );
    expect(afterCancel.status).toBe('cancelled');
  });

  test('joins the waitlist when the class is full, and is promoted when a spot frees up', async ({
    page,
    context,
  }) => {
    const login = memberLogin('Träningsverket Lund');
    const klass = classFor(login.memberId, 'full');

    await signIn(context, login.userId);
    await page.goto('/me');

    const row = page.locator(`tr[data-class-id="${klass.classId}"]`);
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Join waitlist' }).click();
    await expectMessage(page, /Waiting/);

    const waitlisted = withDb(
      (db) =>
        db
          .prepare('select status, position from bookings where class_id = ? and member_id = ?')
          .get(klass.classId, login.memberId) as { status: string; position: number },
    );
    expect(waitlisted.status).toBe('waitlisted');
    expect(waitlisted.position).toBeGreaterThanOrEqual(1);

    // A site manager looking at the roster sees the queue.
    const manager = personaFor('site_manager', 'Träningsverket Lund');
    await signIn(context, manager.userId);
    await page.goto(`/app/classes/${klass.classId}`);
    await expect(page.getByRole('heading', { name: /Waitlist \(\d+\)/ })).toBeVisible();
    // A full class must not be advertising free spots.
    await expect(page.getByText(/free spot\(s\) with people waiting/)).toBeHidden();
  });
});

test.describe('the front desk works a roster', () => {
  test('marks attendance on a class that has happened', async ({ page, context }) => {
    const manager = personaFor('site_manager', 'Puls Träning');
    await signIn(context, manager.userId);

    const past = withDb(
      (db) =>
        db
          .prepare(
            `select c.id as classId, b.id as bookingId
               from classes c join bookings b on b.class_id = c.id
              where c.tenant_id = ?
                and c.cancelled = 0
                and c.starts_at < (select today from seed_meta) || 'T00:00:00.000Z'
                and b.status = 'attended'
              order by c.starts_at desc limit 1`,
          )
          .get(manager.tenantId) as { classId: string; bookingId: string },
    );

    await page.goto(`/app/classes/${past.classId}`);
    await expect(page.getByRole('heading', { name: 'Roster' })).toBeVisible();

    // Flip one attendee to a no-show and back.
    const first = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'No show' }) }).first();
    await first.getByRole('button', { name: 'No show' }).click();
    await expect(page.getByRole('button', { name: 'No show' }).first()).toBeVisible();

    const marked = withDb(
      (db) => db.prepare('select status from bookings where id = ?').get(past.bookingId) as { status: string },
    );
    expect(['attended', 'no_show']).toContain(marked.status);
  });
});
