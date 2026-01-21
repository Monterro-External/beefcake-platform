/**
 * Writes the operational trail: check-ins, access sync state, the product event
 * stream, errors and the notification outbox.
 *
 * Two things here are deliberate rather than convenient.
 *
 * Check-ins go through the real provider adapter. The seed builds the instant,
 * asks the adapter to format it the way that vendor would, then feeds the string
 * back through `normalise` exactly as the webhook handler does. So the site-local
 * day stored on every access event is the adapter's answer, not the seed's. If
 * an adapter gets timezones wrong, the seeded reports are wrong in the same way
 * production would be, which is the point.
 *
 * The event, error and outbox streams are derived by reading back the rows the
 * earlier writers produced rather than by re-deriving the same facts. A failed
 * charge in `charges` and a `charge.failed` row in `events` cannot disagree.
 */

import {
  type PlainDate,
  type Timezone,
  addDays,
  atLocalTime,
  dayOfWeek,
  eachDay,
} from '@/domain/dates';
import { evaluateAccess } from '@/domain/access-rules';
import { readSettings } from '@/domain/tenant-settings';
import { accessProviders } from '@/integrations/access/registry';
import { createRng, mix32, hashString, type Rng } from '@/lib/rng';
import { sequentialId } from '../ids';
import type { Sqlite } from '../client';
import { BulkInserter } from './writer';
import type { SeedMember, SeedSite, SeedTenant, SeedWorld, TableCounts } from './model';
import type { Anchors } from './options';
import { holdsCard } from './people';
import type { ScheduleResult } from './write-schedule';


/**
 * Read a table in pages rather than with an open cursor.
 *
 * better-sqlite3 will not let the same connection write while an iterator is
 * open, and these loops insert derived event rows as they read. Paging by `id`
 * keeps memory bounded without holding a statement open across the writes.
 */
function eachRowPaged<T extends { id: string }>(
  sqlite: Sqlite,
  sql: string,
  pageSize: number,
  onRow: (row: T) => void,
): void {
  const statement = sqlite.prepare(sql);
  let cursor = '';
  for (;;) {
    const rows = statement.all(cursor, pageSize) as T[];
    if (rows.length === 0) return;
    for (const row of rows) onRow(row);
    cursor = rows[rows.length - 1]?.id ?? '';
    if (rows.length < pageSize) return;
  }
}

const PAGE_SIZE = 20_000;

/** How far back the notification outbox is kept. */
const OUTBOX_DAYS = 60;

export interface ActivityInput {
  readonly world: SeedWorld;
  readonly anchors: Anchors;
  readonly seed: string;
  readonly schedule: ScheduleResult;
  readonly dailyVisitRate: number;
  readonly eventSampleRate: number;
}

export function writeActivity(sqlite: Sqlite, input: ActivityInput, counts: TableCounts): void {
  const syncEvents = writeAccess(sqlite, input, counts);
  writeEvents(sqlite, input, syncEvents, counts);
}

// ---------------------------------------------------------------------------
// Check-ins and sync state
// ---------------------------------------------------------------------------

/** Check-ins by local hour. Two peaks: before work and after it. */
const HOUR_WEIGHTS: readonly number[] = [
  0.2, 0.1, 0.05, 0.05, 0.1, 1.2, 4.5, 5.5, 3.5, 2.5, 2.2, 2.4, 2.6, 2.4, 2.6, 3.4, 6.5, 8.5, 8.0,
  6.0, 3.8, 2.2, 1.2, 0.6,
];

function pickHour(rng: Rng, lateTail: boolean): number {
  const weights = lateTail
    ? HOUR_WEIGHTS.map((w, hour) => (hour >= 22 ? w * 4.5 : w))
    : HOUR_WEIGHTS;
  const total = weights.reduce((a, b) => a + b, 0);
  let cursor = rng.next() * total;
  for (let hour = 0; hour < weights.length; hour += 1) {
    cursor -= weights[hour] as number;
    if (cursor <= 0) return hour;
  }
  return 18;
}

function dayFactor(day: PlainDate): number {
  const dow = dayOfWeek(day);
  let factor = 1;
  if (dow === 0) factor *= 0.62;
  if (dow === 6) factor *= 0.7;
  if (dow === 1) factor *= 1.14;
  const month = Number.parseInt(day.slice(5, 7), 10);
  if (month === 1) factor *= 1.3;
  if (month === 7) factor *= 0.62;
  if (month === 8) factor *= 0.88;
  if (month === 12) factor *= 0.82;
  return factor;
}

function writeAccess(sqlite: Sqlite, input: ActivityInput, counts: TableCounts): SyncEvent[] {
  const { world, anchors, seed, dailyVisitRate } = input;
  const providers = accessProviders({ errorRate: 0.02, salt: `${seed}|access` });

  const eventRows = new BulkInserter(sqlite, 'access_events', [
    'id',
    'tenantId',
    'siteId',
    'memberId',
    'cardId',
    'at',
    'localDay',
    'result',
    'reason',
    'source',
    'provider',
  ]);
  const syncRows = new BulkInserter(sqlite, 'access_sync_state', [
    'siteId',
    'tenantId',
    'lastSyncedAt',
    'lastSuccessAt',
    'pendingChanges',
    'lastError',
  ]);
  const syncEvents: SyncEvent[] = [];

  let accessSeq = 0;
  const days = eachDay(anchors.accessFrom, anchors.today);

  for (const tenant of world.tenants) {
    const settings = readSettings(
      Object.entries(tenant.blueprint.settings).map(([key, value]) => ({ key, value })),
    );

    for (const site of tenant.sites) {
      const rng = createRng(`${seed}|access|${site.id}`);
      const provider = providers[site.accessProvider];
      // Provider B sites are the older estate and tend to be the late-opening
      // ones, which is why their evening tail is longer.
      const lateTail = site.accessProvider === 'access-provider-b';
      // Archived members do not turn up at the door: they left months ago and
      // handed the card back. Members whose subscription lapsed recently do,
      // which is where the interesting denials come from.
      const siteMembers = tenant.members.filter(
        (m) => m.siteIndex === site.index && m.status !== 'former',
      );
      if (siteMembers.length === 0) continue;
      const problemMembers = siteMembers.filter(
        (m) => m.freezes.length > 0 || m.endsOn !== null || m.status === 'blocked',
      );

      let lastSuccessAt: string | null = null;
      let lastSyncedAt: string | null = null;
      let lastError: string | null = null;
      let pendingChanges = 0;

      for (const day of days) {
        if (day < site.openedOn) continue;

        // The sync job runs nightly per site.
        const syncAt = atLocalTime(day, site.timezone, 2, 15);
        const grants = Math.round(siteMembers.length * 0.92);
        const outcome = provider.push({
          siteId: site.id,
          siteTimezone: site.timezone,
          grants: [],
          at: syncAt,
        });
        lastSyncedAt = syncAt.toISOString();
        if (outcome.status === 'ok') {
          lastSuccessAt = lastSyncedAt;
          lastError = null;
          pendingChanges = 0;
          syncEvents.push({
            tenantId: tenant.id,
            siteId: site.id,
            at: lastSyncedAt,
            ok: true,
            grants,
            message: null,
          });
        } else {
          lastError = outcome.message;
          pendingChanges += rng.int(3, 40);
          syncEvents.push({
            tenantId: tenant.id,
            siteId: site.id,
            at: lastSyncedAt,
            ok: false,
            grants,
            message: outcome.message,
          });
        }

        const visits = Math.max(
          0,
          Math.round(siteMembers.length * dailyVisitRate * dayFactor(day) * rng.around(1, 0.12, 0.6, 1.4)),
        );

        for (let v = 0; v < visits; v += 1) {
          // A small share of swipes are people who should not get in: someone
          // mid-freeze who forgot, someone who cancelled last week.
          const fromProblemPool = problemMembers.length > 0 && rng.chance(0.09);
          const pool = fromProblemPool ? problemMembers : siteMembers;
          const member = pickByStride(pool, mix32(hashString(`${site.id}|${day}|${v}`)));
          if (member === null) continue;
          if (member.joinedOn > day) continue;

          const hour = pickHour(rng, lateTail);
          const at = atLocalTime(day, site.timezone, hour, rng.int(0, 59), rng.int(0, 59));
          if (at.getTime() > Date.parse(`${anchors.today}T23:59:59.000Z`)) continue;

          const source = rng.chance(member.usesApp ? 0.32 : 0.06)
            ? 'app_qr'
            : rng.chance(0.02)
              ? 'front_desk'
              : 'card';

          // The card is unreadable or off the system now and then.
          const cardKnown = holdsCard(member) && rng.chance(0.997);
          const cardId = holdsCard(member) ? member.cardId : null;

          const decision = evaluateAccess({
            at,
            timezone: site.timezone,
            siteId: site.id,
            cardKnown,
            memberStatus: member.status,
            subscription: subscriptionSnapshotOf(member, tenant, site),
            freezes: member.freezes,
            rules: { accessGraceHours: settings.accessGraceHours },
          });

          // Round-trip through the vendor's own wire format, exactly as the
          // webhook handler does, so the stored local day is the adapter's.
          const normalised = provider.normalise(
            {
              cardId: cardId ?? 'unknown',
              doorId: `${site.id}-main`,
              timestamp: provider.formatTimestamp(at, site.timezone),
              granted: decision.result === 'granted',
            },
            site.timezone,
          );

          accessSeq += 1;
          eventRows.push({
            id: sequentialId('accessEvent', accessSeq),
            tenantId: tenant.id,
            siteId: site.id,
            memberId: cardKnown ? member.id : null,
            cardId,
            at: normalised.at.toISOString(),
            localDay: normalised.localDay,
            result: decision.result,
            reason: decision.reason,
            source,
            provider: site.accessProvider,
          });
        }
      }

      syncRows.push({
        siteId: site.id,
        tenantId: tenant.id,
        lastSyncedAt,
        lastSuccessAt,
        pendingChanges,
        lastError,
      });
    }
  }

  counts.access_events = eventRows.flush();
  counts.access_sync_state = syncRows.flush();
  return syncEvents;
}

interface SyncEvent {
  readonly tenantId: string;
  readonly siteId: string;
  readonly at: string;
  readonly ok: boolean;
  readonly grants: number;
  readonly message: string | null;
}

function subscriptionSnapshotOf(member: SeedMember, tenant: SeedTenant, site: SeedSite) {
  const plan = tenant.plans[member.planIndex];
  return {
    id: member.subscriptionId,
    startsOn: member.startedOn,
    endsOn: member.endsOn,
    sitesScope: plan?.sitesScope ?? 'home_site',
    homeSiteId: site.id,
  };
}

function pickByStride(members: readonly SeedMember[], cursor: number): SeedMember | null {
  if (members.length === 0) return null;
  return members[cursor % members.length] ?? null;
}

// ---------------------------------------------------------------------------
// Events, errors and outbox
// ---------------------------------------------------------------------------

function writeEvents(
  sqlite: Sqlite,
  input: ActivityInput,
  syncEvents: readonly SyncEvent[],
  counts: TableCounts,
): void {
  const { world, anchors, seed, schedule, eventSampleRate } = input;

  const eventRows = new BulkInserter(sqlite, 'events', [
    'id',
    'tenantId',
    'actorId',
    'actorRole',
    'action',
    'subjectType',
    'subjectId',
    'payloadJson',
    'at',
  ]);
  const errorRows = new BulkInserter(sqlite, 'errors', [
    'id',
    'tenantId',
    'where',
    'message',
    'stack',
    'severity',
    'contextJson',
    'at',
  ]);
  const outboxRows = new BulkInserter(sqlite, 'outbox', [
    'id',
    'tenantId',
    'channel',
    'template',
    'recipient',
    'payloadJson',
    'status',
    'at',
  ]);

  let eventSeq = 0;
  let errorSeq = 0;
  let outboxSeq = 0;
  const outboxFrom = `${addDays(anchors.today, -OUTBOX_DAYS)}T00:00:00.000Z`;

  const event = (
    tenantId: string | null,
    at: string,
    action: string,
    over: {
      actorId?: string | null;
      actorRole?: string | null;
      subjectType?: string;
      subjectId?: string;
      payload?: Record<string, unknown>;
    } = {},
  ): void => {
    eventSeq += 1;
    eventRows.push({
      id: sequentialId('event', eventSeq),
      tenantId,
      actorId: over.actorId ?? null,
      actorRole: over.actorRole ?? null,
      action,
      subjectType: over.subjectType ?? null,
      subjectId: over.subjectId ?? null,
      payloadJson: JSON.stringify(over.payload ?? {}),
      at,
    });
  };

  const memberIndex = new Map<string, { tenant: SeedTenant; member: SeedMember }>();
  for (const tenant of world.tenants) {
    for (const member of tenant.members) memberIndex.set(member.id, { tenant, member });
  }

  // --- from the member base -------------------------------------------------
  for (const tenant of world.tenants) {
    const rng = createRng(`${seed}|events|${tenant.id}`);
    const owner = tenant.staff.find((s) => s.role === 'owner');
    const frontDesk = tenant.staff.filter((s) => s.role === 'front_desk');
    const oneYearAgo = addDays(anchors.today, -365);

    for (const [key, value] of Object.entries(tenant.blueprint.settings)) {
      event(tenant.id, `${addDays(tenant.createdOn, 3)}T10:05:00.000Z`, 'settings.changed', {
        actorId: owner?.id ?? null,
        actorRole: 'owner',
        subjectType: 'setting',
        subjectId: key,
        payload: { key, value },
      });
    }

    for (const member of tenant.members) {
      const desk = frontDesk[member.seq % Math.max(1, frontDesk.length)];

      if (member.joinedOn >= oneYearAgo) {
        event(tenant.id, `${member.joinedOn}T10:00:00.000Z`, 'member.created', {
          actorId: desk?.id ?? null,
          actorRole: 'front_desk',
          subjectType: 'member',
          subjectId: member.id,
          payload: { site_index: member.siteIndex, source: member.usesApp ? 'app' : 'front_desk' },
        });
        event(tenant.id, `${member.joinedOn}T10:02:00.000Z`, 'subscription.created', {
          actorId: desk?.id ?? null,
          actorRole: 'front_desk',
          subjectType: 'subscription',
          subjectId: member.subscriptionId,
          payload: { plan_id: tenant.plans[member.planIndex]?.id },
        });
      }

      if (member.status === 'blocked') {
        event(tenant.id, `${addDays(anchors.today, -rng.int(5, 200))}T11:00:00.000Z`, 'member.blocked', {
          actorId: owner?.id ?? null,
          actorRole: 'owner',
          subjectType: 'member',
          subjectId: member.id,
          payload: { reason: 'unpaid_balance' },
        });
      }

      for (const freeze of member.freezes) {
        const at = `${addDays(freeze.startsOn, -rng.int(0, 10))}T14:${String(rng.int(0, 59)).padStart(2, '0')}:00.000Z`;
        event(tenant.id, at, 'subscription.frozen', {
          actorId: desk?.id ?? null,
          actorRole: 'front_desk',
          subjectType: 'subscription',
          subjectId: member.subscriptionId,
          payload: {
            starts_on: freeze.startsOn,
            ends_on: freeze.endsOn,
            months: freeze.months,
            reason: freeze.reason,
          },
        });
        if (at >= outboxFrom) {
          outboxSeq += 1;
          outboxRows.push({
            id: sequentialId('outbox', outboxSeq),
            tenantId: tenant.id,
            channel: 'email',
            template: 'freeze_confirmed',
            recipient: member.email,
            payloadJson: JSON.stringify({ starts_on: freeze.startsOn, ends_on: freeze.endsOn }),
            status: 'sent',
            at,
          });
        }
      }

      if (member.planChange !== null) {
        event(tenant.id, `${member.planChange.on}T13:00:00.000Z`, 'subscription.plan_changed', {
          actorId: desk?.id ?? null,
          actorRole: 'front_desk',
          subjectType: 'subscription',
          subjectId: member.subscriptionId,
          payload: {
            from_plan_id: tenant.plans[member.planChange.fromPlanIndex]?.id,
            to_plan_id: tenant.plans[member.planChange.toPlanIndex]?.id,
            effective_on: member.planChange.on,
          },
        });
      }

      if (member.cancelledOn !== null) {
        const at = `${member.cancelledOn}T16:${String(rng.int(0, 59)).padStart(2, '0')}:00.000Z`;
        event(tenant.id, at, 'subscription.cancelled', {
          actorId: member.churnDriver === 'payment_failure' ? null : (desk?.id ?? null),
          actorRole: member.churnDriver === 'payment_failure' ? 'system' : 'front_desk',
          subjectType: 'subscription',
          subjectId: member.subscriptionId,
          payload: {
            reason: member.cancelReason,
            driver: member.churnDriver,
            notice_ends_on: member.noticeEndsOn,
            ends_on: member.endsOn,
          },
        });
        if (at >= outboxFrom) {
          outboxSeq += 1;
          outboxRows.push({
            id: sequentialId('outbox', outboxSeq),
            tenantId: tenant.id,
            channel: 'email',
            template: 'cancellation_confirmed',
            recipient: member.email,
            payloadJson: JSON.stringify({ ends_on: member.endsOn, reason: member.cancelReason }),
            status: 'sent',
            at,
          });
        }
      }

      // Member app sessions, sampled: this is the adoption signal.
      if (member.usesApp && member.status === 'active') {
        const sessions = Math.round(rng.around(4, 3, 0, 12));
        for (let s = 0; s < sessions; s += 1) {
          if (!rng.chance(0.55)) continue;
          const at = `${addDays(anchors.today, -rng.int(0, 30))}T${String(rng.int(6, 22)).padStart(2, '0')}:${String(rng.int(0, 59)).padStart(2, '0')}:00.000Z`;
          event(tenant.id, at, 'member_app.session', {
            actorId: member.id,
            actorRole: 'member',
            subjectType: 'member',
            subjectId: member.id,
            payload: { screens: rng.int(1, 7), platform: rng.chance(0.6) ? 'ios' : 'android' },
          });
        }
      }
    }

    // Operators looking at reports. Owners of key accounts live in there.
    const reportViews = tenant.blueprint.segment === 'key_account' ? 90 : 26;
    for (let i = 0; i < reportViews; i += 1) {
      const day = addDays(anchors.today, -rng.int(0, 180));
      const at = `${day}T${String(rng.int(8, 17)).padStart(2, '0')}:${String(rng.int(0, 59)).padStart(2, '0')}:00.000Z`;
      const report = rng.pick(['churn', 'revenue', 'failed_payments', 'class_fill', 'access']);
      event(tenant.id, at, 'report.viewed', {
        actorId: owner?.id ?? null,
        actorRole: 'owner',
        subjectType: 'report',
        subjectId: report,
        payload: { report, range_days: rng.pick([30, 90, 180, 365]) },
      });

      if (rng.chance(0.3)) {
        const exportAt = `${day}T${String(rng.int(8, 17)).padStart(2, '0')}:${String(rng.int(0, 59)).padStart(2, '0')}:30.000Z`;
        const memberCount = tenant.members.filter((m) => m.status !== 'former').length;
        event(tenant.id, exportAt, 'report.exported', {
          actorId: owner?.id ?? null,
          actorRole: 'owner',
          subjectType: 'report',
          subjectId: report,
          payload: { report, format: 'csv', members: memberCount },
        });

        // Big exports are slow, and sometimes they do not finish.
        if (memberCount > 4000 && rng.chance(0.22)) {
          errorSeq += 1;
          errorRows.push({
            id: sequentialId('error', errorSeq),
            tenantId: tenant.id,
            where: 'export/reports',
            message: `Report export timed out after 30000ms (report=${report}, members=${memberCount})`,
            stack:
              'Error: query timeout\n    at runReport (src/export/reports.ts:118:11)\n    at exportCsv (src/export/reports.ts:64:22)',
            severity: 'error',
            contextJson: JSON.stringify({ report, members: memberCount, timeout_ms: 30000 }),
            at: exportAt,
          });
        }
      }
    }
  }

  // --- from the schedule ----------------------------------------------------
  for (const promotion of schedule.promotions) {
    const entry = memberIndex.get(promotion.memberId);
    event(promotion.tenantId, promotion.at, 'booking.promoted', {
      actorId: null,
      actorRole: 'system',
      subjectType: 'booking',
      subjectId: promotion.bookingId,
      payload: { from: 'waitlist' },
    });
    if (promotion.at >= outboxFrom && entry !== undefined) {
      outboxSeq += 1;
      outboxRows.push({
        id: sequentialId('outbox', outboxSeq),
        tenantId: promotion.tenantId,
        channel: 'email',
        template: 'waitlist_promoted',
        recipient: entry.member.email,
        payloadJson: JSON.stringify({ booking_id: promotion.bookingId }),
        status: 'sent',
        at: promotion.at,
      });
    }
  }

  // --- from the rows already written ---------------------------------------
  eachRowPaged<Record<string, string | number> & { id: string }>(
    sqlite,
    'select id, tenant_id as tenantId, period, started_at as startedAt, finished_at as finishedAt, charges_attempted as attempted, charges_failed as failed, total_minor as totalMinor, currency from payment_runs where id > ? order by id limit ?',
    PAGE_SIZE,
    (row) => {
    const tenantId = String(row.tenantId);
    event(tenantId, String(row.startedAt), 'payment_run.started', {
      actorRole: 'system',
      subjectType: 'payment_run',
      subjectId: String(row.id),
      payload: { period: row.period },
    });
    event(tenantId, String(row.finishedAt), 'payment_run.completed', {
      actorRole: 'system',
      subjectType: 'payment_run',
      subjectId: String(row.id),
      payload: {
        period: row.period,
        attempted: row.attempted,
        failed: row.failed,
        total_minor: row.totalMinor,
        currency: row.currency,
      },
    });
    },
  );

  eachRowPaged<Record<string, string | number | null> & { id: string }>(
    sqlite,
    "select id, tenant_id as tenantId, member_id as memberId, amount_minor as amountMinor, currency, status, failure_code as failureCode, attempt, attempted_at as attemptedAt, next_attempt_at as nextAttemptAt from charges where status in ('failed','abandoned','retrying') and id > ? order by id limit ?",
    PAGE_SIZE,
    (row) => {
    const tenantId = String(row.tenantId);
    const at = String(row.attemptedAt);
    const memberId = String(row.memberId);
    event(tenantId, at, 'charge.failed', {
      actorRole: 'system',
      subjectType: 'charge',
      subjectId: String(row.id),
      payload: {
        failure_code: row.failureCode,
        attempt: row.attempt,
        amount_minor: row.amountMinor,
        currency: row.currency,
      },
    });
    if (row.status === 'retrying' && row.nextAttemptAt !== null) {
      event(tenantId, at, 'charge.retry_scheduled', {
        actorRole: 'system',
        subjectType: 'charge',
        subjectId: String(row.id),
        payload: { next_attempt_at: row.nextAttemptAt, attempt: row.attempt },
      });
    }
    if (row.status === 'abandoned') {
      event(tenantId, at, 'charge.abandoned', {
        actorRole: 'system',
        subjectType: 'charge',
        subjectId: String(row.id),
        payload: { failure_code: row.failureCode, attempts: row.attempt },
      });
    }
    if (row.failureCode === 'technical') {
      errorSeq += 1;
      errorRows.push({
        id: sequentialId('error', errorSeq),
        tenantId,
        where: 'integrations/payment',
        message: `Provider returned 502 for charge ${String(row.id)}`,
        stack:
          'Error: upstream 502\n    at FakePsp.charge (src/integrations/payment/fake-psp.ts:88:14)\n    at runPaymentRun (src/jobs/payment-run.ts:141:26)',
        severity: 'warn',
        contextJson: JSON.stringify({ charge_id: row.id, attempt: row.attempt }),
        at,
      });
    }
    const entry = memberIndex.get(memberId);
    if (at >= outboxFrom && entry !== undefined) {
      outboxSeq += 1;
      outboxRows.push({
        id: sequentialId('outbox', outboxSeq),
        tenantId,
        channel: 'email',
        template: row.status === 'abandoned' ? 'payment_abandoned' : 'payment_failed',
        recipient: entry.member.email,
        payloadJson: JSON.stringify({
          amount_minor: row.amountMinor,
          currency: row.currency,
          attempt: row.attempt,
          next_attempt_at: row.nextAttemptAt,
        }),
        status: 'sent',
        at,
      });
    }
    },
  );

  // Bookings are the highest-volume table, so the funnel events are sampled.
  let bookingCursor = 0;
  const sampleEvery = Math.max(1, Math.round(1 / Math.max(eventSampleRate, 0.0001)));
  eachRowPaged<Record<string, string> & { id: string }>(
    sqlite,
    'select id, tenant_id as tenantId, member_id as memberId, status, created_at as createdAt from bookings where id > ? order by id limit ?',
    PAGE_SIZE,
    (row) => {
      bookingCursor += 1;
      if (bookingCursor % sampleEvery !== 0) return;
      const action = row.status === 'waitlisted' ? 'booking.waitlisted' : 'booking.created';
      event(String(row.tenantId), String(row.createdAt), action, {
        actorId: String(row.memberId),
        actorRole: 'member',
        subjectType: 'booking',
        subjectId: String(row.id),
        payload: { sampled: true, sample_every: sampleEvery },
      });
    },
  );

  // Nightly access sync, one event per site per night.
  for (const sync of syncEvents) {
    event(sync.tenantId, sync.at, sync.ok ? 'access.sync_completed' : 'access.sync_failed', {
      actorRole: 'system',
      subjectType: 'site',
      subjectId: sync.siteId,
      payload: sync.ok ? { grants: sync.grants } : { grants: sync.grants, error: sync.message },
    });
    if (!sync.ok) {
      errorSeq += 1;
      errorRows.push({
        id: sequentialId('error', errorSeq),
        tenantId: sync.tenantId,
        where: 'jobs/access-sync',
        message: sync.message ?? 'access sync failed',
        stack:
          'Error: controller push failed\n    at syncSite (src/jobs/access-sync.ts:73:13)\n    at runAccessSync (src/jobs/access-sync.ts:34:20)',
        severity: 'error',
        contextJson: JSON.stringify({ site_id: sync.siteId }),
        at: sync.at,
      });
    }
  }

  // Beefcake staff opening a tenant read-only to answer a support call.
  const impersonationRng = createRng(`${seed}|impersonation`);
  for (let i = 0; i < 40; i += 1) {
    const tenant = impersonationRng.pick(world.tenants);
    const staff = impersonationRng.pick(world.beefcakeStaff);
    const at = `${addDays(anchors.today, -impersonationRng.int(0, 60))}T${String(impersonationRng.int(8, 17)).padStart(2, '0')}:${String(impersonationRng.int(0, 59)).padStart(2, '0')}:00.000Z`;
    event(tenant.id, at, 'impersonation.started', {
      actorId: staff.id,
      actorRole: 'beefcake_admin',
      subjectType: 'tenant',
      subjectId: tenant.id,
      payload: { mode: 'read_only', reason: 'support_ticket' },
    });
  }

  counts.events = eventRows.flush();
  counts.errors = errorRows.flush();
  counts.outbox = outboxRows.flush();
}

export type { Timezone };
