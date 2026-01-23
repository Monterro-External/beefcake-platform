/**
 * Drop the development database, re-apply the migrations and re-seed it.
 *
 *   npm run db:reset
 *   npm run db:reset -- --scale small
 *   npm run db:reset -- --today 2026-11-12
 *
 * Destructive by design: this is the command you run when the data is in a
 * state you no longer trust. It refuses to touch anything but the configured
 * development database file.
 */

import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { databasePath, openDatabase } from './client';
import { runMigrations } from './migrate';
import { seedDatabase } from './seed';
import { parseSeedArgs } from './seed/options';
import type { SeedSummary } from './seed/model';

export function resetDatabase(argv: readonly string[] = []): SeedSummary {
  const { options, quiet } = parseSeedArgs(argv);
  const path = databasePath();

  for (const suffix of ['', '-shm', '-wal']) {
    const file = `${path}${suffix}`;
    if (existsSync(file)) rmSync(file);
  }

  runMigrations(path);
  const connection = openDatabase(path);
  try {
    const log = (step: string): void => {
      if (!quiet) process.stdout.write(`  ${step}\n`);
    };
    if (!quiet) {
      process.stdout.write(
        `Seeding ${path}\n  today=${options.today} seed=${options.seed} scale=${options.scale.name}\n`,
      );
    }
    const summary = seedDatabase(connection, options, log);
    if (!quiet) process.stdout.write(`\n${formatSummary(summary)}\n`);
    else process.stdout.write(`${oneLine(summary)}\n`);
    return summary;
  } finally {
    connection.sqlite.close();
  }
}

export function formatSummary(summary: SeedSummary): string {
  const rows = Object.entries(summary.counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([table, n]) => `  ${table.padEnd(20)} ${n.toLocaleString('en-GB').padStart(11)}`);
  const total = Object.values(summary.counts).reduce((a, b) => a + b, 0);
  return [
    'Seeded.',
    ...rows,
    `  ${'total'.padEnd(20)} ${total.toLocaleString('en-GB').padStart(11)}`,
    '',
    `  today                ${summary.today}`,
    `  last payment run     ${summary.lastCompletedRun} (completed)`,
    `  next payment run     ${summary.nextRunDue} (due)`,
    `  took                 ${(summary.durationMs / 1000).toFixed(1)}s`,
  ].join('\n');
}

function oneLine(summary: SeedSummary): string {
  const total = Object.values(summary.counts).reduce((a, b) => a + b, 0);
  return `seeded ${total.toLocaleString('en-GB')} rows in ${(summary.durationMs / 1000).toFixed(1)}s (today=${summary.today}, scale=${summary.scale})`;
}

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (invokedDirectly) {
  try {
    resetDatabase(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`\nReset failed: ${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}
