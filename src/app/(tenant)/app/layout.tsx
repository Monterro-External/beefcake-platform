/**
 * The tenant app: what a gym operator uses all day.
 *
 * Every page below this layout runs with a tenant scope, so the layout is where
 * the "no tenant selected" case is handled once. Beefcake staff reach these
 * screens only through impersonation.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Callout } from '@/components/ui';
import { Shell, type NavItem } from '@/components/layout/shell';
import { type Permission, activeTenant, can, getSession } from '@/lib/session';

/**
 * The navigation, per item, with the permission it needs. Front desk does not
 * get a Payments tab they will only be told off for opening.
 */
const NAV: (NavItem & { needs?: Permission })[] = [
  { href: '/app', label: 'Overview' },
  { href: '/app/members', label: 'Members', needs: 'members.read' },
  { href: '/app/classes', label: 'Classes' },
  { href: '/app/payments', label: 'Payments', needs: 'payments.read' },
  { href: '/app/access', label: 'Access', needs: 'access.read' },
  { href: '/app/reports', label: 'Reports', needs: 'reports.read' },
  { href: '/app/settings', label: 'Settings', needs: 'settings.read' },
];

export default async function TenantLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  const tenant = activeTenant(session);
  const nav = NAV.filter((item) => item.needs === undefined || can(session, item.needs));

  if (tenant === null) {
    return (
      <Shell session={session} nav={nav} surface="tenant">
        <Callout tone="warn" title="No tenant selected">
          You are signed in as Beefcake staff. Pick a tenant from{' '}
          <Link href="/admin" className="underline">
            Beefcake admin
          </Link>{' '}
          to look at their data, or switch to a tenant user with the persona picker.
        </Callout>
      </Shell>
    );
  }

  return (
    <Shell session={session} nav={nav} surface="tenant">
      {children}
    </Shell>
  );
}
