'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

export interface NavItem {
  readonly href: string;
  readonly label: string;
}

/** The root of each surface, where "starts with" matching must not apply. */
const ROOTS = new Set(['/app', '/me', '/admin']);

export function MainNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname() ?? '';

  return (
    <nav className="order-3 flex w-full gap-1 sm:order-none sm:w-auto">
      {items.map((item) => {
        const isActive = ROOTS.has(item.href)
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'rounded px-2.5 py-1.5 font-medium whitespace-nowrap',
              isActive ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:text-ink',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
