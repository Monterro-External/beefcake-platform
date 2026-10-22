/**
 * The search and filters of "In dunning now", read from the page address.
 *
 * The address is the state (`q` today; `status`, `reason` and `site` follow),
 * so a link pasted to a colleague shows the same list. Unknown values are
 * ignored rather than turned into an empty list.
 */

import type { DunningFilter } from '@/export/reports';
import type { Locale } from '@/lib/format';
import { integer } from '@/lib/format';

export type DunningSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function readDunningFilter(params: DunningSearchParams): DunningFilter {
  const q = first(params.q)?.trim() ?? '';
  return q === '' ? {} : { q };
}

/** True when anything narrows open dunning, which switches on the count line and the 50-row cap. */
export function isFiltered(filter: DunningFilter): boolean {
  return filter.q !== undefined;
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
export function noMatch(filter: DunningFilter): string {
  return filter.q !== undefined
    ? `No one matching "${filter.q}" is in dunning now.`
    : 'No charges in dunning now match these filters.';
}
