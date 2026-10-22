'use client';

/**
 * The search field and the Site dropdown of "In dunning now". Enter runs the
 * search; the term goes into `q` in the address, trimmed, and a term of only
 * spaces removes it. Choosing a site applies at once. The other filters are
 * kept and paging starts again.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Input, Select } from '@/components/ui';
import type { AppliedDunningFilter } from '@/export/reports';
import { type SiteOption, dunningHref } from './filter';

export function DunningSearch({ basePath, filter }: { basePath: string; filter: AppliedDunningFilter }) {
  const router = useRouter();
  const [term, setTerm] = useState(filter.q ?? '');

  return (
    <form
      role="search"
      className="min-w-56 flex-1"
      onSubmit={(event) => {
        event.preventDefault();
        router.push(dunningHref(basePath, filter, { q: term.trim() }), { scroll: false });
      }}
    >
      <Input
        type="search"
        value={term}
        placeholder="Name, email, phone or card number"
        aria-label="Search members in dunning"
        className="w-full"
        onChange={(event) => setTerm(event.target.value)}
      />
    </form>
  );
}

export function DunningSiteSelect({
  basePath,
  filter,
  sites,
}: {
  basePath: string;
  filter: AppliedDunningFilter;
  sites: readonly SiteOption[];
}) {
  const router = useRouter();
  return (
    <Select
      value={filter.site ?? ''}
      aria-label="Site"
      onChange={(event) => router.push(dunningHref(basePath, filter, { site: event.target.value }), { scroll: false })}
    >
      <option value="">All sites</option>
      {sites.map((site) => (
        <option key={site.id} value={site.id}>
          {site.name}
        </option>
      ))}
    </Select>
  );
}
