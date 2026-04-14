'use server';

/**
 * Running the payment run from the app.
 *
 * The same job the scheduler runs, scoped to one tenant, invoked by an owner who
 * wants it done now rather than tonight. Idempotent per period, so the worst a
 * double click does is process retries twice.
 */

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db/client';
import { runJob } from '@/jobs/runner';
import { paymentRunJob } from '@/jobs/payment-run';
import { clock } from '@/lib/clock';
import { activeTenant, getSession, requirePermission } from '@/lib/session';
import type { ActionResult } from './subscriptions';

export async function runPaymentsNow(): Promise<ActionResult> {
  const session = await getSession();
  requirePermission(session, 'payments.run');
  const tenant = activeTenant(session);
  if (tenant === null) return { ok: false, message: 'No tenant selected.' };

  const result = runJob(paymentRunJob, {
    now: clock().now,
    tenantId: tenant.id,
    quiet: true,
    db: getDb(),
  });

  revalidatePath('/app', 'layout');

  const summary = result.summary;
  if (summary.runsCreated === 0 && summary.retriesAttempted === 0) {
    return { ok: true, message: 'Nothing to do: this period has already been billed.' };
  }

  const parts: string[] = [];
  if ((summary.runsCreated as number) > 0) {
    parts.push(
      `charged ${summary.charged}, ${summary.succeeded} paid, ${summary.failed} failed`,
    );
  }
  if ((summary.retriesAttempted as number) > 0) {
    parts.push(`retried ${summary.retriesAttempted}, recovered ${summary.retriesRecovered}`);
  }
  if ((summary.partialRunsDiscarded as number) > 0) {
    parts.push('discarded a run a previous attempt left half finished');
  }
  return { ok: true, message: `Done: ${parts.join('; ')}.` };
}
