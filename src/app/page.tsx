/**
 * Development landing page.
 *
 * Not part of the product: in production the three surfaces sit behind their own
 * hostnames and the persona switcher does not exist. This page is here so that
 * `npm run dev` gives you a door into each of them and tells you what state the
 * local database is in.
 */

import Link from 'next/link';
import { connection } from '@/db/client';
import { seedMeta, tenants } from '@/db/schema';
import { count } from 'drizzle-orm';

// Reads the local database, so it must not be prerendered at build time.
export const dynamic = 'force-dynamic';

interface Surface {
  href: string;
  name: string;
  who: string;
}

const SURFACES: Surface[] = [
  { href: '/app', name: 'Tenant app', who: 'Gym owners, site managers, front desk' },
  { href: '/me', name: 'Member app', who: 'Members: booking, subscription, receipts' },
  { href: '/admin', name: 'Beefcake admin', who: 'Support and CS, across all tenants' },
];

function readState(): { today: string; seed: string; scale: string; tenants: number } | null {
  try {
    const { db } = connection();
    const meta = db.select().from(seedMeta).get();
    if (meta === undefined) return null;
    const tenantCount = db.select({ n: count() }).from(tenants).get()?.n ?? 0;
    return { today: meta.today, seed: meta.seed, scale: meta.scale, tenants: tenantCount };
  } catch {
    return null;
  }
}

export default function DevHome() {
  const state = readState();

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Beefcake</h1>
      <p className="mt-1 text-ink-muted">Gym management, development environment.</p>

      <ul className="mt-10 divide-y divide-line border-y border-line">
        {SURFACES.map((surface) => (
          <li key={surface.href}>
            <Link
              href={surface.href}
              className="flex items-baseline justify-between gap-4 py-4 hover:text-accent"
            >
              <span className="font-medium">{surface.name}</span>
              <span className="text-right text-ink-muted">{surface.who}</span>
            </Link>
          </li>
        ))}
      </ul>

      <section className="mt-10 rounded border border-line bg-surface-raised p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Local database
        </h2>
        {state === null ? (
          <p className="mt-2">
            No seeded database found. Run{' '}
            <code className="rounded bg-accent-soft px-1 font-mono">npm run db:reset</code>.
          </p>
        ) : (
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1">
            <dt className="text-ink-muted">Today</dt>
            <dd className="font-mono">{state.today}</dd>
            <dt className="text-ink-muted">Seed</dt>
            <dd className="font-mono">{state.seed}</dd>
            <dt className="text-ink-muted">Scale</dt>
            <dd className="font-mono">{state.scale}</dd>
            <dt className="text-ink-muted">Tenants</dt>
            <dd className="font-mono">{state.tenants}</dd>
          </dl>
        )}
      </section>
    </main>
  );
}
