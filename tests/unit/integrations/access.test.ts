import { describe, expect, it } from 'vitest';
import { atLocalTime, plainDate, type Timezone } from '@/domain/dates';
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

describe('access-provider-b sends a timestamp without an offset', () => {
  it('parses the vendor format', () => {
    const normalised = providerB.normalise(raw('2026-08-26 23:14:07'), 'Europe/Helsinki');
    expect(normalised.at.toISOString()).toBe('2026-08-26T23:14:07.000Z');
    expect(normalised.cardId).toBe('card_1');
    expect(normalised.granted).toBe(true);
  });

  it('files a daytime check-in under the day it happened, in every market', () => {
    for (const tz of ZONES) {
      for (const hour of ['07', '12', '18']) {
        const normalised = providerB.normalise(raw(`2026-08-26 ${hour}:45:00`), tz);
        expect(normalised.localDay).toBe('2026-08-26');
      }
    }
  });

  it('accepts both a space and a T as the separator', () => {
    expect(parseWallClock('2026-08-26 23:14:07').getTime()).toBe(
      parseWallClock('2026-08-26T23:14:07').getTime(),
    );
  });

  it('rejects a timestamp with an offset, which this vendor never sends', () => {
    expect(() => parseWallClock('2026-08-26T23:14:07+02:00')).toThrow(TypeError);
  });

  it('rejects junk', () => {
    expect(() => parseWallClock('26/08/2026 23:14')).toThrow(TypeError);
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
