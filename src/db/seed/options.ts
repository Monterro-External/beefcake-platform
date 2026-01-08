/**
 * Seed options and the calendar anchors derived from them.
 *
 * Nothing in the seed hardcodes a date. Everything is an offset from `today`,
 * so `npm run db:reset -- --today 2027-03-01` tells the same story shifted
 * forward: the same tenants, the same trends, the last payment run just
 * completed, classes on the schedule for the coming fortnight.
 *
 * The pinned development date exists so that a screenshot in a document, a test
 * expectation and a developer's database all agree. Override it with `--today`.
 */

import {
  type BillingPeriod,
  type PlainDate,
  addMonths,
  assertPlainDate,
  billingPeriodOf,
  billingPeriodRange,
  firstDayOfMonth,
  plainDate,
  partsOf,
  subMonths,
} from '@/domain/dates';
import { PAYMENT_RUN_DAY, SCALES, type Scale, type ScaleName } from './blueprint';

/** The date the committed development seed is built around. */
export const PINNED_TODAY: PlainDate = plainDate(2026, 8, 26);

export const DEFAULT_SEED = 'beefcake-2026';

export interface SeedOptions {
  readonly today: PlainDate;
  readonly seed: string;
  readonly scale: Scale;
}

export interface ParsedArgs {
  readonly options: SeedOptions;
  readonly quiet: boolean;
}

export function parseSeedArgs(argv: readonly string[]): ParsedArgs {
  let today: PlainDate = PINNED_TODAY;
  let seed = DEFAULT_SEED;
  let scaleName: ScaleName = 'full';
  let quiet = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    const [flag, inlineValue] = arg.includes('=') ? arg.split('=', 2) : [arg, undefined];
    const value = inlineValue ?? argv[i + 1];
    const consume = (): string => {
      if (value === undefined) throw new Error(`${flag} needs a value`);
      if (inlineValue === undefined) i += 1;
      return value;
    };

    switch (flag) {
      case '--today':
        today = assertPlainDate(consume());
        break;
      case '--seed':
        seed = consume();
        break;
      case '--scale': {
        const requested = consume();
        if (!(requested in SCALES)) {
          throw new Error(`Unknown scale "${requested}". Use one of: ${Object.keys(SCALES).join(', ')}`);
        }
        scaleName = requested as ScaleName;
        break;
      }
      case '--quiet':
        quiet = true;
        break;
      case '--help':
        process.stdout.write(HELP);
        process.exit(0);
        break;
      default:
        if (flag?.startsWith('--')) throw new Error(`Unknown flag ${flag}`);
    }
  }

  return { options: { today, seed, scale: SCALES[scaleName] }, quiet };
}

export const HELP = `
Rebuild the development database from scratch.

  npm run db:reset [-- options]

  --today YYYY-MM-DD   Date the generated history ends on. Default ${PINNED_TODAY}.
                       On a demo day, pass $(date +%F) so reports read as current.
  --seed STRING        Random seed. Same seed plus same today gives an identical
                       database. Default "${DEFAULT_SEED}".
  --scale full|small|tiny
                       How much data to generate. "full" is production-shaped
                       (~43,000 members). "small" is about a twelfth of that and
                       builds in a couple of seconds. Default full.
  --quiet              Only print the summary line.
`;

// ---------------------------------------------------------------------------
// Calendar anchors
// ---------------------------------------------------------------------------

export interface RunSchedule {
  readonly period: BillingPeriod;
  /** The day the run is executed. Always the 25th of the period's month. */
  readonly runOn: PlainDate;
  readonly from: PlainDate;
  readonly to: PlainDate;
  /** False for the run that has not happened yet. */
  readonly completed: boolean;
}

export interface Anchors {
  readonly today: PlainDate;
  readonly todayYear: number;
  /** First day of the earliest month with generated history. */
  readonly historyFrom: PlainDate;
  /** Every payment run in the history, oldest first, plus the one now due. */
  readonly runs: readonly RunSchedule[];
  /** The most recent run that has already gone out. */
  readonly lastCompletedRun: RunSchedule;
  /** The run that is due next and has not been executed. */
  readonly nextRun: RunSchedule;
  readonly classesFrom: PlainDate;
  readonly classesTo: PlainDate;
  readonly accessFrom: PlainDate;
}

/** The day the run for `period` goes out. */
export function runDateFor(period: BillingPeriod): PlainDate {
  const { from } = billingPeriodRange(period);
  const { year, month } = partsOf(from);
  return plainDate(year, month, PAYMENT_RUN_DAY);
}

export function anchorsFor(options: SeedOptions): Anchors {
  const { today, scale } = options;
  const historyFrom = firstDayOfMonth(subMonths(today, scale.historyMonths));

  const runs: RunSchedule[] = [];
  let cursor = historyFrom;
  // Walk months forward until we pass the run that is currently due.
  for (let guard = 0; guard < scale.historyMonths + 4; guard += 1) {
    const period = billingPeriodOf(cursor);
    const range = billingPeriodRange(period);
    const runOn = runDateFor(period);
    runs.push({ period, runOn, from: range.from, to: range.to, completed: runOn <= today });
    if (runOn > today) break;
    cursor = addMonths(cursor, 1);
  }

  const completed = runs.filter((r) => r.completed);
  const lastCompletedRun = completed[completed.length - 1];
  const nextRun = runs.find((r) => !r.completed);
  if (lastCompletedRun === undefined || nextRun === undefined) {
    throw new Error('Seed history is too short to contain a completed and a due payment run');
  }

  return {
    today,
    todayYear: partsOf(today).year,
    historyFrom,
    runs,
    lastCompletedRun,
    nextRun,
    classesFrom: addDaysPlain(today, -scale.classDaysBack),
    classesTo: addDaysPlain(today, scale.classDaysForward),
    accessFrom: addDaysPlain(today, -scale.accessDaysBack),
  };
}

// Local alias so this module does not pull in the whole dates barrel twice.
function addDaysPlain(day: PlainDate, days: number): PlainDate {
  const { year, month, day: d } = partsOf(day);
  const dt = new Date(Date.UTC(year, month - 1, d + days));
  return plainDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
