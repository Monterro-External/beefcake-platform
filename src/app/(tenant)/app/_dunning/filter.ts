/**
 * The search and filters of "In dunning now", read from the page address.
 *
 * The address is the state (`q`, `status`, `reason`, `site`), so a link pasted
 * to a colleague shows the same list. The open-dunning report ignores values it
 * does not know rather than turning them into an empty list, and says which
 * filter it applied; links are built from that applied filter.
 */

import type { AppliedDunningFilter, DunningFilter } from '@/export/reports';
import type { Locale } from '@/lib/format';
import { integer } from '@/lib/format';

export type DunningSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The filter as the address gives it. The report decides which values it knows. */
export function readDunningFilter(params: DunningSearchParams): DunningFilter {
  const filter: { q?: string; status?: string; reason?: string; site?: string } = {};
  for (const key of DUNNING_PARAMS) {
    const value = first(params[key])?.trim() ?? '';
    if (value !== '') filter[key] = value;
  }
  return filter;
}

/** The address parameters, in the order links write them. */
const DUNNING_PARAMS = ['q', 'status', 'reason', 'site'] as const;

/**
 * The address of the list with one part of the filter changed (`undefined`
 * clears it). Paging starts again, so `page` is never carried over.
 */
export function dunningHref(
  basePath: string,
  filter: AppliedDunningFilter,
  change: Partial<Record<(typeof DUNNING_PARAMS)[number], string | undefined>> = {},
): string {
  const next = { ...filter, ...change };
  const params = new URLSearchParams();
  for (const key of DUNNING_PARAMS) {
    const value = next[key];
    if (value !== undefined && value !== '') params.set(key, value);
  }
  return params.size === 0 ? basePath : `${basePath}?${params.toString()}`;
}

/** True when anything narrows open dunning, which switches on the count line and the 50-row cap. */
export function isFiltered(filter: AppliedDunningFilter): boolean {
  return DUNNING_PARAMS.some((key) => filter[key] !== undefined);
}

function plural(n: number, one: string, many: string, locale: Locale): string {
  return `${integer(n, locale)} ${n === 1 ? one : many}`;
}

/** "Showing 50 of 478 matching charges · 243 members", or "3 matching charges · 1 member" when all fit. */
export function countLine(shown: number, charges: number, members: number, locale: Locale): string {
  const matching = `${plural(charges, 'matching charge', 'matching charges', locale)} · ${plural(members, 'member', 'members', locale)}`;
  return shown < charges ? `Showing ${integer(shown, locale)} of ${matching}` : matching;
}

/** What an empty filtered list says. It never suggests the member has paid. */
export function noMatch(filter: AppliedDunningFilter): string {
  return filter.q !== undefined
    ? `No one matching "${filter.q}" is in dunning now.`
    : 'No charges in dunning now match these filters.';
}
