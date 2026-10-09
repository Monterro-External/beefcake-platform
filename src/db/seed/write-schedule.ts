/**
 * Writes the class schedule and the bookings on it.
 *
 * Each site runs a weekly template: morning classes before work, a quiet middle
 * of the day, and the 17:00 to 20:00 block that is the whole business. Popular
 * evening slots run two studios at once, which is why some classes at the same
 * site overlap in time, and why a member can hold a booking on one and sit on
 * the waitlist for the other.
 *
 * Classes in the past carry attendance: `attended` for most, `no_show` for the
 * rest. Classes in the future are `booked` and `waitlisted` only.
 */

import { type PlainDate, atLocalTime, dayOfWeek, eachDay } from '@/domain/dates';
import { createRng, hashString, mix32, type Rng } from '@/lib/rng';
import { sequentialId } from '../ids';
import type { Sqlite } from '../client';
import { BulkInserter } from './writer';
import { CLASS_NAMES } from './names';
import { membersWithNothingAhead } from './people';
import type { SeedMember, SeedSite, SeedWorld, TableCounts } from './model';
import type { Anchors } from './options';

interface SlotTemplate {
  /** 0 = Sunday .. 6 = Saturday. */
  readonly dow: number;
  readonly hour: number;
  readonly minute: number;
  readonly minutes: number;
  readonly nameIndex: number;
  readonly capacity: number;
  /** Which room. Two studios at the same time is how overlaps happen. */
  readonly studio: number;
}

/**
 * The weekly grid for one site. Deterministic per site, so the same site always
 * runs the same timetable and a screenshot taken last week still matches.
 */
function weeklyTemplate(rng: Rng, _site: SeedSite): SlotTemplate[] {
  const slots: SlotTemplate[] = [];
  const bigSite = rng.chance(0.55);

  for (let dow = 0; dow < 7; dow += 1) {
    const weekend = dow === 0 || dow === 6;
    const morning = weekend ? [10] : [6, 7];
    const evening = weekend ? [11, 13] : [16, 17, 18, 19];

    for (const hour of morning) {
      slots.push({
        dow,
        hour,
        minute: hour === 6 ? 15 : 0,
        minutes: 45,
        nameIndex: rng.int(0, CLASS_NAMES.length - 1),
        capacity: rng.int(12, 24),
        studio: 1,
      });
    }

    for (const hour of evening) {
      slots.push({
        dow,
        hour,
        minute: 0,
        minutes: rng.chance(0.4) ? 60 : 45,
        nameIndex: rng.int(0, CLASS_NAMES.length - 1),
        capacity: rng.int(14, 30),
        studio: 1,
      });
      // The 17:00 to 19:00 block runs a second studio at a quarter past, which
      // is what makes two classes at one site overlap.
      if (bigSite && hour >= 17 && hour <= 19) {
        slots.push({
          dow,
          hour,
          minute: 15,
          minutes: 45,
          nameIndex: rng.int(0, CLASS_NAMES.length - 1),
          capacity: rng.int(10, 20),
          studio: 2,
        });
      }
    }
  }

  return slots;
}

/**
 * Evening classes fill and spill onto a waitlist; a 06:15 class on a Monday in
 * July does not. The 17:00 to 19:00 block is where the waitlists live, which is
 * also where the two studios overlap.
 */
function slotPopularity(slot: SlotTemplate, day: PlainDate): number {
  const dow = dayOfWeek(day);
  let factor = 1;
  if (slot.hour >= 17 && slot.hour <= 19) factor *= 1.32;
  if (slot.hour === 16) factor *= 1.05;
  if (slot.hour <= 7) factor *= 0.84;
  if (dow === 0 || dow === 6) factor *= 0.86;
  if (dow === 1 || dow === 2) factor *= 1.09;
  const month = Number.parseInt(day.slice(5, 7), 10);
  if (month === 1) factor *= 1.24;
  if (month === 7) factor *= 0.7;
  if (month === 8) factor *= 0.92;
  return factor;
}

export interface ScheduleResult {
  /** Bookings promoted off a waitlist, for the outbox and event streams. */
  readonly promotions: { bookingId: string; memberId: string; tenantId: string; at: string }[];
}

export function writeSchedule(
  sqlite: Sqlite,
  world: SeedWorld,
  anchors: Anchors,
  seed: string,
  counts: TableCounts,
): ScheduleResult {
  const classRows = new BulkInserter(sqlite, 'classes', [
    'id',
    'tenantId',
    'siteId',
    'name',
    'instructorId',
    'startsAt',
    'endsAt',
    'capacity',
    'cancelled',
  ]);
  const bookingRows = new BulkInserter(sqlite, 'bookings', [
    'id',
    'tenantId',
    'classId',
    'memberId',
    'status',
    'position',
    'createdAt',
    'updatedAt',
  ]);

  const promotions: ScheduleResult['promotions'] = [];
  let classSeq = 0;
  let bookingSeq = 0;
  const days = eachDay(anchors.classesFrom, anchors.classesTo);

  for (const tenant of world.tenants) {
    const nothingAhead = membersWithNothingAhead(tenant.members);
    for (const site of tenant.sites) {
      const rng = createRng(`${seed}|schedule|${site.id}`);
      const template = weeklyTemplate(rng, site);
      const siteMembers = tenant.members.filter(
        (m) => m.siteIndex === site.index && m.status !== 'former',
      );
      if (siteMembers.length === 0) continue;

      for (const day of days) {
        if (day < site.openedOn) continue;
        const dow = dayOfWeek(day);
        const todaySlots = template.filter((slot) => slot.dow === dow);
        const perDay: { id: string; startsAt: string; endsAt: string; slot: SlotTemplate }[] = [];

        for (const slot of todaySlots) {
          classSeq += 1;
          const classId = sequentialId('class', classSeq);
          const startsAt = atLocalTime(day, site.timezone, slot.hour, slot.minute);
          const endsAt = new Date(startsAt.getTime() + slot.minutes * 60_000);
          // The occasional class is cancelled: instructor off sick.
          const cancelled = rng.chance(0.012);
          classRows.push({
            id: classId,
            tenantId: tenant.id,
            siteId: site.id,
            name: CLASS_NAMES[slot.nameIndex] ?? 'Circuit',
            instructorId: site.staffIds[classSeq % Math.max(1, site.staffIds.length)] ?? null,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            capacity: slot.capacity,
            cancelled,
          });
          if (!cancelled) {
            perDay.push({ id: classId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), slot });
          }
        }

        // Bookings are laid down in two passes over the day.
        //
        // Pass one fills each class in isolation: members up to capacity are
        // booked, the overflow goes on that class's waitlist and is numbered
        // from one. Pass two adds the fallback bookings, the alternative class a
        // waitlisted member holds in case they never get promoted. Those land in
        // a *different* class, so they have to come after every class has been
        // numbered, and they only go in where there is still room. Doing it in
        // one pass overfills classes and leaves holes in waitlist positions.
        const bookedToday = new Set<string>();
        const bookedCount = new Map<string, number>();
        // Nobody trains nine times in a day. Where the site's base is large
        // enough to fill the timetable without reusing people, cap each member
        // at a couple of classes; on the reduced scales the cap relaxes so the
        // classes still fill.
        const placesToday = perDay.reduce((acc, k) => acc + k.slot.capacity, 0);
        const dailyCap = Math.max(2, Math.ceil((placesToday * 1.15) / siteMembers.length));
        const perMemberToday = new Map<string, number>();
        const waitlistedRows: { member: SeedMember; klass: (typeof perDay)[number]; createdAt: string }[] =
          [];

        for (const klass of perDay) {
          // eslint-disable-next-line no-restricted-syntax -- BCPLA-26: 'in the past' cut-off at UTC midnight (noted on BCPLA-18)
          const inThePast = klass.startsAt < `${anchors.today}T00:00:00.000Z`;
          const popularity = slotPopularity(klass.slot, day);
          const target = Math.min(
            klass.slot.capacity + Math.round(klass.slot.capacity * 0.35),
            // No class draws more than about a third of the site's base, which
            // only binds on the reduced scales but keeps them proportionate.
            Math.max(1, Math.round(siteMembers.length * 0.35)),
            Math.max(
              0,
              Math.round(
                klass.slot.capacity * tenant.blueprint.fillRate * popularity * rng.around(1.09, 0.11, 0.72, 1.42),
              ),
            ),
          );

          let placed = 0;
          for (let i = 0; i < target; i += 1) {
            const member = pickMember(siteMembers, mix32(hashString(`${klass.id}|${i}`)));
            if (member === null) continue;
            if (bookedToday.has(`${klass.id}|${member.id}`)) continue;
            if ((perMemberToday.get(member.id) ?? 0) >= dailyCap) continue;
            if (member.joinedOn > day) continue;
            if (member.endsOn !== null && member.endsOn < day) continue;
            if (!inThePast && nothingAhead.has(member.id)) continue;
            bookedToday.add(`${klass.id}|${member.id}`);
            perMemberToday.set(member.id, (perMemberToday.get(member.id) ?? 0) + 1);

            const createdAt = new Date(
              new Date(klass.startsAt).getTime() - rng.int(2, 240) * 3_600_000,
            ).toISOString();
            const waitlisted = placed >= klass.slot.capacity;
            placed += 1;

            let status: string;
            let position: number | null = null;
            if (waitlisted) {
              status = 'waitlisted';
              position = placed - klass.slot.capacity;
              waitlistedRows.push({ member, klass, createdAt });
            } else if (inThePast) {
              status = rng.chance(tenant.blueprint.fillRate > 0.8 ? 0.88 : 0.83) ? 'attended' : 'no_show';
            } else {
              status = 'booked';
            }
            if (!waitlisted) bookedCount.set(klass.id, (bookedCount.get(klass.id) ?? 0) + 1);

            bookingSeq += 1;
            const bookingId = sequentialId('booking', bookingSeq);
            bookingRows.push({
              id: bookingId,
              tenantId: tenant.id,
              classId: klass.id,
              memberId: member.id,
              status,
              position,
              createdAt,
              updatedAt: inThePast ? klass.endsAt : createdAt,
            });

            // Someone dropped out and the queue moved: record it so the event
            // and outbox streams have promotions in them.
            if (!waitlisted && inThePast && rng.chance(0.03)) {
              promotions.push({
                bookingId,
                memberId: member.id,
                tenantId: tenant.id,
                at: new Date(new Date(klass.startsAt).getTime() - 5 * 3_600_000).toISOString(),
              });
            }
          }
        }

        // Pass two: the fallback bookings.
        for (const { member, klass, createdAt } of waitlistedRows) {
          if (!rng.chance(0.45)) continue;
          const candidates = perDay.filter(
            (other) =>
              other.id !== klass.id &&
              other.startsAt < klass.endsAt &&
              klass.startsAt < other.endsAt &&
              (bookedCount.get(other.id) ?? 0) < other.slot.capacity &&
              !bookedToday.has(`${other.id}|${member.id}`),
          );
          const fallback = candidates[0];
          if (fallback === undefined) continue;

          bookedToday.add(`${fallback.id}|${member.id}`);
          bookedCount.set(fallback.id, (bookedCount.get(fallback.id) ?? 0) + 1);
          // eslint-disable-next-line no-restricted-syntax -- BCPLA-26: 'in the past' cut-off at UTC midnight (noted on BCPLA-18)
          const inThePast = fallback.startsAt < `${anchors.today}T00:00:00.000Z`;
          bookingSeq += 1;
          bookingRows.push({
            id: sequentialId('booking', bookingSeq),
            tenantId: tenant.id,
            classId: fallback.id,
            memberId: member.id,
            status: inThePast ? (rng.chance(0.7) ? 'attended' : 'no_show') : 'booked',
            position: null,
            createdAt,
            updatedAt: inThePast ? fallback.endsAt : createdAt,
          });
        }
      }
    }
  }

  counts.classes = classRows.flush();
  counts.bookings = bookingRows.flush();
  return { promotions };
}

/**
 * Deterministic member pick. The cursor must already be mixed: keying it on a
 * plain arithmetic expression makes consecutive classes draw from overlapping
 * lattices, which is how one member ended up booked into nine classes on the
 * same evening.
 */
function pickMember(members: readonly SeedMember[], cursor: number): SeedMember | null {
  if (members.length === 0) return null;
  return members[cursor % members.length] ?? null;
}
