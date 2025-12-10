/**
 * Adapter for `access-provider-a` door controllers.
 *
 * This vendor's API is the pleasant one. Check-in timestamps arrive as
 * ISO-8601 with an explicit offset, e.g. `2026-08-26T22:14:07+02:00`, so the
 * instant is unambiguous and we only have to work out which local day to file
 * it under.
 *
 * Allow-lists are pushed as a full replacement per site. The controller keeps
 * the last accepted version and reports it back, which is what our sync-lag
 * monitoring compares against.
 */

import { localDay, type Timezone } from '@/domain/dates';
import { hashString, unitFor } from '@/lib/rng';
import { zonedParts } from './intl';
import type {
  AccessProvider,
  AccessSyncOutcome,
  AccessSyncRequest,
  NormalisedCheckIn,
  RawCheckIn,
} from '../types';

export interface ProviderOptions {
  /** Probability a push fails, for exercising the runbook. */
  readonly errorRate?: number;
  readonly salt?: string;
}

export function createAccessProviderA(options: ProviderOptions = {}): AccessProvider {
  const errorRate = options.errorRate ?? 0.01;
  const salt = options.salt ?? 'provider-a';

  return {
    name: 'access-provider-a',

    push(request: AccessSyncRequest): AccessSyncOutcome {
      const roll = unitFor(salt, request.siteId, request.at.toISOString().slice(0, 13));
      if (roll < errorRate) {
        return { status: 'error', message: 'controller unreachable (timeout after 30s)', retryable: true };
      }
      return {
        status: 'ok',
        accepted: request.grants.length,
        controllerVersion: `a-${hashString(`${request.siteId}|${request.grants.length}`).toString(36).slice(0, 6)}`,
      };
    },

    normalise(raw: RawCheckIn, siteTimezone: string): NormalisedCheckIn {
      // Offset is part of the string, so `new Date` gets the instant right.
      const at = new Date(raw.timestamp);
      if (Number.isNaN(at.getTime())) {
        throw new TypeError(`access-provider-a sent an unparseable timestamp: ${raw.timestamp}`);
      }
      return {
        cardId: raw.cardId,
        doorId: raw.doorId,
        at,
        localDay: localDay(at, siteTimezone as Timezone),
        granted: raw.granted,
      };
    },

    formatTimestamp(at: Date, siteTimezone: string): string {
      const zoned = new Date(at.getTime());
      const offsetMinutes = offsetOf(at, siteTimezone as Timezone);
      const sign = offsetMinutes >= 0 ? '+' : '-';
      const abs = Math.abs(offsetMinutes);
      const local = new Date(zoned.getTime() + offsetMinutes * 60_000);
      const pad = (n: number) => String(n).padStart(2, '0');
      return (
        `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
        `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}` +
        `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
      );
    },
  };
}

/** Minutes east of UTC for `timezone` at `at`. */
export function offsetOf(at: Date, timezone: Timezone): number {
  const parts = zonedParts(at, timezone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - at.getTime()) / 60_000);
}
