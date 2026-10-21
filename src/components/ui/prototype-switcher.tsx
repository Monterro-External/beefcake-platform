'use client';

/**
 * PROTOTYPE switcher: a floating bar that cycles `?variant=`. Throwaway; never
 * renders in a production build.
 */

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

export function PrototypeSwitcher({
  variants,
  current,
}: {
  variants: { key: string; name: string }[];
  current: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const index = Math.max(0, variants.findIndex((variant) => variant.key === current));

  function go(step: number): void {
    const next = variants[(index + step + variants.length) % variants.length];
    if (next === undefined) return;
    const merged = new URLSearchParams(params?.toString() ?? '');
    merged.set('variant', next.key);
    router.replace(`${pathname}?${merged.toString()}`, { scroll: false });
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable]')) return;
      if (event.key === 'ArrowLeft') go(-1);
      if (event.key === 'ArrowRight') go(1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (process.env.NODE_ENV === 'production') return null;
  const variant = variants[index];
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-black px-4 py-2 text-sm text-white shadow-lg">
      <button type="button" aria-label="Previous variant" onClick={() => go(-1)}>
        ←
      </button>
      <span className="font-mono">
        PROTOTYPE {variant?.key} ({variant?.name})
      </span>
      <button type="button" aria-label="Next variant" onClick={() => go(1)}>
        →
      </button>
    </div>
  );
}
