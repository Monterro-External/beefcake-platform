'use server';

/**
 * The one write Beefcake admin has: turning a feature flag on or off for a
 * tenant. Impersonation is read-only, but "turn this on for us" is a support
 * request that arrives daily, and doing it through a database console is worse
 * than doing it here where it is logged.
 */

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { adminScope, tenantScope } from '@/db/repositories/scope';
import { setSetting } from '@/db/repositories/tenants';
import { recordEvent } from '@/db/repositories/observability';
import { FEATURE_FLAGS, type FeatureFlag, flagKey } from '@/domain/tenant-settings';
import { clock } from '@/lib/clock';
import { getSession } from '@/lib/session';
import type { ActionResult } from './subscriptions';

export async function setTenantFlag(
  tenantId: string,
  flag: string,
  enabled: boolean,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session.isBeefcakeStaff) {
    return { ok: false, message: 'Only Beefcake staff can change a tenant flag from admin.' };
  }
  if (!(FEATURE_FLAGS as readonly string[]).includes(flag)) {
    return { ok: false, message: `Unknown flag: ${flag}` };
  }

  const db = getDb();
  const tenant = db.select().from(tenants).where(eq(tenants.id, tenantId)).get();
  if (tenant === undefined) return { ok: false, message: 'No such tenant.' };

  const at = clock().now.toISOString();
  const scope = tenantScope(tenantId, { db, actorId: session.user.id, actorRole: 'beefcake_admin' });
  setSetting(scope, flagKey(flag as FeatureFlag), String(enabled), at);

  recordEvent(scope, {
    action: 'settings.changed',
    subjectType: 'flag',
    subjectId: flag,
    payload: { flag, enabled, changed_by: session.user.email, via: 'beefcake_admin' },
    at,
  });
  void adminScope({ db, actorId: session.user.id });

  revalidatePath('/admin', 'layout');
  revalidatePath('/app', 'layout');
  return { ok: true, message: `${flag} is now ${enabled ? 'on' : 'off'} for ${tenant.name}.` };
}
