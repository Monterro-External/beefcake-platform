/**
 * Adapter for `access-provider-b` door controllers.
 *
 * This vendor is the older of the two and its API shows it. Check-in timestamps
 * arrive as a bare local wall-clock string with no offset and no zone:
 *
 *   2026-08-26 23:14:07
 *
 * "Local" means local to the door, i.e. the site's timezone. There is nothing in
 * the payload that says so, which is why the site timezone is a required
 * argument here and why this adapter must never fall back to the host clock:
 * the app runs in UTC in production and in Europe/Stockholm on a developer's
 * laptop, and a Finnish site is an hour off both.
 *
 * Allow-lists are pushed as deltas, which the controller applies in order, so a
 * failed push leaves it behind rather than empty.
 */

import { atLocalTime, localDay, plainDate, type Timezone } from '@/domain/dates';
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

export function parseWallClock(
  timestamp: string,
  siteTimezone: Timezone,
): Date {
  const m = WALL_CLOCK_RE.exec(timestamp.trim());
  if (m === null) {
    throw new TypeError(`access-provider-b sent an unparseable timestamp: ${timestamp}`);
  }
  const [year, month, day, hour, minute, second] = m.slice(1).map((v) => Number.parseInt(v, 10)) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return atLocalTime(plainDate(year, month, day), siteTimezone, hour, minute, second);
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
      const at = parseWallClock(raw.timestamp, siteTimezone as Timezone);
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
