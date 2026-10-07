// spec: specs/calendar-file.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect, recordEvidence } from '../evidence';
import {
  type ClassRow,
  book,
  bookedCountAfter,
  downloadCalendarFile,
  eventsFor,
  freePlaces,
  heldClassIds,
  memberNamed,
  openSchedule,
  siteOf,
  upcomingClasses,
} from './calendar-file';

test.use(recordEvidence);

test.describe('Calendar file of a member\'s booked classes', { tag: ['@acceptance', '@booking', '@BCPLA-10'] }, () => {
  test.setTimeout(90_000);

  test("AS-1 A member's booked classes are in their calendar file", { tag: ['@happy', '@smoke'] }, async ({
    page,
    context,
  }) => {
    const oskar = memberNamed('Puls Träning', 'Oskar Jernberg');

    const classes = await test.step('Given Oskar, a member at Puls Träning, is booked on three classes that have not started', async () => {
      const held = heldClassIds(oskar.memberId);
      const three: ClassRow[] = upcomingClasses(oskar)
        .filter((klass) => !held.has(klass.id) && freePlaces(klass) > 0)
        .slice(0, 3);
      expect(three).toHaveLength(3);
      await openSchedule(page, context, oskar);
      for (const klass of three) await book(page, klass);
      return three;
    });

    const file = await test.step('When Oskar downloads his calendar file from his schedule', async () => {
      return downloadCalendarFile(page);
    });

    await test.step('Then the calendar file holds three events', async () => {
      expect(file.filename).toMatch(/\.ics$/);
      for (const klass of classes) expect(eventsFor(file, klass)).toHaveLength(1);
      // Nothing but his booked classes that have not started: the three, and whatever he already held.
      expect(file.events).toHaveLength(bookedCountAfter(oskar.memberId, file.stampedAt));
    });

    await test.step('And each event shows the class name, the site with its address, the start and the end', async () => {
      for (const klass of classes) {
        const [event] = eventsFor(file, klass);
        const site = siteOf(klass.siteId);
        expect(event?.summary).toBe(klass.name);
        expect(event?.location).toBe(`${site.name}, ${site.addressLine}, ${site.city}`);
        expect(event?.startsAt).toBe(new Date(klass.startsAt).toISOString());
        expect(event?.endsAt).toBe(new Date(klass.endsAt).toISOString());
      }
    });

    await test.step('And the schedule shows "Changed a booking? Download again to update your calendar."', async () => {
      await expect(page.getByText('Changed a booking? Download again to update your calendar.')).toBeVisible();
    });
  });
});
