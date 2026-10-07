/**
 * Builds the tenants, their sites, staff, plans and members, and each member's
 * subscription history: freezes, plan changes and cancellations.
 *
 * The shape of the member base is what makes the reports look real, so the
 * distributions here are deliberate rather than uniform:
 *  - joining dates skew recent, with a January spike, because that is when
 *    people join a gym
 *  - freezes cluster in January and over the summer, and a noticeable share
 *    start on the last day of a month, because front desk books them "from the
 *    end of this month"
 *  - cancellations are mostly voluntary, but a chunk follow two to three weeks
 *    after a payment that failed three times
 */

import {
  type BillingPeriod,
  type PlainDate,
  addDays,
  addMonths,
  billingPeriodOf,
  differenceInDays,
  firstDayOfMonth,
  lastDayOfMonth,
  partsOf,
  plainDate,
  subMonths,
} from '@/domain/dates';
import { fromMajor } from '@/domain/money';
import { freezePeriod } from '@/domain/freezes';
import { planCancellation } from '@/domain/cancellation';
import { readSettings } from '@/domain/tenant-settings';
import { createFakePsp, defaultMethodFor } from '@/integrations/payment/fake-psp';
import { decideRetry } from '@/domain/retry-policy';
import { retrySettingsOf } from '@/domain/tenant-settings';
import { atLocalTime, localDay } from '@/domain/dates';
import type { PaymentProvider } from '@/integrations/types';
import { type Rng, createRng } from '@/lib/rng';
import { sequentialId } from '../ids';
import { TENANTS, timezoneFor } from './blueprint';
import { addressFor, cityFor, personFor, slugify } from './names';
import type { Anchors } from './options';
import type { SeedMember, SeedPlan, SeedSite, SeedStaff, SeedTenant, SeedWorld } from './model';

export const BEEFCAKE_STAFF = [
  { name: 'Sara Lindqvist', email: 'sara.lindqvist@beefcake.se' },
  { name: 'Tobias Ek', email: 'tobias.ek@beefcake.se' },
  { name: 'Nour Haddad', email: 'nour.haddad@beefcake.se' },
  { name: 'Petter Lund', email: 'petter.lund@beefcake.no' },
] as const;

const FREEZE_REASONS = ['travel', 'injury', 'parental_leave', 'work', 'other'] as const;
const CANCEL_REASONS_VOLUNTARY = ['moving', 'too_expensive', 'not_using', 'other_gym', 'health'] as const;

/** Months where people freeze: January, and June through August. */
function freezeMonthWeight(month: number): number {
  if (month === 1) return 3.4;
  if (month === 6) return 2.2;
  if (month === 7) return 3.1;
  if (month === 8) return 2.4;
  if (month === 12) return 1.4;
  return 1;
}

/** Months where people join: January hardest, then September. */
function joinMonthWeight(month: number): number {
  if (month === 1) return 3.2;
  if (month === 2) return 1.6;
  if (month === 9) return 1.9;
  if (month === 7) return 0.5;
  if (month === 12) return 0.6;
  return 1;
}

export interface BuildWorldInput {
  readonly anchors: Anchors;
  readonly seed: string;
  readonly memberFactor: number;
}

export function buildWorld(input: BuildWorldInput): SeedWorld {
  const { anchors, seed, memberFactor } = input;
  const rootRng = createRng(`${seed}|world|${anchors.today}`);

  let siteSeq = 0;
  let userSeq = 0;
  let memberSeq = 0;
  let planSeq = 0;
  let subSeq = 0;
  let freezeSeq = 0;

  const tenants: SeedTenant[] = TENANTS.map((blueprint, tenantIndex) => {
    const rng = createRng(`${seed}|${blueprint.key}`);
    const tenantId = sequentialId('tenant', tenantIndex + 1);

    // Tenants signed up over the last five to eight years, oldest first.
    const foundedMonthsAgo = 24 + Math.round(rng.around(38, 18, 12, 96));
    const createdOn = firstDayOfMonth(subMonths(anchors.today, foundedMonthsAgo));
    const createdAt = `${createdOn}T09:${String(rng.int(0, 59)).padStart(2, '0')}:00.000Z`;

    const sites: SeedSite[] = blueprint.sites.map((site, index) => {
      siteSeq += 1;
      // Sites open over the tenant's life, the first one on day one.
      const openedOn =
        index === 0 ? createdOn : addMonths(createdOn, rng.int(3, Math.max(4, foundedMonthsAgo - 2)));
      return {
        id: sequentialId('site', siteSeq),
        tenantId,
        index,
        name: site.name,
        timezone: timezoneFor(site.country),
        accessProvider: site.accessProvider,
        openedOn: openedOn > anchors.today ? anchors.today : openedOn,
        staffIds: [],
      };
    });

    const plans: SeedPlan[] = blueprint.plans.map((plan, index) => {
      planSeq += 1;
      return {
        id: sequentialId('plan', planSeq),
        index,
        name: plan.name,
        priceMinor: fromMajor(plan.price, blueprint.currency).minor,
        currency: blueprint.currency,
        bindingMonths: plan.bindingMonths,
        sitesScope: plan.sitesScope,
      };
    });

    // Staff: one owner, then a manager and two front desk per site. Front desk
    // staff double as class instructors, which is how it works in practice.
    const staff: SeedStaff[] = [];
    userSeq += 1;
    const owner = personFor(rng, blueprint.locale, userSeq, anchors.todayYear);
    staff.push({
      id: sequentialId('user', userSeq),
      name: owner.name,
      email: `${slugify(owner.name)}@${slugify(blueprint.name)}.example`,
      role: 'owner',
      siteIndex: null,
    });
    for (const site of sites) {
      for (let i = 0; i < 3; i += 1) {
        userSeq += 1;
        const person = personFor(rng, blueprint.locale, userSeq, anchors.todayYear);
        const id = sequentialId('user', userSeq);
        staff.push({
          id,
          name: person.name,
          email: `${slugify(person.name)}.${userSeq.toString(36)}@${slugify(blueprint.name)}.example`,
          role: i === 0 ? 'site_manager' : 'front_desk',
          siteIndex: site.index,
        });
        site.staffIds.push(id);
      }
    }

    // The same fake PSP, salt and retry policy the payment-run writer uses, so
    // that a member whose charges failed three times here is the same member
    // whose charges failed three times in the `charges` table.
    const settings = readSettings(
      Object.entries(blueprint.settings).map(([key, value]) => ({ key, value })),
    );
    const psp = createFakePsp({
      failureRate: blueprint.failureRate,
      retryFailureRate: 0.38,
      salt: `${seed}|psp|${tenantId}`,
    });

    const memberTarget = Math.max(8, Math.round(blueprint.members * memberFactor));
    // Members who have already left are still on the books; roughly a fifth of
    // the base over the generated history.
    const formerTarget = Math.round(memberTarget * 0.19);
    const members: SeedMember[] = [];

    for (let i = 0; i < memberTarget + formerTarget; i += 1) {
      memberSeq += 1;
      subSeq += 1;
      const isFormer = i >= memberTarget;
      const person = personFor(rng, blueprint.locale, memberSeq, anchors.todayYear);

      const site = pickSite(rng, sites, anchors.today);
      const joinedOn = pickJoinDate(rng, site.openedOn, anchors.today, isFormer);
      const planIndex = pickWeighted(rng, blueprint.plans.map((p) => p.weight));
      const plan = plans[planIndex] as SeedPlan;

      const member: SeedMember = {
        id: sequentialId('member', memberSeq),
        seq: memberSeq,
        siteIndex: site.index,
        name: person.name,
        email: person.email,
        phone: person.phone,
        birthYear: person.birthYear,
        cardId: `card_${memberSeq.toString(36).padStart(7, '0')}`,
        joinedOn,
        status: 'active',
        subscriptionId: sequentialId('subscription', subSeq),
        planIndex,
        startedOn: joinedOn,
        bindingUntil: plan.bindingMonths > 0 ? addMonths(joinedOn, plan.bindingMonths) : null,
        cancelledOn: null,
        noticeEndsOn: null,
        endsOn: null,
        cancelReason: null,
        subscriptionStatus: 'active',
        churnDriver: null,
        freezes: [],
        planChange: null,
        method: defaultMethodFor(blueprint.country),
        mandateId: rng.chance(0.985) ? `mandate_${memberSeq.toString(36)}` : null,
        usesApp: rng.chance(blueprint.appAdoption),
      };

      // Freezes. Everyone who has been a member for a while may have taken one.
      const yearsAsMember = Math.max(0.25, differenceInDays(anchors.today, joinedOn) / 365);
      const freezeDraws = Math.min(3, Math.floor(blueprint.freezeRate * yearsAsMember * 1.6));
      for (let f = 0; f < freezeDraws; f += 1) {
        if (!rng.chance(0.72)) continue;
        const startsOn = pickFreezeStart(rng, joinedOn, anchors.today);
        if (startsOn === null) continue;
        const months = Math.min(settings.maxFreezeMonths, rng.chance(0.62) ? 1 : rng.int(2, 3));
        const period = freezePeriod(startsOn, months);
        const clashes = member.freezes.some(
          (existing) => existing.startsOn <= period.endsOn && period.startsOn <= existing.endsOn,
        );
        if (clashes) continue;
        freezeSeq += 1;
        member.freezes.push({
          id: sequentialId('freeze', freezeSeq),
          startsOn: period.startsOn,
          endsOn: period.endsOn,
          months,
          reason: rng.pick(FREEZE_REASONS),
        });
        member.bindingUntil =
          member.bindingUntil === null ? null : addDays(member.bindingUntil, period.days);
      }
      member.freezes.sort((a, b) => a.startsOn.localeCompare(b.startsOn));

      // Plan changes. Mid-month is the norm: the member walks in and asks.
      if (rng.chance(blueprint.planChangeRate * Math.min(2, yearsAsMember))) {
        const changeOn = pickPlanChangeDate(rng, joinedOn, anchors.today);
        if (changeOn !== null) {
          const toPlanIndex = pickWeighted(rng, blueprint.plans.map((p) => p.weight));
          if (toPlanIndex !== planIndex) {
            member.planChange = { on: changeOn, fromPlanIndex: planIndex, toPlanIndex };
            member.planIndex = toPlanIndex;
            const target = plans[toPlanIndex] as SeedPlan;
            member.bindingUntil =
              target.bindingMonths > 0 ? addMonths(changeOn, target.bindingMonths) : member.bindingUntil;
          }
        }
      }

      if (isFormer) {
        applyCancellation({ member, rng, blueprint, anchors, psp, settings, kind: 'former' });
      } else if (rng.chance(0.017)) {
        // A small share of the current base has given notice but is still training.
        applyCancellation({ member, rng, blueprint, anchors, psp, settings, kind: 'cancelling' });
      } else if (rng.chance(0.004)) {
        member.status = 'blocked';
      }

      members.push(member);
    }

    const livePeriods = anchors.runs
      .filter((run) => run.completed && run.to >= createdOn)
      .map((run) => run.period);

    const orgSuffix = String(1000 + tenantIndex * 7).slice(0, 4);
    return {
      blueprint,
      id: tenantId,
      createdOn,
      createdAt,
      city: cityFor(rng, blueprint.locale),
      orgNumber: `${blueprint.country === 'SE' ? '556' : '99'}${String(100 + tenantIndex)}-${orgSuffix}`,
      sites,
      plans,
      members,
      staff,
      livePeriods,
    };
  });

  const beefcakeStaff = BEEFCAKE_STAFF.map((staff, index) => ({
    id: sequentialId('user', 900000 + index),
    name: staff.name,
    email: staff.email,
  }));

  void rootRng;
  return { tenants, beefcakeStaff };
}

// ---------------------------------------------------------------------------
// Distributions
// ---------------------------------------------------------------------------

function pickSite(rng: Rng, sites: readonly SeedSite[], today: PlainDate): SeedSite {
  const open = sites.filter((s) => s.openedOn <= today);
  const candidates = open.length > 0 ? open : sites;
  // The flagship site carries more members than the newest one.
  const weights = candidates.map((_, i) => 1 + (candidates.length - i) * 0.35);
  return candidates[pickWeighted(rng, weights)] as SeedSite;
}

export function pickWeighted(rng: Rng, weights: readonly number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let cursor = rng.next() * total;
  for (let i = 0; i < weights.length; i += 1) {
    cursor -= weights[i] as number;
    if (cursor <= 0) return i;
  }
  return weights.length - 1;
}

/** A join date skewed towards recent months, with the January spike. */
function pickJoinDate(rng: Rng, siteOpenedOn: PlainDate, today: PlainDate, isFormer: boolean): PlainDate {
  const window = Math.max(60, differenceInDays(today, siteOpenedOn));
  // Former members joined further back; current members skew recent.
  const skew = isFormer ? 0.55 : 1.7;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const fraction = Math.pow(rng.next(), skew);
    const candidate = addDays(today, -Math.round(fraction * window));
    const { month } = partsOf(candidate);
    if (rng.next() < joinMonthWeight(month) / 3.2) return candidate;
  }
  return addDays(today, -rng.int(30, window));
}

/**
 * A freeze start date. Around one in six starts on the last day of a month,
 * because that is what front desk offers when someone asks in the last week.
 */
function pickFreezeStart(rng: Rng, joinedOn: PlainDate, today: PlainDate): PlainDate | null {
  const earliest = addDays(joinedOn, 45);
  if (earliest >= today) return null;
  const window = differenceInDays(today, earliest);
  if (window < 30) return null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = addDays(earliest, rng.int(0, window));
    const { month } = partsOf(candidate);
    if (rng.next() >= freezeMonthWeight(month) / 3.4) continue;
    if (rng.chance(0.17)) return lastDayOfMonth(candidate);
    if (rng.chance(0.28)) return firstDayOfMonth(candidate);
    return candidate;
  }
  return null;
}

/** A plan change date, biased to mid-month rather than a period boundary. */
function pickPlanChangeDate(rng: Rng, joinedOn: PlainDate, today: PlainDate): PlainDate | null {
  const earliest = addDays(joinedOn, 40);
  if (earliest >= today) return null;
  const window = differenceInDays(today, earliest);
  const candidate = addDays(earliest, rng.int(0, window));
  const { year, month } = partsOf(candidate);
  // Four in five happen between the 5th and the 24th.
  const day = rng.chance(0.8) ? rng.int(5, 24) : rng.int(1, 28);
  return plainDate(year, month, day);
}

type CancellationKind = 'former' | 'cancelling';

interface CancellationInput {
  readonly member: SeedMember;
  readonly rng: Rng;
  readonly blueprint: (typeof TENANTS)[number];
  readonly anchors: Anchors;
  readonly psp: PaymentProvider;
  readonly settings: ReturnType<typeof readSettings>;
  readonly kind: CancellationKind;
}

/**
 * The day dunning gave up on this member, if it ever did.
 *
 * Charge outcomes are a pure function of (member, period, attempt), so this can
 * be answered here without touching the database. It is what ties the churn
 * spike to the payment run rather than sprinkling it randomly: a member whose
 * third attempt failed on the 31st cancels somewhere in the two to three weeks
 * after that.
 */
function findDunningExhaustion(input: {
  member: SeedMember;
  blueprint: (typeof TENANTS)[number];
  anchors: Anchors;
  psp: PaymentProvider;
  settings: ReturnType<typeof readSettings>;
  notAfter: PlainDate;
}): PlainDate | null {
  const { member, blueprint, anchors, psp, settings, notAfter } = input;
  const timezone = timezoneFor(blueprint.country);
  const retrySettings = retrySettingsOf(settings);

  const candidates = anchors.runs.filter(
    (run) => run.completed && run.runOn <= notAfter && run.to >= member.startedOn,
  );

  for (const run of candidates.slice().reverse()) {
    let attempt = 1;
    let attemptedAt = atLocalTime(run.runOn, timezone, 3, 20);
    for (let guard = 0; guard < 8; guard += 1) {
      const outcome = psp.charge({
        reference: `${member.id}|${run.period}`,
        tenantId: member.id,
        memberId: member.id,
        mandateId: member.mandateId,
        amountMinor: 1,
        currency: blueprint.currency,
        method: member.method,
        attempt,
        attemptedAt,
        description: 'dunning probe',
      });
      if (outcome.status === 'succeeded') break;
      const retry = decideRetry({
        attempt,
        attemptedAt,
        failureCode: outcome.failureCode,
        settings: retrySettings,
        timezone,
      });
      if (!retry.retry) return localDay(attemptedAt, timezone);
      attempt = retry.nextAttempt;
      attemptedAt = retry.nextAttemptAt;
    }
  }
  return null;
}

function applyCancellation(input: CancellationInput): void {
  const { member, rng, blueprint, anchors, psp, settings, kind } = input;

  const latestRequest =
    kind === 'former'
      ? addDays(anchors.today, -settings.noticePeriodDays - 1)
      : addDays(anchors.today, -1);

  let requestedOn: PlainDate | null = null;
  let driver: 'voluntary' | 'payment_failure' = 'voluntary';

  // If dunning ever gave up on this member, that is the reason they left. The
  // cancellation is dated two to three weeks after the last failed attempt,
  // which is what puts the churn spike a fortnight behind the payment run
  // rather than on top of it. Roughly a quarter of the seeded churn comes out
  // this way, the rest is ordinary: moved away, too expensive, not using it.
  const gaveUpOn = findDunningExhaustion({
    member,
    blueprint,
    anchors,
    psp,
    settings,
    notAfter: latestRequest,
  });
  if (gaveUpOn !== null && rng.chance(0.88)) {
    const candidate = addDays(gaveUpOn, rng.int(14, 21));
    if (candidate <= anchors.today && candidate > member.startedOn) {
      requestedOn = candidate;
      driver = 'payment_failure';
    }
  }

  if (requestedOn === null) {
    const earliest = addDays(member.startedOn, 95);
    if (kind === 'former') {
      if (earliest > latestRequest) return;
      requestedOn = addDays(earliest, rng.int(0, differenceInDays(latestRequest, earliest)));
    } else {
      requestedOn = addDays(anchors.today, -rng.int(1, Math.max(2, settings.noticePeriodDays - 1)));
      if (requestedOn < member.startedOn) return;
    }
  }

  const plan = planCancellation({
    requestedOn,
    bindingUntil: member.bindingUntil,
    rules: { noticePeriodDays: settings.noticePeriodDays, billToEndOfPeriod: settings.billToEndOfPeriod },
  });

  member.cancelledOn = plan.requestedOn;
  member.noticeEndsOn = plan.noticeEndsOn;
  member.endsOn = plan.endsOn;
  member.churnDriver = driver;
  member.cancelReason =
    driver === 'payment_failure' ? 'payment_failure' : rng.pick(CANCEL_REASONS_VOLUNTARY);

  if (plan.endsOn < addDays(anchors.today, -FORMER_AFTER_DAYS)) {
    member.status = 'former';
    member.subscriptionStatus = 'cancelled';
  } else if (plan.endsOn < anchors.today) {
    // Lapsed but still on the books. Nobody reclassifies a member the morning
    // after their notice period runs out, and the card is usually still in
    // their wallet: it is the access system's job to stop working.
    member.status = 'active';
    member.subscriptionStatus = 'cancelled';
  } else {
    member.status = 'active';
    member.subscriptionStatus = 'cancelling';
  }
}

/**
 * How long a lapsed member stays on the active list before the front desk
 * archives them and takes the card off the system.
 */
export const FORMER_AFTER_DAYS = 45;

/** Whether the member still has a working card on file. */
export function holdsCard(member: SeedMember): boolean {
  return member.status !== 'former';
}

/**
 * The member logins at a tenant, so the dev persona switcher has someone to be.
 * The first three active members, who book classes like everyone else, and one
 * more on an active subscription who has nothing booked from today on: the
 * member the schedule tells "You have no upcoming booked classes."
 */
export function memberLogins(members: readonly SeedMember[]): { member: SeedMember; booksAhead: boolean }[] {
  const active = members.filter((m) => m.status === 'active');
  const booking = active.slice(0, 3);
  const idle = active.slice(3).find((m) => m.subscriptionStatus === 'active');
  return [
    ...booking.map((member) => ({ member, booksAhead: true })),
    ...(idle === undefined ? [] : [{ member: idle, booksAhead: false }]),
  ];
}

/** Ids of the member logins with nothing booked from today on: they keep their past classes only. */
export function membersWithNothingAhead(members: readonly SeedMember[]): ReadonlySet<string> {
  return new Set(
    memberLogins(members)
      .filter((login) => !login.booksAhead)
      .map((login) => login.member.id),
  );
}

/** Periods in which the member should be charged, given their history. */
export function billablePeriods(member: SeedMember, runs: readonly { period: BillingPeriod; from: PlainDate; to: PlainDate; completed: boolean }[]): BillingPeriod[] {
  const out: BillingPeriod[] = [];
  for (const run of runs) {
    if (!run.completed) continue;
    if (member.startedOn > run.to) continue;
    if (member.endsOn !== null && member.endsOn < run.from) continue;
    const fullyFrozen = member.freezes.some((f) => f.startsOn <= run.from && f.endsOn >= run.to);
    if (fullyFrozen) continue;
    out.push(run.period);
  }
  return out;
}

export { billingPeriodOf, slugify, addressFor, cityFor };
