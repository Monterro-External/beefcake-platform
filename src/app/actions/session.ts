'use server';

/**
 * Server actions for the development session. Not part of the product.
 */

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { tenants, users } from '@/db/schema';
import { adminScope } from '@/db/repositories/scope';
import { recordEvent } from '@/db/repositories/observability';
import { IMPERSONATION_COOKIE, SESSION_COOKIE, SURFACE_PATHS, type Surface, getSession } from '@/lib/session';

const YEAR_IN_SECONDS = 60 * 60 * 24 * 365;

/** Impersonation is only meaningful in the tenant app, so its cookie lives there. */
const IMPERSONATION_PATH = SURFACE_PATHS.tenant;

/**
 * Become `userId` on one surface. The cookie is scoped to that surface's path,
 * which is what keeps a member picked in the `/me` tab from following you into
 * an `/admin` tab. See `SESSION_COOKIE`.
 */
export async function switchPersona(userId: string, surface: Surface): Promise<void> {
  const path: string | undefined = SURFACE_PATHS[surface];
  if (path === undefined) throw new Error(`No such surface: ${String(surface)}`);

  const db = getDb();
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (user === undefined) throw new Error(`No such user: ${userId}`);

  const jar = await cookies();
  jar.set(SESSION_COOKIE, userId, { path, maxAge: YEAR_IN_SECONDS, httpOnly: true });
  // Leaving staff clears any impersonation, so a tenant user never inherits it.
  if (user.role !== 'beefcake_admin') jar.delete({ name: IMPERSONATION_COOKIE, path: IMPERSONATION_PATH });

  revalidatePath('/', 'layout');
}

/**
 * Start looking at one tenant as Beefcake staff.
 *
 * Read-only by construction: `can()` refuses every write permission while
 * `isBeefcakeStaff` is true. The event is recorded because "who looked at our
 * data" is a question customers ask.
 */
export async function startImpersonation(tenantId: string): Promise<void> {
  const session = await getSession();
  if (!session.isBeefcakeStaff) throw new Error('Only Beefcake staff can impersonate a tenant');

  const db = getDb();
  const tenant = db.select().from(tenants).where(eq(tenants.id, tenantId)).get();
  if (tenant === undefined) throw new Error(`No such tenant: ${tenantId}`);

  const jar = await cookies();
  // The redirect lands in the tenant app, whose persona may be someone else
  // entirely. Impersonation only works as staff, so the tenant app becomes this
  // staff user too, for as long as the impersonation lasts.
  jar.set(SESSION_COOKIE, session.user.id, { path: IMPERSONATION_PATH, maxAge: YEAR_IN_SECONDS, httpOnly: true });
  jar.set(IMPERSONATION_COOKIE, tenantId, { path: IMPERSONATION_PATH, maxAge: 60 * 60 * 8, httpOnly: true });

  recordEvent(adminScope({ db, actorId: session.user.id }), {
    action: 'impersonation.started',
    subjectType: 'tenant',
    subjectId: tenantId,
    payload: { mode: 'read_only', actor: session.user.email },
    at: new Date().toISOString(),
  });

  revalidatePath('/', 'layout');
  redirect('/app');
}

export async function stopImpersonation(): Promise<void> {
  const jar = await cookies();
  jar.delete({ name: IMPERSONATION_COOKIE, path: IMPERSONATION_PATH });
  revalidatePath('/', 'layout');
  redirect('/admin');
}
