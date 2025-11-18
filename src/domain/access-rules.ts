/**
 * Whether a card or app QR opens the door.
 *
 * The door controller is offline-tolerant: it holds a local allow-list that the
 * access sync job pushes to it. So this function is evaluated twice, once when
 * building the allow-list and once when we replay a check-in event for reports,
 * and both have to agree.
 *
 * Grace, precisely: `access_grace_hours` exists because a member who freezes
 * their subscription at the front desk at 17:00 is usually standing there in
 * gym clothes. The grace window lets them train that evening. It applies to the
 * *start of a freeze* only. A cancellation has no grace: the subscription runs
 * to the end of its notice period, which is generous by construction, and after
 * that the card is dead. Owners are unforgiving about this one, an ex-member in
 * the building at 22:00 is a security incident.
 */

import {
  type PlainDate,
  type Timezone,
  addDays,
  isWithin,
  localDay,
  startOfDay,
} from './dates';
import { type StoredFreeze, activeFreezeOn } from './freezes';

export type AccessResult = 'granted' | 'denied';

export type AccessReason =
  | 'active'
  | 'freeze_grace'
  | 'frozen'
  | 'subscription_ended'
  | 'not_started'
  | 'no_subscription'
  | 'unknown_card'
  | 'member_blocked'
  | 'site_not_included';

export interface AccessDecision {
  readonly result: AccessResult;
  readonly reason: AccessReason;
  /** The site-local day the event is filed under. */
  readonly day: PlainDate;
}

export type MemberStatus = 'active' | 'blocked' | 'former';

export interface SubscriptionSnapshot {
  readonly id: string;
  readonly startsOn: PlainDate;
  /** Inclusive last day of access. Null while the subscription is open-ended. */
  readonly endsOn: PlainDate | null;
  readonly sitesScope: 'home_site' | 'all_sites';
  readonly homeSiteId: string;
}

export interface AccessRules {
  /** Hours of access still granted after a freeze begins. Tenant setting. */
  readonly accessGraceHours: number;
}

export interface AccessQuery {
  readonly at: Date;
  readonly timezone: Timezone;
  readonly siteId: string;
  readonly cardKnown: boolean;
  readonly memberStatus: MemberStatus;
  readonly subscription: SubscriptionSnapshot | null;
  readonly freezes: readonly StoredFreeze[];
  readonly rules: AccessRules;
}

export function evaluateAccess(query: AccessQuery): AccessDecision {
  const day = localDay(query.at, query.timezone);
  const deny = (reason: AccessReason): AccessDecision => ({ result: 'denied', reason, day });
  const grant = (reason: AccessReason): AccessDecision => ({ result: 'granted', reason, day });

  if (!query.cardKnown) return deny('unknown_card');
  if (query.memberStatus === 'blocked') return deny('member_blocked');

  const sub = query.subscription;
  if (sub === null || query.memberStatus === 'former') return deny('no_subscription');

  if (sub.sitesScope === 'home_site' && sub.homeSiteId !== query.siteId) {
    return deny('site_not_included');
  }

  if (day < sub.startsOn) return deny('not_started');

  // A cancelled or expired subscription: hard stop the day after ends_on. No
  // grace here, deliberately. See the module comment.
  if (sub.endsOn !== null && day > sub.endsOn) return deny('subscription_ended');

  const freeze = activeFreezeOn(query.freezes, day);
  if (freeze !== undefined) {
    const graceUntil = new Date(
      startOfDay(freeze.startsOn, query.timezone).getTime() + query.rules.accessGraceHours * 3_600_000,
    );
    if (query.at < graceUntil) return grant('freeze_grace');
    return deny('frozen');
  }

  return grant('active');
}

/**
 * The days a member should appear on a site's offline allow-list, for the window
 * the sync job pushes. Derived from the same rules as `evaluateAccess` so the
 * controller and the reports cannot disagree.
 */
export function allowedDays(
  subscription: SubscriptionSnapshot,
  freezes: readonly StoredFreeze[],
  window: { from: PlainDate; to: PlainDate },
): PlainDate[] {
  const out: PlainDate[] = [];
  for (let day = window.from; day <= window.to; day = addDays(day, 1)) {
    if (day < subscription.startsOn) continue;
    if (subscription.endsOn !== null && day > subscription.endsOn) continue;
    if (freezes.some((f) => isWithin(day, f.startsOn, f.endsOn))) continue;
    out.push(day);
  }
  return out;
}

export function isDenial(decision: AccessDecision): boolean {
  return decision.result === 'denied';
}
