/**
 * Structured logging into the database.
 *
 * `events` is the product-usage stream: who did what, per tenant. It is the
 * source for adoption and funnel reporting and it is exported for the commercial
 * side, so action names are treated as a public contract. Add a new one rather
 * than repurposing an old one.
 *
 * `errors` is for things that went wrong with a tenant attached, so support can
 * answer "is it just us" without a log search.
 *
 * Both are cheap synchronous inserts. If that ever shows up in a profile, batch
 * it, do not drop it.
 */

import { and, asc, count, desc, eq, gte, sql } from 'drizzle-orm';
import { newId } from '../ids';
import { errors, events, outbox } from '../schema';
import type { AdminScope, Scope, TenantScope } from './scope';

export type EventAction =
  | 'member.created'
  | 'member.blocked'
  | 'subscription.created'
  | 'subscription.plan_changed'
  | 'subscription.frozen'
  | 'subscription.cancelled'
  | 'subscription.cancellation_withdrawn'
  | 'booking.created'
  | 'booking.cancelled'
  | 'booking.waitlisted'
  | 'booking.promoted'
  | 'booking.attended'
  | 'payment_run.started'
  | 'payment_run.completed'
  | 'charge.succeeded'
  | 'charge.failed'
  | 'charge.retry_scheduled'
  | 'charge.abandoned'
  | 'access.checked_in'
  | 'access.denied'
  | 'access.sync_completed'
  | 'access.sync_failed'
  | 'report.viewed'
  | 'report.exported'
  | 'settings.changed'
  | 'member_app.session'
  | 'receipt.viewed'
  | 'impersonation.started';

export interface EventInput {
  readonly action: EventAction;
  readonly subjectType?: string;
  readonly subjectId?: string;
  readonly payload?: Record<string, unknown>;
  readonly at: string;
}

function tenantIdOf(scope: Scope): string | null {
  return scope.kind === 'tenant' ? scope.tenantId : null;
}

function actorRoleOf(scope: Scope): string | null {
  return scope.kind === 'tenant' ? scope.actorRole : 'beefcake_admin';
}

export function recordEvent(scope: Scope, input: EventInput): void {
  scope.db
    .insert(events)
    .values({
      id: newId('event'),
      tenantId: tenantIdOf(scope),
      actorId: scope.actorId,
      actorRole: actorRoleOf(scope),
      action: input.action,
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
      payloadJson: JSON.stringify(input.payload ?? {}),
      at: input.at,
    })
    .run();
}

export interface ErrorInput {
  readonly where: string;
  readonly message: string;
  readonly stack?: string | null;
  readonly severity?: 'warn' | 'error' | 'fatal';
  readonly context?: Record<string, unknown>;
  readonly at: string;
}

export function recordError(scope: Scope, input: ErrorInput): void {
  scope.db
    .insert(errors)
    .values({
      id: newId('error'),
      tenantId: tenantIdOf(scope),
      where: input.where,
      message: input.message,
      stack: input.stack ?? null,
      severity: input.severity ?? 'error',
      contextJson: JSON.stringify(input.context ?? {}),
      at: input.at,
    })
    .run();
}

export function listEvents(
  scope: TenantScope,
  filter: { action?: string; since?: string; limit?: number } = {},
) {
  const conditions = [eq(events.tenantId, scope.tenantId)];
  if (filter.action !== undefined) conditions.push(eq(events.action, filter.action));
  if (filter.since !== undefined) conditions.push(gte(events.at, filter.since));
  return scope.db
    .select()
    .from(events)
    .where(and(...conditions))
    .orderBy(desc(events.at))
    .limit(filter.limit ?? 100)
    .all();
}

export function listErrors(scope: TenantScope, filter: { since?: string; limit?: number } = {}) {
  const conditions = [eq(errors.tenantId, scope.tenantId)];
  if (filter.since !== undefined) conditions.push(gte(errors.at, filter.since));
  return scope.db
    .select()
    .from(errors)
    .where(and(...conditions))
    .orderBy(desc(errors.at))
    .limit(filter.limit ?? 100)
    .all();
}

export interface ErrorRollup {
  readonly tenantId: string | null;
  readonly where: string;
  readonly n: number;
  readonly lastAt: string;
}

/** Cross-tenant error rollup for the errors signal export. */
export function errorRollup(scope: AdminScope, since: string): ErrorRollup[] {
  return scope.db
    .select({
      tenantId: errors.tenantId,
      where: errors.where,
      n: count(),
      lastAt: sql<string>`max(${errors.at})`,
    })
    .from(errors)
    .where(gte(errors.at, since))
    .groupBy(errors.tenantId, errors.where)
    .orderBy(desc(count()))
    .all();
}

export interface OutboxInput {
  readonly channel: 'email' | 'sms' | 'payment' | 'access';
  readonly template?: string;
  readonly recipient?: string;
  readonly payload: Record<string, unknown>;
  readonly at: string;
}

export function enqueueOutbox(scope: Scope, input: OutboxInput): string {
  const id = newId('outbox');
  scope.db
    .insert(outbox)
    .values({
      id,
      tenantId: tenantIdOf(scope),
      channel: input.channel,
      template: input.template ?? null,
      recipient: input.recipient ?? null,
      payloadJson: JSON.stringify(input.payload),
      status: 'queued',
      at: input.at,
    })
    .run();
  return id;
}

export function listOutbox(
  scope: TenantScope,
  filter: { channel?: 'email' | 'sms' | 'payment' | 'access'; limit?: number } = {},
) {
  const conditions = [eq(outbox.tenantId, scope.tenantId)];
  if (filter.channel !== undefined) conditions.push(eq(outbox.channel, filter.channel));
  return scope.db
    .select()
    .from(outbox)
    .where(and(...conditions))
    .orderBy(desc(outbox.at))
    .limit(filter.limit ?? 100)
    .all();
}

export function eventCounts(scope: TenantScope, since: string) {
  return scope.db
    .select({ action: events.action, n: count() })
    .from(events)
    .where(and(eq(events.tenantId, scope.tenantId), gte(events.at, since)))
    .groupBy(events.action)
    .orderBy(asc(events.action))
    .all();
}
