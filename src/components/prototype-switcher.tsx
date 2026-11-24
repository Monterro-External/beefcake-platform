'use client';

/** PROTOTYPE, throwaway: floating variant switcher for ?variant= prototypes. Hidden in production. */

import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export function PrototypeSwitcher({ variants }: { variants: { key: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get('variant') ?? variants[0]!.key;
  const index = Math.max(0, variants.findIndex((v) => v.key === current));

  const go = (delta: number) => {
    const next = variants[(index + delta + variants.length) % variants.length]!;
    const search = new URLSearchParams(params.toString());
    search.set('variant', next.key);
    router.replace(`${pathname}?${search.toString()}`, { scroll: false });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return;
      if (el instanceof HTMLElement && el.isContentEditable) return;
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (process.env.NODE_ENV === 'production') return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-ink px-4 py-2 text-surface shadow-lg">
      <button type="button" aria-label="Previous variant" onClick={() => go(-1)} className="px-2">
        ←
      </button>
      <span className="font-mono text-xs">
        {variants[index]!.key} ({variants[index]!.name})
      </span>
      <button type="button" aria-label="Next variant" onClick={() => go(1)} className="px-2">
        →
      </button>
    </div>
  );
}
