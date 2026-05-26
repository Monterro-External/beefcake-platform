/**
 * The member app.
 *
 * Deliberately small. A member wants four things: book a class, see what they
 * are paying, freeze or cancel, and get through the door. Everything else is the
 * operator's problem.
 */

import type { ReactNode } from 'react';
import { Callout } from '@/components/ui';
import { Shell, type NavItem } from '@/components/layout/shell';
import { getSession } from '@/lib/session';

const NAV: NavItem[] = [
  { href: '/me', label: 'Schedule' },
  { href: '/me/subscription', label: 'My membership' },
  { href: '/me/receipts', label: 'Receipts' },
  { href: '/me/card', label: 'Access' },
];

export default async function MemberLayout({ children }: { children: ReactNode }) {
  const session = await getSession();

  if (session.member === null) {
    return (
      <Shell session={session} nav={NAV} surface="member">
        <Callout tone="warn" title="Not signed in as a member">
          Pick a member from the persona switcher in the header. The seed creates a few login
          accounts per operator.
        </Callout>
      </Shell>
    );
  }

  return (
    <Shell session={session} nav={NAV} surface="member">
      {children}
    </Shell>
  );
}
