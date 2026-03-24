/**
 * What the application treats as "now".
 *
 * In production this is the wall clock. Locally it is the date the database was
 * seeded for, because a dashboard that says "no payment run in three years" is
 * useless when the seeded history ends in 2026. The same reasoning as
 * `defaultNow` in the job runner, and the same rule: nothing reads
 * `new Date()` directly, it comes from here.
 */

import { getDb } from '@/db/client';
import { seedMeta } from '@/db/schema';
import { type PlainDate, type Timezone, assertPlainDate, localDay } from '@/domain/dates';

export interface Clock {
  readonly now: Date;
  /** True when the clock is pinned to the seeded date rather than the real one. */
  readonly pinned: boolean;
  today(timezone: Timezone): PlainDate;
}

export function clock(): Clock {
  const real = new Date();
  const meta = getDb().select().from(seedMeta).get();
  const seeded = meta === undefined ? null : assertPlainDate(meta.today);
  const realToday = real.toISOString().slice(0, 10);

  if (seeded === null || seeded === realToday) {
    return {
      now: real,
      pinned: false,
      today: (timezone) => localDay(real, timezone),
    };
  }

  const now = new Date(`${seeded}T${real.toISOString().slice(11)}`);
  return {
    now,
    pinned: true,
    today: () => seeded,
  };
}
