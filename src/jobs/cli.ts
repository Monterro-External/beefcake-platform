/**
 * Entry point for every job.
 *
 *   npm run jobs:payment-run
 *   npm run jobs:access-sync -- --tenant ten_000000b
 *   npm run jobs:waitlist-promote -- --dry-run
 *
 * `--now` exists so a job can be run against the seeded database as if it were
 * any date, which is how you reproduce something that only happens on the 25th.
 */

import { closeConnection, connection } from '@/db/client';
import { assertPlainDate, fromIso } from '@/domain/dates';
import { accessSyncJob } from './access-sync';
import { paymentRunJob } from './payment-run';
import { waitlistPromoteJob } from './waitlist-promote';
import { type Job, type JobSummary, defaultNow, formatRunResult, runJob } from './runner';

const JOBS: Record<string, Job<never>> = {
  'payment-run': paymentRunJob as Job<never>,
  'access-sync': accessSyncJob as Job<never>,
  'waitlist-promote': waitlistPromoteJob as Job<never>,
};

const HELP = `
Run a scheduled job.

  npm run jobs:<name> [-- options]

Jobs:
${Object.entries(JOBS)
  .map(([name, job]) => `  ${name.padEnd(18)} ${job.describe}`)
  .join('\n')}

Options:
  --tenant ID      Only this tenant. Default: every tenant.
  --now VALUE      Treat this instant as now. Accepts an ISO instant or a plain
                   date (interpreted as 03:00 UTC). Default: the date the local
                   database was seeded for.
  --dry-run        Report what would happen and write nothing.
  --quiet          Only print the summary.
`;

function parseNow(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return fromIso(`${assertPlainDate(value)}T03:00:00.000Z`);
  return fromIso(value);
}

export function main(argv: readonly string[]): number {
  const name = argv[0];
  if (name === undefined || name === '--help' || !(name in JOBS)) {
    process.stdout.write(HELP);
    return name === undefined || name === '--help' ? 0 : 1;
  }

  let tenantId: string | undefined;
  let now: Date | undefined;
  let dryRun = false;
  let quiet = false;

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    const [flag, inline] = arg.includes('=') ? arg.split('=', 2) : [arg, undefined];
    const take = (): string => {
      const value = inline ?? argv[i + 1];
      if (value === undefined) throw new Error(`${flag} needs a value`);
      if (inline === undefined) i += 1;
      return value;
    };
    switch (flag) {
      case '--tenant':
        tenantId = take();
        break;
      case '--now':
        now = parseNow(take());
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--quiet':
        quiet = true;
        break;
      default:
        throw new Error(`Unknown flag ${flag}`);
    }
  }

  const job = JOBS[name] as Job<JobSummary>;
  const { db } = connection();
  const at = now ?? defaultNow(db);

  if (!quiet) {
    process.stdout.write(`${job.name} at ${at.toISOString()}${dryRun ? ' (dry run)' : ''}\n`);
  }

  const result = runJob(job, { now: at, tenantId, dryRun, quiet, db });
  process.stdout.write(`${formatRunResult(result)}\n`);
  return 0;
}

const invoked = process.argv[1]?.endsWith('cli.ts') === true || process.argv[1]?.endsWith('cli.js') === true;

if (invoked) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`\nJob failed: ${(error as Error).message}\n`);
    process.exitCode = 1;
  } finally {
    closeConnection();
  }
}
