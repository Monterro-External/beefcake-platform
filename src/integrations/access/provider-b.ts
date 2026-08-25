/**
 * Adapter for `access-provider-b` door controllers.
 *
 * This vendor is the older of the two and its API shows it. Check-in timestamps
 * arrive without an offset:
 *
 *   2026-08-26 23:14:07
 *
 * That is ISO-8601 apart from the separator, so it does not need a hand-rolled
 * parser. The site timezone is still what decides which calendar day the event
 * is filed under.
 *
 * Allow-lists are pushed as deltas, which the controller applies in order, so a
 * failed push leaves it behind rather than empty.
 */

import { localDay, type Timezone } from '@/domain/dates';
import { hashString, unitFor } from '@/lib/rng';
import type {
  AccessProvider,
  AccessSyncOutcome,
  AccessSyncRequest,
  NormalisedCheckIn,
  RawCheckIn,
} from '../types';
import type { ProviderOptions } from './provider-a';
import { zonedParts } from './intl';

const WALL_CLOCK_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

export function parseWallClock(timestamp: string): Date {
  const trimmed = timestamp.trim();
  if (!WALL_CLOCK_RE.test(trimmed)) {
    throw new TypeError(`access-provider-b sent an unparseable timestamp: ${timestamp}`);
  }
  const at = new Date(`${trimmed.replace(' ', 'T')}Z`);
  if (Number.isNaN(at.getTime())) {
    throw new TypeError(`access-provider-b sent an unparseable timestamp: ${timestamp}`);
  }
  return at;
}

export function createAccessProviderB(options: ProviderOptions = {}): AccessProvider {
  const errorRate = options.errorRate ?? 0.03;
  const salt = options.salt ?? 'provider-b';

  return {
    name: 'access-provider-b',

    push(request: AccessSyncRequest): AccessSyncOutcome {
      const roll = unitFor(salt, request.siteId, request.at.toISOString().slice(0, 13));
      if (roll < errorRate) {
        return {
          status: 'error',
          message: 'ERR_QUEUE_FULL: controller rejected delta, full resync required',
          retryable: true,
        };
      }
      return {
        status: 'ok',
        accepted: request.grants.length,
        controllerVersion: `b.${hashString(`${request.siteId}|${request.grants.length}`) % 100000}`,
      };
    },

    normalise(raw: RawCheckIn, siteTimezone: string): NormalisedCheckIn {
      const at = parseWallClock(raw.timestamp);
      return {
        cardId: raw.cardId,
        doorId: raw.doorId,
        at,
        localDay: localDay(at, siteTimezone as Timezone),
        granted: raw.granted,
      };
    },

    formatTimestamp(at: Date, siteTimezone: string): string {
      const p = zonedParts(at, siteTimezone);
      const pad = (n: number, w = 2) => String(n).padStart(w, '0');
      return (
        `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)} ` +
        `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`
      );
    },
  };
}
