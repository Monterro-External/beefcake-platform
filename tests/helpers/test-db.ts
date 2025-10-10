/**
 * A throwaway database for tests that need real SQL. Each call gets its own
 * file under the OS temp directory with migrations applied, so tests do not
 * share state and can run in parallel.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type Connection } from '@/db/client';
import { runMigrations } from '@/db/migrate';

export interface TestDb extends Connection {
  cleanup(): void;
}

export function createTestDb(): TestDb {
  const dir = mkdtempSync(join(tmpdir(), 'beefcake-test-'));
  const path = join(dir, 'test.db');
  runMigrations(path);
  const connection = openDatabase(path);
  return {
    ...connection,
    cleanup() {
      connection.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
