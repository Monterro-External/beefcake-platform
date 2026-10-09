'use client';

/**
 * A week of days either side of the one being viewed. Keyboard-reachable links
 * rather than a calendar widget: a site manager moves one day at a time.
 */

import Link from 'next/link';
import { cn } from '@/lib/cn';

function shift(day: string, days: number): string {
  // eslint-disable-next-line no-restricted-syntax -- BCPLA-26: weekday arithmetic on a plain date; UTC is correct here, move to a dates helper
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function DayPicker({ day, today, siteId }: { day: string; today: string; siteId: string }) {
  const days = Array.from({ length: 15 }, (_, i) => shift(day, i - 7));
  const href = (target: string): string =>
    `/app/classes?day=${target}${siteId === '' ? '' : `&site=${siteId}`}`;

  return (
    <div className="flex items-stretch gap-1 overflow-x-auto">
      <Link
        href={href(shift(day, -7))}
        className="rounded border border-line px-2 py-1.5 text-ink-muted hover:bg-accent-soft"
        aria-label="Previous week"
      >
        &larr;
      </Link>
      {days.map((candidate) => {
        const isCurrent = candidate === day;
        const isToday = candidate === today;
        // eslint-disable-next-line no-restricted-syntax -- BCPLA-26: weekday of a plain date; UTC is correct here, move to a dates helper
        const weekday = WEEKDAYS[new Date(`${candidate}T00:00:00Z`).getUTCDay()] ?? '';
        return (
          <Link
            key={candidate}
            href={href(candidate)}
            aria-current={isCurrent ? 'date' : undefined}
            className={cn(
              'min-w-14 rounded border px-2 py-1 text-center',
              isCurrent
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-line hover:bg-accent-soft',
            )}
          >
            <span className="block text-2xs uppercase tracking-wide text-ink-muted">{weekday}</span>
            <span className="block tabular-nums">{candidate.slice(8)}</span>
            {isToday && <span className="block text-2xs text-accent">today</span>}
          </Link>
        );
      })}
      <Link
        href={href(shift(day, 7))}
        className="rounded border border-line px-2 py-1.5 text-ink-muted hover:bg-accent-soft"
        aria-label="Next week"
      >
        &rarr;
      </Link>
    </div>
  );
}
