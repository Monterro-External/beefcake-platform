/**
 * Write the signal exports.
 *
 *   npm run export:signals -- --since 2026-01-01 --out ../beefcake-product/signals/platform/
 *
 * With no arguments it exports the last twelve months to `exports/` next to the
 * database, which is the useful default when you just want to look at the files.
 */

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { closeConnection, connection } from '@/db/client';
import { adminScope } from '@/db/repositories/scope';
import { type PlainDate, addDays, assertPlainDate } from '@/domain/dates';
import { type ExportResult, exportSignals, seededToday } from './signals';

const HELP = `
Write the signal exports the commercial side reads.

  npm run export:signals [-- options]

  --since YYYY-MM-DD   Earliest date to include. Default: 365 days before --today.
  --today YYYY-MM-DD   Treat this as today. Default: the date the local database
                       was seeded for.
  --out DIR            Where to write. Default: ./exports
  --quiet              Only print the summary line.

Writes events.jsonl, errors.jsonl, payment-runs.csv, churn.csv,
tenant-health.csv and access-sync.csv.
`;

export interface CliArgs {
  since?: PlainDate;
  today?: PlainDate;
  outDir: string;
  quiet: boolean;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { outDir: 'exports', quiet: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    const [flag, inline] = arg.includes('=') ? arg.split('=', 2) : [arg, undefined];
    const take = (): string => {
      const value = inline ?? argv[i + 1];
      if (value === undefined) throw new Error(`${flag} needs a value`);
      if (inline === undefined) i += 1;
      return value;
    };
    switch (flag) {
      case '--since':
        args.since = assertPlainDate(take());
        break;
      case '--today':
        args.today = assertPlainDate(take());
        break;
      case '--out':
        args.outDir = take();
        break;
      case '--quiet':
        args.quiet = true;
        break;
      case '--help':
        process.stdout.write(HELP);
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown flag ${flag}`);
    }
  }

  return args;
}

export function formatResult(result: ExportResult): string {
  const lines = [`Exported to ${result.outDir} (${result.since} to ${result.today})`];
  for (const file of result.files) {
    lines.push(
      `  ${file.name.padEnd(20)} ${file.rows.toLocaleString('en-GB').padStart(10)} rows  ${formatBytes(file.bytes).padStart(9)}`,
    );
  }
  lines.push(`  took ${(result.durationMs / 1000).toFixed(1)}s`);
  return lines.join('\n');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function main(argv: readonly string[]): number {
  const args = parseArgs(argv);
  const { db } = connection();
  const today = args.today ?? seededToday(db);
  const since = args.since ?? addDays(today, -365);

  const result = exportSignals(adminScope({ db }), {
    since,
    today,
    outDir: resolve(args.outDir),
  });

  if (args.quiet) {
    const rows = result.files.reduce((acc, file) => acc + file.rows, 0);
    process.stdout.write(
      `exported ${rows.toLocaleString('en-GB')} rows to ${result.outDir} in ${(result.durationMs / 1000).toFixed(1)}s\n`,
    );
  } else {
    process.stdout.write(`${formatResult(result)}\n`);
  }
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`\nExport failed: ${(error as Error).message}\n`);
    process.exitCode = 1;
  } finally {
    closeConnection();
  }
}
