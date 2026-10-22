'use client';

/**
 * The search field of "In dunning now". Enter runs the search; the term goes
 * into `q` in the address, trimmed, and a term of only spaces removes it. Any
 * other parameters in the address are kept, apart from the page.
 */

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Input } from '@/components/ui';

export function DunningSearch({ q }: { q: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [term, setTerm] = useState(q);

  return (
    <form
      role="search"
      className="mb-2"
      onSubmit={(event) => {
        event.preventDefault();
        const next = new URLSearchParams(params?.toString() ?? '');
        const trimmed = term.trim();
        if (trimmed === '') next.delete('q');
        else next.set('q', trimmed);
        // A new search starts from the first page.
        next.delete('page');
        router.push(`${pathname}${next.size === 0 ? '' : `?${next.toString()}`}`, { scroll: false });
      }}
    >
      <Input
        type="search"
        value={term}
        placeholder="Name, email, phone or card number"
        aria-label="Search members in dunning"
        onChange={(event) => setTerm(event.target.value)}
      />
    </form>
  );
}
