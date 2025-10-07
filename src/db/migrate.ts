/**
 * Apply pending migrations to the database at $BEEFCAKE_DB (default
 * data/beefcake.db). Safe to run repeatedly.
 *
 *   npm run db:migrate
 */

import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { openDatabase, databasePath } from './client';

export function runMigrations(path = databasePath()): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const { db, sqlite } = openDatabase(path);
  try {
    migrate(db, { migrationsFolder: resolve(here, 'migrations') });
  } finally {
    sqlite.close();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (invokedDirectly) {
  const path = databasePath();
  runMigrations(path);
  process.stdout.write(`migrations applied to ${path}\n`);
}
