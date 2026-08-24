import { describe, expect, it } from 'vitest';
import { atLocalTime, plainDate, type Timezone } from '@/domain/dates';
import {
  type AccessQuery,
  type SubscriptionSnapshot,
  allowedDays,
  evaluateAccess,
} from '@/domain/access-rules';

const STOCKHOLM: Timezone = 'Europe/Stockholm';

const openEnded: SubscriptionSnapshot = {
  id: 'sub_1',
  startsOn: plainDate(2026, 1, 1),
  endsOn: null,
  sitesScope: 'all_sites',
  homeSiteId: 'sit_home',
};

function query(over: Partial<AccessQuery> = {}): AccessQuery {
  return {
    at: atLocalTime(plainDate(2026, 8, 26), STOCKHOLM, 17, 30),
    timezone: STOCKHOLM,
    siteId: 'sit_home',
    cardKnown: true,
    memberStatus: 'active',
    subscription: openEnded,
    freezes: [],
    rules: { accessGraceHours: 48 },
    ...over,
  };
}

describe('the happy path', () => {
  it('lets an active member in', () => {
    expect(evaluateAccess(query())).toMatchObject({ result: 'granted', reason: 'active' });
  });

  it('files the event under the site-local day', () => {
    const late = atLocalTime(plainDate(2026, 8, 26), STOCKHOLM, 23, 45);
    expect(evaluateAccess(query({ at: late })).day).toBe('2026-08-26');
  });
});

describe('cards and members', () => {
  it('denies an unknown card', () => {
    expect(evaluateAccess(query({ cardKnown: false }))).toMatchObject({
      result: 'denied',
      reason: 'unknown_card',
    });
  });

  it('denies a blocked member before looking at their subscription', () => {
    expect(evaluateAccess(query({ memberStatus: 'blocked', subscription: null }))).toMatchObject({
      reason: 'member_blocked',
    });
  });

  it('denies a member with no subscription', () => {
    expect(evaluateAccess(query({ subscription: null }))).toMatchObject({ reason: 'no_subscription' });
  });

  it('denies a former member even if a subscription row lingers', () => {
    expect(evaluateAccess(query({ memberStatus: 'former' }))).toMatchObject({
      reason: 'no_subscription',
    });
  });
});

describe('site scope', () => {
  it('denies a home-site plan at another site', () => {
    const sub = { ...openEnded, sitesScope: 'home_site' as const };
    expect(evaluateAccess(query({ subscription: sub, siteId: 'sit_other' }))).toMatchObject({
      reason: 'site_not_included',
    });
  });

  it('allows an all-sites plan anywhere', () => {
    expect(evaluateAccess(query({ siteId: 'sit_other' })).result).toBe('granted');
  });
});

describe('before it starts and after it ends', () => {
  it('denies before the start date', () => {
    const sub = { ...openEnded, startsOn: plainDate(2026, 9, 1) };
    expect(evaluateAccess(query({ subscription: sub }))).toMatchObject({ reason: 'not_started' });
  });

  it('grants on the last day of a cancelled subscription', () => {
    const sub = { ...openEnded, endsOn: plainDate(2026, 8, 26) };
    expect(evaluateAccess(query({ subscription: sub })).result).toBe('granted');
  });

  it('grants inside the grace window after a membership ends', () => {
    const sub = { ...openEnded, endsOn: plainDate(2026, 8, 25) };
    const justAfterMidnight = atLocalTime(plainDate(2026, 8, 26), STOCKHOLM, 0, 5);
    expect(evaluateAccess(query({ subscription: sub, at: justAfterMidnight }))).toMatchObject({
      result: 'granted',
      reason: 'grace',
    });
  });

  it('denies once the grace window after a cancellation has passed', () => {
    const sub = { ...openEnded, endsOn: plainDate(2026, 8, 20) };
    expect(evaluateAccess(query({ subscription: sub }))).toMatchObject({
      result: 'denied',
      reason: 'subscription_ended',
    });
  });

  it('honours an operator who has turned grace off', () => {
    const sub = { ...openEnded, endsOn: plainDate(2026, 8, 25) };
    const justAfterMidnight = atLocalTime(plainDate(2026, 8, 26), STOCKHOLM, 0, 5);
    expect(
      evaluateAccess(
        query({ subscription: sub, at: justAfterMidnight, rules: { accessGraceHours: 0 } }),
      ),
    ).toMatchObject({ result: 'denied', reason: 'subscription_ended' });
  });
});

describe('freezes and the grace window', () => {
  const freezes = [{ startsOn: plainDate(2026, 8, 26), endsOn: plainDate(2026, 9, 25) }];

  it('lets the member train on the evening they freeze', () => {
    const at = atLocalTime(plainDate(2026, 8, 26), STOCKHOLM, 17, 30);
    expect(evaluateAccess(query({ freezes, at }))).toMatchObject({
      result: 'granted',
      reason: 'grace',
    });
  });

  it('still lets them in inside the grace window the next day', () => {
    const at = atLocalTime(plainDate(2026, 8, 27), STOCKHOLM, 17, 30);
    expect(evaluateAccess(query({ freezes, at })).reason).toBe('grace');
  });

  it('locks them out once the grace window has passed', () => {
    const at = atLocalTime(plainDate(2026, 8, 28), STOCKHOLM, 17, 30);
    expect(evaluateAccess(query({ freezes, at }))).toMatchObject({
      result: 'denied',
      reason: 'frozen',
    });
  });

  it('honours a tenant that has turned grace off', () => {
    const at = atLocalTime(plainDate(2026, 8, 26), STOCKHOLM, 17, 30);
    expect(
      evaluateAccess(query({ freezes, at, rules: { accessGraceHours: 0 } })).reason,
    ).toBe('frozen');
  });

  it('lets them back in the day the freeze ends', () => {
    const at = atLocalTime(plainDate(2026, 9, 26), STOCKHOLM, 7, 0);
    expect(evaluateAccess(query({ freezes, at })).reason).toBe('active');
  });
});

describe('allow-list generation agrees with the door', () => {
  it('excludes frozen and out-of-range days', () => {
    const sub: SubscriptionSnapshot = {
      ...openEnded,
      startsOn: plainDate(2026, 8, 25),
      endsOn: plainDate(2026, 9, 2),
    };
    const freezes = [{ startsOn: plainDate(2026, 8, 28), endsOn: plainDate(2026, 8, 30) }];
    const days = allowedDays(sub, freezes, {
      from: plainDate(2026, 8, 24),
      to: plainDate(2026, 9, 4),
    });
    expect(days).toEqual([
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
    ]);
  });
});
