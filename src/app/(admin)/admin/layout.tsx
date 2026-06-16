/**
 * Beefcake admin: what our own support and CS team use.
 *
 * The only surface with a cross-tenant view. Everything here reads through an
 * `AdminScope`, and looking at one tenant's data in detail means impersonating,
 * which is logged and read-only.
 */

import type { ReactNode } from 'react';
import { Callout } from '@/components/ui';
import { Shell, type NavItem } from '@/components/layout/shell';
import { getSession } from '@/lib/session';

const NAV: NavItem[] = [
  { href: '/admin', label: 'Tenants' },
  { href: '/admin/health', label: 'Health' },
  { href: '/admin/errors', label: 'Errors' },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await getSession();

  if (!session.isBeefcakeStaff) {
    return (
      <Shell session={session} nav={NAV} surface="admin">
        <Callout tone="warn" title="Beefcake staff only">
          Switch to a Beefcake account with the persona picker in the header.
        </Callout>
      </Shell>
    );
  }

  return (
    <Shell session={session} nav={NAV} surface="admin">
      {children}
    </Shell>
  );
}
