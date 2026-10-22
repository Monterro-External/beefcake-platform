/**
 * Database handle. One SQLite file, one connection per process.
 *
 * WAL plus `synchronous = NORMAL` because the seed writes a few million rows and
 * the default journal makes that take minutes. Foreign keys are on: they have
 * caught real tenant-isolation mistakes in review.
 *
 * Every connection registers `fold_case(text)`, a deterministic Unicode
 * lowercase. SQLite's own `lower()` folds ASCII only, so `lower('Åkerlund')`
 * keeps its `Å` and a search for "åkerlund" misses Henrik Åkerlund. Case-
 * insensitive matching (the member search) uses `fold_case`, which is why any
 * connection that runs app queries must come from `openDatabase()`.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { schema } from './schema';

export const DEFAULT_DB_PATH = 'data/beefcake.db';

export function databasePath(): string {
  return resolve(process.env.BEEFCAKE_DB ?? DEFAULT_DB_PATH);
}

export type Sqlite = Database.Database;
export type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface Connection {
  db: Db;
  sqlite: Sqlite;
  path: string;
}

let cached: Connection | null = null;

export function openDatabase(path = databasePath(), options: { readonly?: boolean } = {}): Connection {
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path, { readonly: options.readonly ?? false });
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.function('fold_case', { deterministic: true }, (value: unknown) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  );
  return { db: drizzle(sqlite, { schema }), sqlite, path };
}

/** Process-wide handle used by the app and the jobs. */
export function connection(): Connection {
  if (cached === null) cached = openDatabase();
  return cached;
}

export function getDb(): Db {
  return connection().db;
}

export function closeConnection(): void {
  if (cached !== null) {
    cached.sqlite.close();
    cached = null;
  }
}
