/**
 * PROTOTYPE (BCPLA-34), throwaway. Three structurally different takes on the
 * "In dunning now" card with search and filters:
 *
 *   A  Toolbar          search and selects above the table, count under them
 *   B  Column headers   controls live in the headers they filter, count in the footer
 *   C  Search first     a big "is this member in dunning?" field, facet chips with counts
 *
 * Mounted on the overview at /app?variant=A|B|C. Unfiltered, every variant shows
 * today's 8 rows; filtered, up to 50 rows plus the count line.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge, Card, TD, TH, THead, TR, Table } from '@/components/ui';
import { ago, amountCompact, humanise, integer, type Locale } from '@/lib/format';
import { FAILURE_CODES } from '@/domain/retry-policy';
import { FilterSelect, SearchBox } from './controls';
import type { DunningFilter, DunningPage } from './query';

export interface VariantProps {
  readonly variant: string;
  readonly filter: DunningFilter;
  readonly filtered: boolean;
  readonly page: DunningPage;
  readonly sites: { id: string; name: string }[];
  readonly facets: { byStatus: { key: string | null; n: number }[]; byReason: { key: string | null; n: number }[] };
  readonly seesPayments: boolean;
  readonly now: Date;
  readonly locale: Locale;
}

const STATUS_OPTIONS = [
  { value: 'retrying', label: 'Retrying' },
  { value: 'abandoned', label: 'Abandoned' },
];
const REASON_OPTIONS = FAILURE_CODES.map((code) => ({ value: code, label: humanise(code) }));

function plural(n: number, one: string, many: string, locale: Locale): string {
  return `${integer(n, locale)} ${n === 1 ? one : many}`;
}

function countLine({ page, locale }: VariantProps): string {
  const charges = plural(page.charges, 'matching charge', 'matching charges', locale);
  const members = plural(page.members, 'member', 'members', locale);
  return page.rows.length < page.charges
    ? `Showing ${integer(page.rows.length, locale)} of ${charges} · ${members}`
    : `${charges} · ${members}`;
}

function paymentsLink(props: VariantProps): ReactNode {
  if (!props.seesPayments || !props.filtered) return null;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(props.filter)) if (value !== '') params.set(key, value);
  return (
    <Link href={`/app/payments?${params.toString()}#dunning`} className="text-accent">
      See all on Payments
    </Link>
  );
}

function NoMatch({ filter, variant }: { filter: DunningFilter; variant: string }) {
  return (
    <div className="py-6 text-center">
      <p>
        {filter.q !== ''
          ? `No one matching "${filter.q}" is in dunning now.`
          : 'No charges in dunning now match these filters.'}
      </p>
      <Link href={`/app?variant=${variant}`} className="text-accent">
        Clear search and filters
      </Link>
    </div>
  );
}

function statusBadge(status: string) {
  return <Badge tone={status === 'abandoned' ? 'bad' : 'warn'}>{humanise(status)}</Badge>;
}

function nextAttempt(row: DunningPage['rows'][number], now: Date): string {
  return row.status === 'abandoned' ? 'no further attempts' : ago(row.nextAttemptAt, now);
}

function Body({ props, children }: { props: VariantProps; children: ReactNode }) {
  if (props.page.rows.length === 0) {
    return props.filtered ? (
      <NoMatch filter={props.filter} variant={props.variant} />
    ) : (
      <p className="py-4 text-center text-ink-muted">Nothing outstanding.</p>
    );
  }
  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// A: toolbar
// ---------------------------------------------------------------------------

export function VariantA(props: VariantProps) {
  const { filter, page, sites, now, locale } = props;
  return (
    <Card
      title="In dunning now"
      actions={props.seesPayments ? <Link href="/app/payments" className="text-accent">All payments</Link> : undefined}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <SearchBox value={filter.q} />
        <FilterSelect param="status" label="Statuses" value={filter.status} options={STATUS_OPTIONS} />
        <FilterSelect param="reason" label="Reasons" value={filter.reason} options={REASON_OPTIONS} />
        <FilterSelect
          param="site"
          label="Sites"
          value={filter.site}
          options={sites.map((site) => ({ value: site.id, label: site.name }))}
        />
      </div>
      {props.filtered && page.rows.length > 0 && (
        <div className="mb-2 flex items-center justify-between text-ink-muted">
          <span>{countLine(props)}</span>
          {paymentsLink(props)}
        </div>
      )}
      <Body props={props}>
        <Table>
          <THead>
            <TR>
              <TH>Member</TH>
              <TH align="right">Amount</TH>
              <TH>Reason</TH>
              <TH align="right">Attempt</TH>
              <TH>Next attempt</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <tbody>
            {page.rows.map((row) => (
              <TR key={`${row.memberId}-${row.attemptedAt}`}>
                <TD>
                  <Link href={`/app/members/${row.memberId}`} className="text-accent">
                    {row.memberName}
                  </Link>
                </TD>
                <TD align="right" mono>
                  {amountCompact(row.amountMinor, row.currency, locale)}
                </TD>
                <TD>{humanise(row.failureCode)}</TD>
                <TD align="right">{row.attempt}</TD>
                <TD className="text-ink-muted">{nextAttempt(row, now)}</TD>
                <TD>{statusBadge(row.status)}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </Body>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// B: controls in the column headers
// ---------------------------------------------------------------------------

export function VariantB(props: VariantProps) {
  const { filter, page, sites, now, locale } = props;
  return (
    <Card
      title="In dunning now"
      actions={
        <div className="flex items-center gap-3">
          <FilterSelect
            param="site"
            label="Site"
            compact
            value={filter.site}
            options={sites.map((site) => ({ value: site.id, label: site.name }))}
          />
          {props.seesPayments && (
            <Link href="/app/payments" className="text-accent">
              All payments
            </Link>
          )}
        </div>
      }
      footer={
        props.filtered && page.rows.length > 0 ? (
          <div className="flex items-center justify-between">
            <span>{countLine(props)}</span>
            {paymentsLink(props)}
          </div>
        ) : undefined
      }
    >
      <Table>
        <THead>
          <TR>
            <TH>
              <div className="flex flex-col gap-1">
                <span>Member</span>
                <SearchBox value={filter.q} />
              </div>
            </TH>
            <TH align="right">Amount</TH>
            <TH>
              <div className="flex flex-col gap-1">
                <span>Reason</span>
                <FilterSelect param="reason" label="Reason" compact value={filter.reason} options={REASON_OPTIONS} />
              </div>
            </TH>
            <TH align="right">Attempt</TH>
            <TH>Next attempt</TH>
            <TH>
              <div className="flex flex-col gap-1">
                <span>Status</span>
                <FilterSelect param="status" label="Status" compact value={filter.status} options={STATUS_OPTIONS} />
              </div>
            </TH>
          </TR>
        </THead>
        <tbody>
          {page.rows.map((row) => (
            <TR key={`${row.memberId}-${row.attemptedAt}`}>
              <TD>
                <Link href={`/app/members/${row.memberId}`} className="text-accent">
                  {row.memberName}
                </Link>
              </TD>
              <TD align="right" mono>
                {amountCompact(row.amountMinor, row.currency, locale)}
              </TD>
              <TD>{humanise(row.failureCode)}</TD>
              <TD align="right">{row.attempt}</TD>
              <TD className="text-ink-muted">{nextAttempt(row, now)}</TD>
              <TD>{statusBadge(row.status)}</TD>
            </TR>
          ))}
        </tbody>
      </Table>
      {page.rows.length === 0 && <Body props={props}>{null}</Body>}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// C: search first, facet chips
// ---------------------------------------------------------------------------

function chipHref(filter: DunningFilter, variant: string, key: keyof DunningFilter, value: string): string {
  const params = new URLSearchParams({ variant });
  for (const [name, current] of Object.entries({ ...filter, [key]: value })) if (current !== '') params.set(name, current);
  return `/app?${params.toString()}`;
}

function Chip({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      className={
        active
          ? 'rounded-full border border-accent bg-accent px-2.5 py-0.5 text-xs text-white'
          : 'rounded-full border border-line px-2.5 py-0.5 text-xs text-ink-muted hover:border-accent'
      }
    >
      {children}
    </Link>
  );
}

export function VariantC(props: VariantProps) {
  const { filter, page, sites, facets, now, locale, variant } = props;
  const n = (list: { key: string | null; n: number }[], key: string) => list.find((row) => row.key === key)?.n ?? 0;
  return (
    <Card
      title="Is this member in dunning?"
      actions={props.seesPayments ? <Link href="/app/payments" className="text-accent">All payments</Link> : undefined}
    >
      <SearchBox value={filter.q} big />
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Chip href={chipHref(filter, variant, 'status', '')} active={filter.status === ''}>
          Any status
        </Chip>
        {STATUS_OPTIONS.map((option) => (
          <Chip
            key={option.value}
            href={chipHref(filter, variant, 'status', filter.status === option.value ? '' : option.value)}
            active={filter.status === option.value}
          >
            {option.label} {integer(n(facets.byStatus, option.value), locale)}
          </Chip>
        ))}
        <span className="mx-1 text-line">|</span>
        {REASON_OPTIONS.map((option) => (
          <Chip
            key={option.value}
            href={chipHref(filter, variant, 'reason', filter.reason === option.value ? '' : option.value)}
            active={filter.reason === option.value}
          >
            {option.label} {integer(n(facets.byReason, option.value), locale)}
          </Chip>
        ))}
        <span className="ml-auto">
          <FilterSelect
            param="site"
            label="Sites"
            value={filter.site}
            options={sites.map((site) => ({ value: site.id, label: site.name }))}
          />
        </span>
      </div>
      {props.filtered && page.rows.length > 0 && (
        <p className="mt-3 text-base font-medium">
          {countLine(props)} <span className="text-sm font-normal">{paymentsLink(props)}</span>
        </p>
      )}
      <div className="mt-2">
        <Body props={props}>
          <ul className="divide-y divide-line">
            {page.rows.map((row) => (
              <li key={`${row.memberId}-${row.attemptedAt}`} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <Link href={`/app/members/${row.memberId}`} className="text-accent">
                    {row.memberName}
                  </Link>
                  <div className="truncate text-xs text-ink-muted">
                    {row.email}
                    {row.cardId !== null ? ` · card ${row.cardId}` : ''}
                  </div>
                </div>
                <div className="w-40 text-xs text-ink-muted">
                  {humanise(row.failureCode)} · attempt {row.attempt}
                  <br />
                  {nextAttempt(row, now)}
                </div>
                <div className="w-20 text-right font-mono">
                  {amountCompact(row.amountMinor, row.currency, locale)}
                </div>
                <div className="w-24 text-right">{statusBadge(row.status)}</div>
              </li>
            ))}
          </ul>
        </Body>
      </div>
    </Card>
  );
}
