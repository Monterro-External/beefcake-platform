'use server';

/**
 * Everything front desk does to a membership: freeze it, take it off freeze,
 * change the plan, give notice, take notice back, block the member.
 *
 * Each action is the same three steps, in this order:
 *
 *  1. check the permission for the acting role
 *  2. ask the domain whether it is allowed and what the consequences are
 *  3. write, record an event, and queue whatever the member should be told
 *
 * The domain decides, not this file. If a rule about notice periods or binding
 * looks like it belongs here, it belongs in src/domain.
 */

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { newId } from '@/db/ids';
import { freezes as freezesTable, members, sites, subscriptions } from '@/db/schema';
import * as subscriptionsRepo from '@/db/repositories/subscriptions';
import * as membersRepo from '@/db/repositories/members';
import { getSettings } from '@/db/repositories/tenants';
import { enqueueOutbox, recordEvent } from '@/db/repositories/observability';
import {
  type PlainDate,
  addMonths,
  assertPlainDate,
  firstDayOfMonth,
  lastDayOfMonth,
} from '@/domain/dates';
import { decideFreeze, extendBinding } from '@/domain/freezes';
import { planCancellation } from '@/domain/cancellation';
import { canChangePlan, effectiveStatus } from '@/domain/subscriptions';
import { prorateFirstPeriod, proratePlanChange } from '@/domain/proration';
import { createIntegrations } from '@/integrations';
import { clock } from '@/lib/clock';
import { timezoneForCountry } from '@/jobs/runner';
import { activeTenant, getSession, requirePermission, tenantScopeFor } from '@/lib/session';

export interface ActionResult {
  readonly ok: boolean;
  readonly message: string;
}

/** Everything an action needs, resolved once. */
async function context() {
  const session = await getSession();
  const tenant = activeTenant(session) ?? session.tenant;
  if (tenant === null) throw new Error('No tenant selected');
  const scope = tenantScopeFor(session);
  const time = clock();
  const timezone = timezoneForCountry(tenant.country);
  return {
    session,
    tenant,
    scope,
    settings: getSettings(scope),
    now: time.now,
    today: time.today(timezone),
    timezone,
    integrations: createIntegrations({ salt: 'beefcake' }),
  };
}

/**
 * Who may change this membership.
 *
 * A member acts on their own only, and only where the operator has turned
 * self-serve on. Staff act on anyone within their tenant. The subscription is
 * re-read from the tenant scope first, so a member cannot pass someone else's
 * id and have it accepted.
 */
function assertMayChange(
  ctx: Awaited<ReturnType<typeof context>>,
  subscriptionMemberId: string,
): void {
  if (ctx.session.user.role === 'member') {
    if (ctx.session.member?.id !== subscriptionMemberId) {
      throw new Error('A member can only change their own membership');
    }
    if (!ctx.settings.flags.self_serve_freeze) {
      throw new Error('This operator handles membership changes at the front desk');
    }
    return;
  }
  requirePermission(ctx.session, 'subscriptions.write');
}

const FREEZE_REJECTIONS: Record<string, string> = {
  starts_in_past: 'A freeze cannot start in the past.',
  too_long: 'That is longer than this operator allows.',
  annual_limit: 'That would break the annual freeze limit.',
  overlaps_existing: 'The member already has a freeze covering those dates.',
};

export async function freezeSubscription(
  subscriptionId: string,
  startsOn: string,
  months: number,
  reason: string,
): Promise<ActionResult> {
  const ctx = await context();
  const subscription = subscriptionsRepo.getSubscription(ctx.scope, subscriptionId);
  if (subscription === null) return { ok: false, message: 'No such membership.' };
  assertMayChange(ctx, subscription.memberId);

  const existing = subscriptionsRepo
    .listFreezes(ctx.scope, subscriptionId)
    .map((freeze) => ({ startsOn: freeze.startsOn as PlainDate, endsOn: freeze.endsOn as PlainDate }));

  const decision = decideFreeze(
    { startsOn: assertPlainDate(startsOn), months },
    existing,
    {
      maxFreezeMonths: ctx.settings.maxFreezeMonths,
      maxFreezeMonthsPerYear: ctx.settings.maxFreezeMonthsPerYear,
    },
    ctx.today,
  );

  if (!decision.ok) {
    return { ok: false, message: FREEZE_REJECTIONS[decision.reason] ?? 'That freeze is not allowed.' };
  }

  const period = decision.period;
  const at = ctx.now.toISOString();

  ctx.scope.db.transaction(() => {
    ctx.scope.db
      .insert(freezesTable)
      .values({
        id: newId('freeze'),
        tenantId: ctx.scope.tenantId,
        subscriptionId,
        startsOn: period.startsOn,
        endsOn: period.endsOn,
        months,
        reason,
        createdAt: at,
      })
      .run();

    // A frozen month is not a month of membership, so the binding period moves.
    const extended = extendBinding((subscription.bindingUntil as PlainDate | null) ?? null, period);
    if (extended !== null) {
      ctx.scope.db
        .update(subscriptions)
        .set({ bindingUntil: extended })
        .where(
          and(eq(subscriptions.tenantId, ctx.scope.tenantId), eq(subscriptions.id, subscriptionId)),
        )
        .run();
    }
  });

  const member = membersRepo.getMember(ctx.scope, subscription.memberId);
  recordEvent(ctx.scope, {
    action: 'subscription.frozen',
    subjectType: 'subscription',
    subjectId: subscriptionId,
    payload: { starts_on: period.startsOn, ends_on: period.endsOn, months, reason },
    at,
  });
  if (member !== null) {
    const sent = ctx.integrations.email.send({
      to: member.email,
      template: 'freeze_confirmed',
      locale: ctx.tenant.locale,
      variables: { starts_on: period.startsOn, ends_on: period.endsOn },
      at: ctx.now,
    });
    enqueueOutbox(ctx.scope, {
      channel: 'email',
      template: 'freeze_confirmed',
      recipient: member.email,
      payload: {
        starts_on: period.startsOn,
        ends_on: period.endsOn,
        resumes_on: period.resumesOn,
        gateway: sent.status,
      },
      at,
    });
  }

  revalidatePath('/app', 'layout');
  return {
    ok: true,
    message: `Frozen from ${period.startsOn} to ${period.endsOn}. Back on ${period.resumesOn}.`,
  };
}

export async function cancelFreeze(freezeId: string): Promise<ActionResult> {
  const ctx = await context();
  const freeze = ctx.scope.db
    .select()
    .from(freezesTable)
    .where(and(eq(freezesTable.tenantId, ctx.scope.tenantId), eq(freezesTable.id, freezeId)))
    .get();
  if (freeze === undefined) return { ok: false, message: 'No such freeze.' };
  const frozenSubscription = subscriptionsRepo.getSubscription(ctx.scope, freeze.subscriptionId);
  if (frozenSubscription === null) return { ok: false, message: 'No such membership.' };
  assertMayChange(ctx, frozenSubscription.memberId);
  if (freeze.endsOn < ctx.today) {
    return { ok: false, message: 'That freeze has already finished.' };
  }

  ctx.scope.db
    .delete(freezesTable)
    .where(and(eq(freezesTable.tenantId, ctx.scope.tenantId), eq(freezesTable.id, freezeId)))
    .run();

  recordEvent(ctx.scope, {
    action: 'subscription.frozen',
    subjectType: 'subscription',
    subjectId: freeze.subscriptionId,
    payload: { removed: true, starts_on: freeze.startsOn, ends_on: freeze.endsOn },
    at: ctx.now.toISOString(),
  });

  revalidatePath('/app', 'layout');
  return { ok: true, message: 'Freeze removed. The card works again tonight, once access syncs.' };
}

export async function changePlan(subscriptionId: string, planId: string): Promise<ActionResult> {
  const ctx = await context();
  const subscription = subscriptionsRepo.getSubscription(ctx.scope, subscriptionId);
  if (subscription === null) return { ok: false, message: 'No such membership.' };
  assertMayChange(ctx, subscription.memberId);

  const target = subscriptionsRepo.getPlan(ctx.scope, planId);
  const current = subscriptionsRepo.getPlan(ctx.scope, subscription.planId);
  if (target === null || current === null) return { ok: false, message: 'No such plan.' };

  const guard = canChangePlan(
    subscriptionsRepo.toRecord(subscription),
    { id: target.id, currency: target.currency, priceMinor: target.priceMinor },
    { id: current.id, currency: current.currency, priceMinor: current.priceMinor },
    ctx.today,
  );

  if (!guard.allowed) {
    const reasons: Record<string, string> = {
      in_binding: 'A downgrade is not allowed inside the binding period.',
      currency_mismatch: 'Those plans are in different currencies.',
      already_on_plan: 'The member is already on that plan.',
      ended: 'That membership has ended.',
    };
    return { ok: false, message: reasons[guard.reason ?? ''] ?? 'That change is not allowed.' };
  }

  // Show the operator what the member will be charged, using the same proration
  // the payment run will apply.
  const period = { from: firstDayOfMonth(ctx.today), to: lastDayOfMonth(ctx.today) };
  const proration = proratePlanChange({
    period,
    changeOn: ctx.today,
    from: { id: current.id, name: current.name, priceMinor: current.priceMinor, currency: current.currency },
    to: { id: target.id, name: target.name, priceMinor: target.priceMinor, currency: target.currency },
  });

  const at = ctx.now.toISOString();
  subscriptionsRepo.changePlan(ctx.scope, subscriptionId, planId);
  if (target.bindingMonths > 0) {
    ctx.scope.db
      .update(subscriptions)
      .set({ bindingUntil: addMonths(ctx.today, target.bindingMonths) })
      .where(and(eq(subscriptions.tenantId, ctx.scope.tenantId), eq(subscriptions.id, subscriptionId)))
      .run();
  }

  recordEvent(ctx.scope, {
    action: 'subscription.plan_changed',
    subjectType: 'subscription',
    subjectId: subscriptionId,
    payload: {
      from_plan_id: current.id,
      to_plan_id: target.id,
      effective_on: ctx.today,
      net_minor: proration.net.minor,
      currency: proration.currency,
    },
    at,
  });

  revalidatePath('/app', 'layout');
  const direction = proration.net.minor >= 0 ? 'charged' : 'credited';
  return {
    ok: true,
    message: `Moved to ${target.name}. ${Math.abs(proration.net.minor) / 100} ${proration.currency} will be ${direction} for the ${proration.remainingDays} remaining days of this period.`,
  };
}

export async function cancelSubscription(
  subscriptionId: string,
  reason: string,
): Promise<ActionResult> {
  const ctx = await context();
  const subscription = subscriptionsRepo.getSubscription(ctx.scope, subscriptionId);
  if (subscription === null) return { ok: false, message: 'No such membership.' };
  assertMayChange(ctx, subscription.memberId);
  if (subscription.cancelledOn !== null) {
    return { ok: false, message: 'Notice has already been given for this membership.' };
  }

  const plan = planCancellation({
    requestedOn: ctx.today,
    bindingUntil: (subscription.bindingUntil as PlainDate | null) ?? null,
    rules: {
      noticePeriodDays: ctx.settings.noticePeriodDays,
      billToEndOfPeriod: ctx.settings.billToEndOfPeriod,
    },
  });

  const at = ctx.now.toISOString();
  subscriptionsRepo.applyCancellation(ctx.scope, subscriptionId, {
    cancelledOn: plan.requestedOn,
    noticeEndsOn: plan.noticeEndsOn,
    endsOn: plan.endsOn,
    reason,
  });

  const member = membersRepo.getMember(ctx.scope, subscription.memberId);
  recordEvent(ctx.scope, {
    action: 'subscription.cancelled',
    subjectType: 'subscription',
    subjectId: subscriptionId,
    payload: {
      reason,
      driver: 'voluntary',
      notice_ends_on: plan.noticeEndsOn,
      ends_on: plan.endsOn,
      decided_by: plan.driver,
    },
    at,
  });
  if (member !== null) {
    const sent = ctx.integrations.email.send({
      to: member.email,
      template: 'cancellation_confirmed',
      locale: ctx.tenant.locale,
      variables: { ends_on: plan.endsOn },
      at: ctx.now,
    });
    enqueueOutbox(ctx.scope, {
      channel: 'email',
      template: 'cancellation_confirmed',
      recipient: member.email,
      payload: { ends_on: plan.endsOn, reason, gateway: sent.status },
      at,
    });
  }

  revalidatePath('/app', 'layout');
  const because =
    plan.driver === 'binding'
      ? 'the binding period runs to then'
      : `the notice period is ${ctx.settings.noticePeriodDays} days`;
  return {
    ok: true,
    message: `Notice recorded. Membership and access end on ${plan.endsOn}, because ${because}.`,
  };
}

export async function withdrawCancellation(subscriptionId: string): Promise<ActionResult> {
  const ctx = await context();
  const subscription = subscriptionsRepo.getSubscription(ctx.scope, subscriptionId);
  if (subscription === null) return { ok: false, message: 'No such membership.' };
  assertMayChange(ctx, subscription.memberId);
  if (subscription.cancelledOn === null) {
    return { ok: false, message: 'No notice has been given.' };
  }
  if (subscription.endsOn !== null && (subscription.endsOn as PlainDate) < ctx.today) {
    return { ok: false, message: 'That membership has already ended. Sign the member up again.' };
  }

  ctx.scope.db
    .update(subscriptions)
    .set({
      status: 'active',
      cancelledOn: null,
      noticeEndsOn: null,
      endsOn: null,
      cancelReason: null,
    })
    .where(and(eq(subscriptions.tenantId, ctx.scope.tenantId), eq(subscriptions.id, subscriptionId)))
    .run();

  recordEvent(ctx.scope, {
    action: 'subscription.cancellation_withdrawn',
    subjectType: 'subscription',
    subjectId: subscriptionId,
    payload: { withdrawn_on: ctx.today },
    at: ctx.now.toISOString(),
  });

  revalidatePath('/app', 'layout');
  return { ok: true, message: 'Notice withdrawn. The membership continues as before.' };
}

export async function setMemberStatus(
  memberId: string,
  status: 'active' | 'blocked',
): Promise<ActionResult> {
  const ctx = await context();
  requirePermission(ctx.session, 'members.write');

  const member = membersRepo.getMember(ctx.scope, memberId);
  if (member === null) return { ok: false, message: 'No such member.' };

  ctx.scope.db
    .update(members)
    .set({ status })
    .where(and(eq(members.tenantId, ctx.scope.tenantId), eq(members.id, memberId)))
    .run();

  recordEvent(ctx.scope, {
    action: status === 'blocked' ? 'member.blocked' : 'member.created',
    subjectType: 'member',
    subjectId: memberId,
    payload: { status, previous: member.status },
    at: ctx.now.toISOString(),
  });

  revalidatePath('/app', 'layout');
  return {
    ok: true,
    message:
      status === 'blocked'
        ? 'Member blocked. The card stops working after tonight’s access sync.'
        : 'Member unblocked.',
  };
}

/** The effective status of a membership today, for the UI to label. */
export async function statusOf(subscriptionId: string): Promise<string> {
  const ctx = await context();
  const subscription = subscriptionsRepo.getSubscription(ctx.scope, subscriptionId);
  if (subscription === null) return 'unknown';
  const freezes = subscriptionsRepo
    .listFreezes(ctx.scope, subscriptionId)
    .map((freeze) => ({ startsOn: freeze.startsOn as PlainDate, endsOn: freeze.endsOn as PlainDate }));
  return effectiveStatus(subscriptionsRepo.toRecord(subscription), freezes, ctx.today);
}

export interface NewMemberInput {
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly birthYear: number;
  readonly siteId: string;
  readonly planId: string;
  readonly issueCard: boolean;
}

export interface CreateMemberResult extends ActionResult {
  readonly memberId?: string;
}

/**
 * Signing somebody up at the front desk.
 *
 * The first period is pro-rated from today, and shown to the operator so they can
 * take that amount before the member walks off. The subscription starts today,
 * which is also why access works immediately rather than after tonight's sync:
 * the door is asked, not told.
 */
export async function createMember(input: NewMemberInput): Promise<CreateMemberResult> {
  const ctx = await context();
  requirePermission(ctx.session, 'members.write');

  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (name.length < 2) return { ok: false, message: 'A name is required.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, message: 'That does not look like an email address.' };
  }

  const site = ctx.scope.db
    .select()
    .from(sites)
    .where(and(eq(sites.tenantId, ctx.scope.tenantId), eq(sites.id, input.siteId)))
    .get();
  if (site === undefined) return { ok: false, message: 'No such site.' };

  const plan = subscriptionsRepo.getPlan(ctx.scope, input.planId);
  if (plan === null) return { ok: false, message: 'No such plan.' };

  const existing = ctx.scope.db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.tenantId, ctx.scope.tenantId), eq(members.email, email)))
    .get();
  if (existing !== undefined) {
    return { ok: false, message: 'Somebody at this gym already uses that email address.' };
  }

  const memberId = newId('member');
  const subscriptionId = newId('subscription');
  const at = ctx.now.toISOString();
  // Card numbers are unique across the whole estate, not per tenant, because a
  // card is a physical object that can walk into any of our customers' gyms.
  const cardId = input.issueCard ? `card_${memberId.slice(4)}` : null;

  const firstPeriod = prorateFirstPeriod({
    period: { from: firstDayOfMonth(ctx.today), to: lastDayOfMonth(ctx.today) },
    startsOn: ctx.today,
    plan: { id: plan.id, name: plan.name, priceMinor: plan.priceMinor, currency: plan.currency },
  });

  ctx.scope.db.transaction(() => {
    ctx.scope.db
      .insert(members)
      .values({
        id: memberId,
        tenantId: ctx.scope.tenantId,
        homeSiteId: site.id,
        name,
        email,
        phone: input.phone.trim(),
        status: 'active',
        cardId,
        birthYear: input.birthYear,
        joinedOn: ctx.today,
        createdAt: at,
      })
      .run();

    ctx.scope.db
      .insert(subscriptions)
      .values({
        id: subscriptionId,
        tenantId: ctx.scope.tenantId,
        memberId,
        planId: plan.id,
        status: 'active',
        startedOn: ctx.today,
        endsOn: null,
        bindingUntil: plan.bindingMonths > 0 ? addMonths(ctx.today, plan.bindingMonths) : null,
        cancelledOn: null,
        noticeEndsOn: null,
        cancelReason: null,
        createdAt: at,
      })
      .run();
  });

  recordEvent(ctx.scope, {
    action: 'member.created',
    subjectType: 'member',
    subjectId: memberId,
    payload: { site_id: site.id, source: 'front_desk', card_issued: cardId !== null },
    at,
  });
  recordEvent(ctx.scope, {
    action: 'subscription.created',
    subjectType: 'subscription',
    subjectId: subscriptionId,
    payload: {
      plan_id: plan.id,
      first_period_minor: firstPeriod.net.minor,
      first_period_days: firstPeriod.remainingDays,
      currency: firstPeriod.currency,
    },
    at,
  });

  const sent = ctx.integrations.email.send({
    to: email,
    template: 'welcome',
    locale: ctx.tenant.locale,
    variables: { plan: plan.name, site: site.name },
    at: ctx.now,
  });
  enqueueOutbox(ctx.scope, {
    channel: 'email',
    template: 'welcome',
    recipient: email,
    payload: { plan_id: plan.id, site_id: site.id, gateway: sent.status },
    at,
  });

  revalidatePath('/app', 'layout');
  return {
    ok: true,
    memberId,
    message: `${name} is a member. Take ${firstPeriod.net.minor / 100} ${firstPeriod.currency} now for the ${firstPeriod.remainingDays} remaining days of this period.`,
  };
}
