/**
 * The seed generator.
 *
 *   npm run db:reset                        pinned development date, full size
 *   npm run db:reset -- --scale small       about a twelfth of the data, fast
 *   npm run db:reset -- --today 2026-11-12  same story, shifted in time
 *
 * Determinism is the contract: the same `--seed` and the same `--today` produce
 * a byte-identical story, so a screenshot, a test and a colleague's laptop all
 * agree, and a report bug found today can be reproduced tomorrow.
 *
 * Write order follows the data, not the foreign keys: the payment run needs to
 * know each member's plan changes and freezes, and the event stream is derived
 * from the charges once they exist. Foreign keys are therefore switched off for
 * the duration of the load and `pragma foreign_key_check` is run at the end, so
 * a broken reference still fails the seed rather than sitting in the database.
 */

import type { Connection } from '../client';
import { seedMeta } from '../schema';
import { buildWorld } from './people';
import { type Anchors, type SeedOptions, anchorsFor } from './options';
import { inTransaction } from './writer';
import { writeActivity } from './write-activity';
import { writeBilling } from './write-billing';
import { writeCore } from './write-core';
import { writeSchedule } from './write-schedule';
import type { SeedSummary, TableCounts } from './model';

export const SCHEMA_VERSION = '0000_initial_schema';

export interface SeedProgress {
  (step: string): void;
}

export function seedDatabase(
  connection: Connection,
  options: SeedOptions,
  onProgress: SeedProgress = () => {},
): SeedSummary {
  const startedAt = Date.now();
  const { sqlite } = connection;
  const anchors: Anchors = anchorsFor(options);
  const counts: TableCounts = {};

  onProgress('building the world');
  const world = buildWorld({
    anchors,
    seed: options.seed,
    memberFactor: options.scale.memberFactor,
  });

  sqlite.pragma('foreign_keys = OFF');
  try {
    onProgress('tenants, sites, plans, members, subscriptions');
    inTransaction(sqlite, () => {
      writeCore(sqlite, world, anchors, options.seed, counts);
    });

    onProgress('payment runs, charges, receipts');
    inTransaction(sqlite, () => {
      writeBilling(sqlite, world, anchors, options.seed, counts);
    });

    onProgress('classes and bookings');
    let schedule = { promotions: [] as ReturnType<typeof writeSchedule>['promotions'] };
    inTransaction(sqlite, () => {
      schedule = writeSchedule(sqlite, world, anchors, options.seed, counts);
    });

    onProgress('check-ins, events, errors, outbox');
    inTransaction(sqlite, () => {
      writeActivity(
        sqlite,
        {
          world,
          anchors,
          seed: options.seed,
          schedule,
          dailyVisitRate: options.scale.dailyVisitRate,
          eventSampleRate: options.scale.eventSampleRate,
        },
        counts,
      );
    });

    connection.db
      .insert(seedMeta)
      .values({
        id: 1,
        today: options.today,
        seed: options.seed,
        scale: options.scale.name,
        generatedAt: new Date().toISOString(),
        schemaVersion: SCHEMA_VERSION,
      })
      .onConflictDoUpdate({
        target: seedMeta.id,
        set: {
          today: options.today,
          seed: options.seed,
          scale: options.scale.name,
          schemaVersion: SCHEMA_VERSION,
        },
      })
      .run();

    onProgress('checking references');
    const broken = sqlite.prepare('pragma foreign_key_check').all() as unknown[];
    if (broken.length > 0) {
      throw new Error(
        `Seed produced ${broken.length} dangling foreign key reference(s): ${JSON.stringify(broken.slice(0, 5))}`,
      );
    }
  } finally {
    sqlite.pragma('foreign_keys = ON');
  }

  onProgress('optimising');
  sqlite.pragma('optimize');
  sqlite.exec('analyze');

  return {
    today: options.today,
    seed: options.seed,
    scale: options.scale.name,
    counts,
    durationMs: Date.now() - startedAt,
    databasePath: connection.path,
    lastCompletedRun: anchors.lastCompletedRun.period,
    nextRunDue: anchors.nextRun.runOn,
  };
}

export { anchorsFor } from './options';
export type { SeedSummary, TableCounts } from './model';
