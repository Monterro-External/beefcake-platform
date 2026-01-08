/**
 * Bulk insert helper for the seed.
 *
 * The seed writes a few million rows. Drizzle's insert builder is the right
 * tool everywhere else, but building one statement per row (or one enormous
 * statement per table) turns a 20 second reset into a several minute one, and
 * `npm run db:reset` has to stay quick enough that a developer runs it without
 * thinking. So the seed drops to prepared multi-row INSERTs, batched to stay
 * under SQLite's variable limit, inside a single transaction per table.
 *
 * Nothing outside src/db/seed should use this.
 */

import type { Sqlite } from '../client';

const SQLITE_MAX_VARIABLES = 32_000;

export class BulkInserter<T extends Record<string, unknown>> {
  private readonly columns: readonly (keyof T & string)[];
  private readonly batchSize: number;
  private buffer: T[] = [];
  private statements = new Map<number, ReturnType<Sqlite['prepare']>>();
  private written = 0;

  constructor(
    private readonly sqlite: Sqlite,
    private readonly table: string,
    columns: readonly (keyof T & string)[],
  ) {
    this.columns = columns;
    this.batchSize = Math.max(1, Math.floor(SQLITE_MAX_VARIABLES / columns.length));
  }

  private statementFor(rowCount: number) {
    const cached = this.statements.get(rowCount);
    if (cached !== undefined) return cached;
    const placeholders = Array.from({ length: rowCount }, () => `(${this.columns.map(() => '?').join(',')})`).join(
      ',',
    );
    const sql = `insert into ${this.table} (${this.columns.map((c) => `"${toSnake(c)}"`).join(',')}) values ${placeholders}`;
    const statement = this.sqlite.prepare(sql);
    this.statements.set(rowCount, statement);
    return statement;
  }

  push(row: T): void {
    this.buffer.push(row);
    if (this.buffer.length >= this.batchSize) this.writeBuffer();
  }

  pushAll(rows: readonly T[]): void {
    for (const row of rows) this.push(row);
  }

  private writeBuffer(): void {
    if (this.buffer.length === 0) return;
    const rows = this.buffer;
    this.buffer = [];
    const params: unknown[] = [];
    for (const row of rows) {
      for (const column of this.columns) {
        params.push(normalise(row[column]));
      }
    }
    this.statementFor(rows.length).run(params);
    this.written += rows.length;
  }

  /** Write whatever is buffered. Returns the total row count for this table. */
  flush(): number {
    this.writeBuffer();
    return this.written;
  }

  get count(): number {
    return this.written + this.buffer.length;
  }
}

function normalise(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

/** `homeSiteId` -> `home_site_id`. Column names in the schema are snake_case. */
export function toSnake(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** Run `work` inside one transaction, which is what makes the bulk writes fast. */
export function inTransaction(sqlite: Sqlite, work: () => void): void {
  const wrapped = sqlite.transaction(work);
  wrapped();
}
