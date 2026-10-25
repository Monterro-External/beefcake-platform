/**
 * The search, Site dropdown and Status and Reason chips above an open-dunning
 * list. One component for the overview card and the Payments list: the caller
 * passes the path the links go to and what the open-dunning report returned.
 *
 * Chips are single-select links. The chosen chip is highlighted and choosing it
 * again clears it. A chip that would leave no charges, and isn't chosen, is
 * greyed out and is not a link. Each count applies every other filter and the
 * search, as the report counts them.
 */

import Link from 'next/link';
import { cn } from '@/lib/cn';
import type { AppliedDunningFilter, DunningStatus } from '@/db/repositories/payments';
import type { FailureCode } from '@/domain/retry-policy';
import { type Locale, humanise, integer } from '@/lib/format';
import { type SiteOption, dunningHref } from './filter';
import { DunningSearch, DunningSiteSelect } from './search';

export interface DunningFiltersProps {
  /** Where the links go, without parameters: `/app` or `/app/payments`. */
  readonly basePath: string;
  /** The filter the report applied. */
  readonly filter: AppliedDunningFilter;
  readonly statusCounts: Record<DunningStatus, number>;
  readonly reasonCounts: Record<FailureCode, number>;
  /** The tenant's sites, for the Site dropdown. */
  readonly sites: readonly SiteOption[];
  readonly locale: Locale;
}

// The chips say Retrying and Abandoned, never "Given up".
const STATUS_LABELS: Record<DunningStatus, string> = { retrying: 'Retrying', abandoned: 'Abandoned' };

const CHIP = 'rounded-full border px-2.5 py-0.5 text-xs';
const CHOSEN = cn(CHIP, 'border-accent bg-accent text-white');
const OPEN = cn(CHIP, 'border-line text-ink-muted hover:border-accent');

function Chip({ href, chosen, children }: { href: string; chosen: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} scroll={false} aria-current={chosen ? 'true' : undefined} className={chosen ? CHOSEN : OPEN}>
      {children}
    </Link>
  );
}

function CountChip({
  label,
  count,
  chosen,
  href,
  locale,
}: {
  label: string;
  count: number;
  chosen: boolean;
  href: string;
  locale: Locale;
}) {
  if (count === 0 && !chosen) {
    return (
      <span
        aria-disabled="true"
        title="No charges in dunning now match this together with the other filters"
        className={cn(OPEN, 'cursor-not-allowed opacity-40 hover:border-line')}
      >
        {label} 0
      </span>
    );
  }
  return (
    <Chip href={href} chosen={chosen}>
      {label} {integer(count, locale)}
    </Chip>
  );
}

export function DunningFilters({ basePath, filter, statusCounts, reasonCounts, sites, locale }: DunningFiltersProps) {
  const statuses = Object.keys(STATUS_LABELS) as DunningStatus[];
  const reasons = Object.keys(reasonCounts) as FailureCode[];
  return (
    <div className="mb-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <DunningSearch key={filter.q ?? ''} basePath={basePath} filter={filter} />
        <DunningSiteSelect basePath={basePath} filter={filter} sites={sites} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <div role="group" aria-label="Status" className="flex flex-wrap items-center gap-1.5">
          <Chip href={dunningHref(basePath, filter, { status: undefined })} chosen={filter.status === undefined}>
            Any status
          </Chip>
          {statuses.map((value) => (
            <CountChip
              key={value}
              label={STATUS_LABELS[value]}
              count={statusCounts[value]}
              chosen={filter.status === value}
              href={dunningHref(basePath, filter, { status: filter.status === value ? undefined : value })}
              locale={locale}
            />
          ))}
        </div>
        <span aria-hidden="true" className="mx-1 text-line">
          |
        </span>
        <div role="group" aria-label="Reason" className="flex flex-wrap items-center gap-1.5">
          <Chip href={dunningHref(basePath, filter, { reason: undefined })} chosen={filter.reason === undefined}>
            Any reason
          </Chip>
          {reasons.map((value) => (
            <CountChip
              key={value}
              label={humanise(value)}
              count={reasonCounts[value]}
              chosen={filter.reason === value}
              href={dunningHref(basePath, filter, { reason: filter.reason === value ? undefined : value })}
              locale={locale}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
