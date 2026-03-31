'use client';

/**
 * Search and filter bar for the member list.
 *
 * A plain GET form, so the filters live in the URL. Front desk pastes these
 * links to each other and support asks for them in tickets.
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Button, Input, Select } from '@/components/ui';

export function MemberFilters({
  sites,
  search,
  siteId,
  status,
}: {
  sites: { id: string; name: string }[];
  search: string;
  siteId: string;
  status: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState(search);

  function apply(next: Record<string, string>): void {
    const merged = new URLSearchParams(params?.toString() ?? '');
    for (const [key, value] of Object.entries(next)) {
      if (value === '') merged.delete(key);
      else merged.set(key, value);
    }
    // Any change to a filter puts you back on the first page.
    merged.delete('page');
    router.push(`/app/members${merged.size === 0 ? '' : `?${merged.toString()}`}`);
  }

  return (
    <form
      className="mb-3 flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        apply({ q: query.trim() });
      }}
    >
      <div className="min-w-56 flex-1">
        <Input
          value={query}
          placeholder="Name, email, phone or card number"
          aria-label="Search members"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <Select
        value={siteId}
        aria-label="Site"
        onChange={(event) => apply({ site: event.target.value })}
      >
        <option value="">All sites</option>
        {sites.map((site) => (
          <option key={site.id} value={site.id}>
            {site.name}
          </option>
        ))}
      </Select>

      <Select
        value={status}
        aria-label="Status"
        onChange={(event) => apply({ status: event.target.value })}
      >
        <option value="">Any status</option>
        <option value="active">Active</option>
        <option value="blocked">Blocked</option>
        <option value="former">Archived</option>
      </Select>

      <Button type="submit" variant="primary">
        Search
      </Button>
      {(search !== '' || siteId !== '' || status !== '') && (
        <Button
          onClick={() => {
            setQuery('');
            router.push('/app/members');
          }}
        >
          Clear
        </Button>
      )}
    </form>
  );
}
