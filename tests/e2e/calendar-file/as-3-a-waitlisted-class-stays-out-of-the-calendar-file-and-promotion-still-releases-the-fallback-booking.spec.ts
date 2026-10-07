// spec: specs/calendar-file.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect, recordEvidence } from '../evidence';
import { withDb } from '../helpers';
import {
  type ClassRow,
  type MemberLogin,
  book,
  bookingStatus,
  cancel,
  classRow,
  downloadCalendarFile,
  eventsFor,
  freePlaces,
  heldClassIds,
  joinWaitlist,
  memberLogins,
  openSchedule,
  overlaps,
  runPromotion,
  upcomingClasses,
} from './calendar-file';

test.use(recordEvidence);

interface Setup {
  /** Oskar in the scenario: waits for the full class and holds a fallback. */
  readonly waiting: MemberLogin;
  /** Takes the last place on the full class and later gives it back. */
  readonly other: MemberLogin;
  /** Spinning 45 in the scenario. */
  readonly full: ClassRow;
  /** Core in the scenario: overlaps the full class and has room. */
  readonly fallback: ClassRow;
}

/**
 * Two members who can book at the same site, a class there with one place left
 * and nobody waiting, and an overlapping class with room. Puls Träning first;
 * its Solna timetable has no overlapping classes on the small seed, so the
 * search moves on to the next tenant whose timetable does.
 */
function findSetup(): Setup {
  const tenants = withDb((db) =>
    db
      .prepare(
        `select t.name from tenants t
          where (select count(*) from users u where u.tenant_id = t.id and u.role = 'member') >= 2
          order by t.name = 'Puls Träning' desc, t.name`,
      )
      .all()
      .map((row) => (row as { name: string }).name),
  );
  for (const tenant of tenants) {
    const logins = memberLogins(tenant);
    for (const waiting of logins) {
      for (const other of logins) {
        if (other.memberId === waiting.memberId) continue;
        const heldByWaiting = heldClassIds(waiting.memberId);
        const heldByOther = heldClassIds(other.memberId);
        const othersClasses = new Set(upcomingClasses(other).map((klass) => klass.id));
        const classes = upcomingClasses(waiting);
        for (const full of classes) {
          if (full.waitlisted !== 0 || freePlaces(full) !== 1) continue;
          if (heldByWaiting.has(full.id) || heldByOther.has(full.id) || !othersClasses.has(full.id)) continue;
          const fallback = classes.find(
            (candidate) =>
              candidate.id !== full.id &&
              candidate.siteId === full.siteId &&
              overlaps(candidate, full) &&
              freePlaces(candidate) > 0 &&
              !heldByWaiting.has(candidate.id),
          );
          if (fallback !== undefined) return { waiting, other, full, fallback };
        }
      }
    }
  }
  throw new Error('No full class with an overlapping fallback class in the seeded timetable');
}

test.describe('Calendar file of a member\'s booked classes', { tag: ['@acceptance', '@booking', '@BCPLA-10'] }, () => {
  test.setTimeout(120_000);

  test('AS-3 A waitlisted class stays out of the calendar file, and promotion still releases the fallback booking', { tag: '@regression' }, async ({
    page,
    context,
  }) => {
    const setup = findSetup();
    const { waiting, other, full, fallback } = setup;

    await test.step('Given Oskar is on the waitlist for Spinning 45 at 18:00 at Solna', async () => {
      // Another member takes the last place, so the class is full with nobody waiting.
      await openSchedule(page, context, other);
      await book(page, full);
      await openSchedule(page, context, waiting);
      await joinWaitlist(page, full);
      await expect(classRow(page, full).getByText('Waiting #1')).toBeVisible();
    });

    await test.step('And Oskar is booked on Core at 18:15 at Solna as a fallback', async () => {
      await book(page, fallback);
    });

    const file = await test.step('When Oskar downloads his calendar file', async () => {
      return downloadCalendarFile(page);
    });

    await test.step('Then the calendar file holds Core and not Spinning 45', async () => {
      expect(eventsFor(file, fallback)).toHaveLength(1);
      expect(eventsFor(file, full)).toHaveLength(0);
    });

    await test.step('When a place on Spinning 45 frees up and promotion runs', async () => {
      await openSchedule(page, context, other);
      await cancel(page, full);
      runPromotion(waiting.tenantId);
    });

    await test.step('Then Oskar is booked on Spinning 45', async () => {
      await openSchedule(page, context, waiting);
      await expect(classRow(page, full).getByText('Booked', { exact: true })).toBeVisible();
      expect(bookingStatus(full.id, waiting.memberId)).toBe('booked');
    });

    await test.step('And his booking on Core is cancelled', async () => {
      await expect(classRow(page, fallback).getByRole('button', { name: 'Book', exact: true })).toBeVisible();
      expect(bookingStatus(fallback.id, waiting.memberId)).toBe('cancelled');
    });
  });
});
