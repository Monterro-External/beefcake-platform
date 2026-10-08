// spec: specs/calendar-file.md
// seed: tests/e2e/seed.spec.ts

import { test } from '@playwright/test';
import { expect, recordEvidence } from '../evidence';
import {
  book,
  downloadCalendarFile,
  eventsFor,
  freePlaces,
  heldClassIds,
  memberNamed,
  openSchedule,
  upcomingClasses,
} from './calendar-file';

test.use(recordEvidence);

test.describe('Calendar file of a member\'s booked classes', { tag: ['@acceptance', '@booking', '@BCPLA-10'] }, () => {
  test.setTimeout(90_000);

  test("AS-10 A calendar file holds only the member's own bookings and nothing about them", { tag: '@negative' }, async ({
    page,
    context,
  }) => {
    // The seed's Oskar trains at Täby; Elin Sandberg books at Solna with Ebba, so she plays Oskar here.
    const oskar = memberNamed('Puls Träning', 'Elin Sandberg');
    const ebba = memberNamed('Puls Träning', 'Ebba Bergström');
    const heldByOskar = heldClassIds(oskar.memberId);
    const heldByEbba = heldClassIds(ebba.memberId);
    const solna = upcomingClasses(ebba).filter((klass) => !heldByOskar.has(klass.id) && !heldByEbba.has(klass.id));
    const prefer = (name: string) => (a: { name: string }, b: { name: string }) =>
      Number(b.name === name) - Number(a.name === name);

    const yoga = await test.step('Given Oskar and Ebba are both booked on Yoga Flow at Solna', async () => {
      const shared = [...solna].sort(prefer('Yoga Flow')).find((klass) => freePlaces(klass) >= 2);
      if (shared === undefined) throw new Error('No Solna class with two places left');
      await openSchedule(page, context, oskar);
      await book(page, shared);
      await openSchedule(page, context, ebba);
      await book(page, shared);
      return shared;
    });

    const zumba = await test.step('And Ebba is also booked on Zumba at Solna', async () => {
      const hers = [...solna]
        .sort(prefer('Zumba'))
        .find((klass) => klass.id !== yoga.id && freePlaces(klass) >= 1);
      if (hers === undefined) throw new Error('No second Solna class with a place left');
      await book(page, hers);
      return hers;
    });

    const file = await test.step('When Oskar downloads his calendar file', async () => {
      await openSchedule(page, context, oskar);
      return downloadCalendarFile(page);
    });

    await test.step('Then it holds Yoga Flow and not Zumba', async () => {
      expect(eventsFor(file, yoga)).toHaveLength(1);
      expect(eventsFor(file, zumba)).toHaveLength(0);
    });

    await test.step('And it holds no name, email or phone number of Oskar or Ebba', async () => {
      const unfolded = file.text.replace(/\r\n[ \t]/g, '').toLowerCase();
      for (const member of [oskar, ebba]) {
        for (const personal of [member.name, member.email, member.loginEmail, member.phone]) {
          expect(unfolded).not.toContain(personal.toLowerCase());
        }
      }
    });
  });
});
