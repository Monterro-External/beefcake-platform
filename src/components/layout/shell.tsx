/**
 * The frame every surface sits in: a product name, the navigation for that
 * surface, and the development-only persona bar.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui';
import { MainNav, type NavItem } from './main-nav';
import { PersonaSwitcher } from './persona-switcher';
import { StopImpersonating } from './stop-impersonating';
import { type Session, type Surface, personaOptions, roleLabel } from '@/lib/session';

export type { NavItem };

export function Shell({
  session,
  nav,
  surface,
  children,
}: {
  session: Session;
  nav: readonly NavItem[];
  surface: Surface;
  children: ReactNode;
}) {
  const contextName =
    surface === 'admin'
      ? 'Beefcake admin'
      : surface === 'member'
        ? (session.member?.name ?? 'Member')
        : (session.isBeefcakeStaff ? session.impersonating?.name : session.tenant?.name) ?? 'Beefcake';

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface-raised">
        <div className="mx-auto flex max-w-[92rem] flex-wrap items-center gap-x-6 gap-y-2 px-6 py-2.5">
          <Link href="/" className="font-semibold tracking-tight">
            Beefcake
          </Link>
          <span className="text-ink-muted">{contextName}</span>
          {session.impersonating !== null && (
            <Badge tone="warn">Read-only, impersonating</Badge>
          )}

          <MainNav items={nav} />

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-ink-muted sm:inline">
              {session.user.name}
              {' · '}
              {roleLabel(session.user.role)}
            </span>
            {session.impersonating !== null && <StopImpersonating />}
            <PersonaSwitcher
              options={personaOptions(session.user.id)}
              currentUserId={session.user.id}
              surface={surface}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[92rem] px-6 py-6">{children}</main>
    </div>
  );
}
