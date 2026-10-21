'use client';

/**
 * PROTOTYPE (BCPLA-34), throwaway. Search and filter controls that write to the
 * URL, the member list's GET-form pattern: Enter searches, a select applies.
 */

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Input, Select } from '@/components/ui';

function useApply() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (key: string, value: string) => {
    const merged = new URLSearchParams(params?.toString() ?? '');
    if (value === '') merged.delete(key);
    else merged.set(key, value);
    router.push(`${pathname}?${merged.toString()}`, { scroll: false });
  };
}

export function SearchBox({ value, big = false }: { value: string; big?: boolean }) {
  const apply = useApply();
  const [query, setQuery] = useState(value);
  return (
    <form
      className={big ? 'w-full' : 'min-w-56 flex-1'}
      onSubmit={(event) => {
        event.preventDefault();
        apply('q', query.trim());
      }}
    >
      <Input
        value={query}
        placeholder="Name, email, phone or card number"
        aria-label="Search members in dunning"
        className={big ? 'w-full px-3 py-2.5 text-base' : 'w-full'}
        onChange={(event) => setQuery(event.target.value)}
      />
    </form>
  );
}

export function FilterSelect({
  param,
  label,
  value,
  options,
  compact = false,
}: {
  param: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  compact?: boolean;
}) {
  const apply = useApply();
  return (
    <Select
      value={value}
      aria-label={label}
      className={compact ? 'px-1 py-0.5 text-xs font-normal normal-case' : undefined}
      onChange={(event) => apply(param, event.target.value)}
    >
      <option value="">{compact ? `${label}: all` : `All ${label.toLowerCase()}`}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  );
}
