import { describe, expect, it } from 'vitest';
import { atLocalTime, localDay, plainDate, type Timezone } from '@/domain/dates';
import { accessProviderFor } from '@/integrations/access/registry';
import { offsetOf } from '@/integrations/access/provider-a';
import { parseWallClock } from '@/integrations/access/provider-b';
import type { RawCheckIn } from '@/integrations/types';

const providerA = accessProviderFor('access-provider-a', { errorRate: 0 });
const providerB = accessProviderFor('access-provider-b', { errorRate: 0 });

const ZONES: Timezone[] = [
  'Europe/Stockholm',
  'Europe/Oslo',
  'Europe/Helsinki',
  'Europe/Copenhagen',
];

function raw(timestamp: string): RawCheckIn {
  return { cardId: 'card_1', doorId: 'door_1', timestamp, granted: true };
}

describe('offsets', () => {
  it('knows the summer and winter offset for each market', () => {
    expect(offsetOf(new Date('2026-07-01T12:00:00Z'), 'Europe/Stockholm')).toBe(120);
    expect(offsetOf(new Date('2026-01-01T12:00:00Z'), 'Europe/Stockholm')).toBe(60);
    expect(offsetOf(new Date('2026-07-01T12:00:00Z'), 'Europe/Helsinki')).toBe(180);
    expect(offsetOf(new Date('2026-01-01T12:00:00Z'), 'Europe/Helsinki')).toBe(120);
  });
});

describe('access-provider-a sends an offset, so the instant is unambiguous', () => {
  it('reads the instant straight off the string', () => {
    const normalised = providerA.normalise(raw('2026-08-26T23:14:07+02:00'), 'Europe/Stockholm');
    expect(normalised.at.toISOString()).toBe('2026-08-26T21:14:07.000Z');
    expect(normalised.localDay).toBe('2026-08-26');
  });

  it('round-trips its own format in every market', () => {
    for (const tz of ZONES) {
      const at = atLocalTime(plainDate(2026, 8, 26), tz, 23, 14, 7);
      const normalised = providerA.normalise(raw(providerA.formatTimestamp(at, tz)), tz);
      expect(normalised.at.getTime()).toBe(at.getTime());
      expect(normalised.localDay).toBe('2026-08-26');
    }
  });

  it('rejects a timestamp it cannot parse', () => {
    expect(() => providerA.normalise(raw('26/08/2026 23:14'), 'Europe/Stockholm')).toThrow(TypeError);
  });
});

describe('access-provider-b sends bare local wall-clock time', () => {
  it('interprets the wall clock in the site timezone, not UTC', () => {
    const normalised = providerB.normalise(raw('2026-08-26 23:14:07'), 'Europe/Helsinki');
    // 23:14 in Helsinki in August is 20:14 UTC, still the 26th locally.
    expect(normalised.at.toISOString()).toBe('2026-08-26T20:14:07.000Z');
    expect(normalised.localDay).toBe('2026-08-26');
  });

  it('files a late check-in under the day it happened, in every market', () => {
    for (const tz of ZONES) {
      for (const hour of [22, 23]) {
        const normalised = providerB.normalise(raw(`2026-08-26 ${hour}:45:00`), tz);
        expect(normalised.localDay).toBe('2026-08-26');
      }
    }
  });

  it('files an early-morning check-in under the day it happened', () => {
    for (const tz of ZONES) {
      expect(providerB.normalise(raw('2026-08-26 00:20:00'), tz).localDay).toBe('2026-08-26');
      expect(providerB.normalise(raw('2026-08-26 05:30:00'), tz).localDay).toBe('2026-08-26');
    }
  });

  it('handles the winter offset too', () => {
    const normalised = providerB.normalise(raw('2026-01-15 23:30:00'), 'Europe/Helsinki');
    expect(normalised.at.toISOString()).toBe('2026-01-15T21:30:00.000Z');
    expect(normalised.localDay).toBe('2026-01-15');
  });

  it('round-trips its own format in every market and at every hour', () => {
    for (const tz of ZONES) {
      for (let hour = 0; hour < 24; hour += 1) {
        const at = atLocalTime(plainDate(2026, 8, 26), tz, hour, 30);
        const normalised = providerB.normalise(raw(providerB.formatTimestamp(at, tz)), tz);
        expect(normalised.at.getTime()).toBe(at.getTime());
        expect(normalised.localDay).toBe(localDay(at, tz));
      }
    }
  });

  it('accepts both a space and a T as the separator', () => {
    const withSpace = parseWallClock('2026-08-26 23:14:07', 'Europe/Oslo');
    const withT = parseWallClock('2026-08-26T23:14:07', 'Europe/Oslo');
    expect(withSpace.getTime()).toBe(withT.getTime());
  });

  it('rejects a timestamp with an offset, which this vendor never sends', () => {
    expect(() => parseWallClock('2026-08-26T23:14:07+02:00', 'Europe/Oslo')).toThrow(TypeError);
  });
});

describe('the two adapters agree on the same physical swipe', () => {
  it('produces the same instant and the same local day', () => {
    for (const tz of ZONES) {
      for (const hour of [0, 6, 12, 23]) {
        const at = atLocalTime(plainDate(2026, 8, 26), tz, hour, 14, 7);
        const fromA = providerA.normalise(raw(providerA.formatTimestamp(at, tz)), tz);
        const fromB = providerB.normalise(raw(providerB.formatTimestamp(at, tz)), tz);
        expect(fromB.at.getTime()).toBe(fromA.at.getTime());
        expect(fromB.localDay).toBe(fromA.localDay);
      }
    }
  });
});

describe('pushing allow-lists', () => {
  const request = {
    siteId: 'sit_a',
    siteTimezone: 'Europe/Stockholm',
    grants: [{ cardId: 'card_1', memberId: 'mem_1', validFrom: '2026-08-26', validTo: '2026-09-02' }],
    at: new Date('2026-08-26T02:00:00.000Z'),
  };

  it('accepts every grant when the controller is up', () => {
    for (const provider of [providerA, providerB]) {
      const outcome = provider.push(request);
      expect(outcome).toMatchObject({ status: 'ok', accepted: 1 });
    }
  });

  it('reports a retryable error when the controller is down', () => {
    const flaky = accessProviderFor('access-provider-b', { errorRate: 1 });
    expect(flaky.push(request)).toMatchObject({ status: 'error', retryable: true });
  });

  it('is deterministic for the same site and hour', () => {
    expect(providerA.push(request)).toEqual(providerA.push(request));
  });
});
