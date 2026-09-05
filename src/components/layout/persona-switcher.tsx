'use client';

/**
 * The development persona switcher.
 *
 * Not part of the product. It exists because there is no real authentication in
 * this repo, and because being able to look at the same screen as an owner, a
 * site manager and a front desk user in three clicks is the fastest way to spot
 * a permission mistake.
 */

import { useTransition } from 'react';
import { Select } from '@/components/ui';
import type { PersonaOption, Surface } from '@/lib/session';
import { switchPersona } from '@/app/actions/session';

export function PersonaSwitcher({
  options,
  currentUserId,
  surface,
}: {
  options: PersonaOption[];
  currentUserId: string;
  /** The choice applies to this surface only; other tabs keep theirs. */
  surface: Surface;
}) {
  const [pending, startTransition] = useTransition();

  const groups = new Map<string, PersonaOption[]>();
  for (const option of options) {
    const key = option.tenantName ?? 'Beefcake';
    const list = groups.get(key) ?? [];
    list.push(option);
    groups.set(key, list);
  }

  return (
    <label className="flex items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-ink-muted">Acting as</span>
      <Select
        value={currentUserId}
        disabled={pending}
        aria-label="Acting as"
        onChange={(event) => {
          const userId = event.target.value;
          startTransition(async () => {
            await switchPersona(userId, surface);
          });
        }}
      >
        {[...groups].map(([group, entries]) => (
          <optgroup key={group} label={group}>
            {entries.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name} ({option.role.replace(/_/g, ' ')})
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
    </label>
  );
}
