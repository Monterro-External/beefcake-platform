/**
 * Schema for the Beefcake platform database.
 *
 * Conventions, all of them load-bearing:
 *  - Ids are text, prefixed by type (`ten_`, `mem_`, `sub_`). Readable in logs
 *    and impossible to join to the wrong table by accident.
 *  - `tenant_id` is on every tenant-scoped table, even where it could be derived
 *    through a join. The repository layer filters on it and the reports lean on
 *    the indexes. See docs/adr/0001-tenant-id-on-every-table.md.
 *  - Instants are TEXT, ISO-8601 with a `Z`. Plain calendar dates are TEXT
 *    'YYYY-MM-DD'. Column names ending `_at` are instants, `_on` are plain
 *    dates. Do not mix them.
 *  - Money is an integer of minor units plus a currency column next to it.
 *    There is no bare `amount` column anywhere.
 */

import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const tenants = sqliteTable(
  'tenants',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    orgNumber: text('org_number').notNull(),
    country: text('country', { enum: ['SE', 'NO', 'FI', 'DK'] }).notNull(),
    currency: text('currency', { enum: ['SEK', 'NOK', 'DKK', 'EUR'] }).notNull(),
    locale: text('locale', { enum: ['sv-SE', 'nb-NO', 'da-DK', 'fi-FI', 'en'] }).notNull(),
    segment: text('segment', { enum: ['long_tail', 'mid', 'key_account'] }).notNull(),
    planTier: text('plan_tier', { enum: ['starter', 'growth', 'enterprise'] }).notNull(),
    status: text('status', { enum: ['active', 'churned', 'trial'] }).notNull().default('active'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('tenants_segment_idx').on(t.segment)],
);

export const tenantSettings = sqliteTable(
  'tenant_settings',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    key: text('key').notNull(),
    value: text('value').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] })],
);

export const sites = sqliteTable(
  'sites',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    timezone: text('timezone', {
      enum: ['Europe/Stockholm', 'Europe/Oslo', 'Europe/Helsinki', 'Europe/Copenhagen'],
    }).notNull(),
    addressLine: text('address_line').notNull(),
    city: text('city').notNull(),
    accessProvider: text('access_provider', { enum: ['access-provider-a', 'access-provider-b'] }).notNull(),
    openedOn: text('opened_on').notNull(),
  },
  (t) => [index('sites_tenant_idx').on(t.tenantId)],
);

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    /** Null for Beefcake staff, who are not scoped to a tenant. */
    tenantId: text('tenant_id').references(() => tenants.id),
    siteId: text('site_id').references(() => sites.id),
    email: text('email').notNull(),
    name: text('name').notNull(),
    role: text('role', {
      enum: ['beefcake_admin', 'owner', 'site_manager', 'front_desk', 'member'],
    }).notNull(),
    /** Set when `role` is 'member', so the persona switcher can log in as one. */
    memberId: text('member_id'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('users_email_idx').on(t.email), index('users_tenant_idx').on(t.tenantId)],
);

export const members = sqliteTable(
  'members',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    homeSiteId: text('home_site_id')
      .notNull()
      .references(() => sites.id),
    name: text('name').notNull(),
    email: text('email').notNull(),
    phone: text('phone').notNull(),
    status: text('status', { enum: ['active', 'blocked', 'former'] }).notNull(),
    cardId: text('card_id'),
    birthYear: integer('birth_year').notNull(),
    joinedOn: text('joined_on').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('members_tenant_idx').on(t.tenantId),
    index('members_site_idx').on(t.homeSiteId),
    index('members_tenant_status_idx').on(t.tenantId, t.status),
    uniqueIndex('members_card_idx').on(t.cardId),
  ],
);

export const plans = sqliteTable(
  'plans',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    priceMinor: integer('price_minor').notNull(),
    currency: text('currency', { enum: ['SEK', 'NOK', 'DKK', 'EUR'] }).notNull(),
    interval: text('interval', { enum: ['month', 'year'] }).notNull(),
    bindingMonths: integer('binding_months').notNull().default(0),
    sitesScope: text('sites_scope', { enum: ['home_site', 'all_sites'] }).notNull(),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('plans_tenant_idx').on(t.tenantId)],
);

export const subscriptions = sqliteTable(
  'subscriptions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    memberId: text('member_id')
      .notNull()
      .references(() => members.id),
    planId: text('plan_id')
      .notNull()
      .references(() => plans.id),
    status: text('status', { enum: ['pending', 'active', 'cancelling', 'cancelled'] }).notNull(),
    startedOn: text('started_on').notNull(),
    endsOn: text('ends_on'),
    bindingUntil: text('binding_until'),
    cancelledOn: text('cancelled_on'),
    noticeEndsOn: text('notice_ends_on'),
    cancelReason: text('cancel_reason'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('subscriptions_tenant_idx').on(t.tenantId),
    index('subscriptions_member_idx').on(t.memberId),
    index('subscriptions_status_idx').on(t.tenantId, t.status),
    index('subscriptions_cancelled_idx').on(t.tenantId, t.cancelledOn),
  ],
);

export const freezes = sqliteTable(
  'freezes',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    subscriptionId: text('subscription_id')
      .notNull()
      .references(() => subscriptions.id),
    startsOn: text('starts_on').notNull(),
    endsOn: text('ends_on').notNull(),
    months: integer('months').notNull(),
    reason: text('reason').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('freezes_subscription_idx').on(t.subscriptionId),
    index('freezes_tenant_idx').on(t.tenantId, t.startsOn),
  ],
);

export const classes = sqliteTable(
  'classes',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    name: text('name').notNull(),
    instructorId: text('instructor_id').references(() => users.id),
    startsAt: text('starts_at').notNull(),
    endsAt: text('ends_at').notNull(),
    capacity: integer('capacity').notNull(),
    cancelled: integer('cancelled', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    index('classes_site_starts_idx').on(t.siteId, t.startsAt),
    index('classes_tenant_starts_idx').on(t.tenantId, t.startsAt),
  ],
);

export const bookings = sqliteTable(
  'bookings',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id),
    memberId: text('member_id')
      .notNull()
      .references(() => members.id),
    status: text('status', {
      enum: ['booked', 'waitlisted', 'cancelled', 'attended', 'no_show'],
    }).notNull(),
    position: integer('position'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    index('bookings_class_idx').on(t.classId, t.status),
    index('bookings_member_idx').on(t.memberId),
    uniqueIndex('bookings_class_member_idx').on(t.classId, t.memberId),
  ],
);

export const paymentRuns = sqliteTable(
  'payment_runs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** Billing period, 'YYYY-MM'. */
    period: text('period').notNull(),
    startedAt: text('started_at').notNull(),
    finishedAt: text('finished_at'),
    status: text('status', { enum: ['running', 'completed', 'failed'] }).notNull(),
    chargesAttempted: integer('charges_attempted').notNull().default(0),
    chargesFailed: integer('charges_failed').notNull().default(0),
    totalMinor: integer('total_minor').notNull().default(0),
    currency: text('currency', { enum: ['SEK', 'NOK', 'DKK', 'EUR'] }).notNull(),
    triggeredBy: text('triggered_by').notNull().default('schedule'),
  },
  (t) => [uniqueIndex('payment_runs_tenant_period_idx').on(t.tenantId, t.period)],
);

export const charges = sqliteTable(
  'charges',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    paymentRunId: text('payment_run_id')
      .notNull()
      .references(() => paymentRuns.id),
    memberId: text('member_id')
      .notNull()
      .references(() => members.id),
    subscriptionId: text('subscription_id')
      .notNull()
      .references(() => subscriptions.id),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency', { enum: ['SEK', 'NOK', 'DKK', 'EUR'] }).notNull(),
    status: text('status', {
      enum: ['pending', 'succeeded', 'failed', 'retrying', 'abandoned'],
    }).notNull(),
    method: text('method', {
      enum: ['autogiro', 'avtalegiro', 'card', 'mobilepay', 'vipps'],
    }).notNull(),
    failureCode: text('failure_code'),
    attempt: integer('attempt').notNull().default(1),
    attemptedAt: text('attempted_at').notNull(),
    nextAttemptAt: text('next_attempt_at'),
    settledAt: text('settled_at'),
  },
  (t) => [
    index('charges_run_idx').on(t.paymentRunId),
    index('charges_member_idx').on(t.memberId),
    index('charges_tenant_status_idx').on(t.tenantId, t.status),
    index('charges_next_attempt_idx').on(t.nextAttemptAt),
  ],
);

export const receipts = sqliteTable(
  'receipts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    chargeId: text('charge_id')
      .notNull()
      .references(() => charges.id),
    memberId: text('member_id')
      .notNull()
      .references(() => members.id),
    number: text('number').notNull(),
    issuedAt: text('issued_at').notNull(),
    currency: text('currency', { enum: ['SEK', 'NOK', 'DKK', 'EUR'] }).notNull(),
    totalMinor: integer('total_minor').notNull(),
    vatMinor: integer('vat_minor').notNull().default(0),
    linesJson: text('lines_json').notNull(),
  },
  (t) => [
    uniqueIndex('receipts_number_idx').on(t.tenantId, t.number),
    index('receipts_member_idx').on(t.memberId),
  ],
);

export const accessEvents = sqliteTable(
  'access_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    memberId: text('member_id').references(() => members.id),
    cardId: text('card_id'),
    /** Instant of the swipe, UTC. */
    at: text('at').notNull(),
    /** Site-local calendar day the event is reported under. */
    localDay: text('local_day').notNull(),
    result: text('result', { enum: ['granted', 'denied'] }).notNull(),
    reason: text('reason').notNull(),
    source: text('source', { enum: ['card', 'app_qr', 'front_desk'] }).notNull(),
    provider: text('provider', { enum: ['access-provider-a', 'access-provider-b'] }).notNull(),
  },
  (t) => [
    index('access_events_site_day_idx').on(t.siteId, t.localDay),
    index('access_events_member_idx').on(t.memberId),
    index('access_events_tenant_at_idx').on(t.tenantId, t.at),
  ],
);

export const accessSyncState = sqliteTable('access_sync_state', {
  siteId: text('site_id')
    .primaryKey()
    .references(() => sites.id),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id),
  lastSyncedAt: text('last_synced_at'),
  lastSuccessAt: text('last_success_at'),
  pendingChanges: integer('pending_changes').notNull().default(0),
  lastError: text('last_error'),
});

export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenants.id),
    actorId: text('actor_id'),
    actorRole: text('actor_role'),
    action: text('action').notNull(),
    subjectType: text('subject_type'),
    subjectId: text('subject_id'),
    payloadJson: text('payload_json').notNull().default('{}'),
    at: text('at').notNull(),
  },
  (t) => [
    index('events_tenant_at_idx').on(t.tenantId, t.at),
    index('events_action_idx').on(t.action, t.at),
  ],
);

export const errors = sqliteTable(
  'errors',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenants.id),
    where: text('where').notNull(),
    message: text('message').notNull(),
    stack: text('stack'),
    severity: text('severity', { enum: ['warn', 'error', 'fatal'] }).notNull().default('error'),
    contextJson: text('context_json').notNull().default('{}'),
    at: text('at').notNull(),
  },
  (t) => [index('errors_tenant_at_idx').on(t.tenantId, t.at), index('errors_where_idx').on(t.where)],
);

export const outbox = sqliteTable(
  'outbox',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenants.id),
    channel: text('channel', { enum: ['email', 'sms', 'payment', 'access'] }).notNull(),
    template: text('template'),
    recipient: text('recipient'),
    payloadJson: text('payload_json').notNull(),
    status: text('status', { enum: ['queued', 'sent', 'failed'] }).notNull().default('queued'),
    at: text('at').notNull(),
  },
  (t) => [index('outbox_tenant_channel_idx').on(t.tenantId, t.channel, t.at)],
);

export const jobRuns = sqliteTable(
  'job_runs',
  {
    id: text('id').primaryKey(),
    job: text('job').notNull(),
    tenantId: text('tenant_id').references(() => tenants.id),
    startedAt: text('started_at').notNull(),
    finishedAt: text('finished_at'),
    status: text('status', { enum: ['running', 'completed', 'failed'] }).notNull(),
    summaryJson: text('summary_json').notNull().default('{}'),
  },
  (t) => [index('job_runs_job_idx').on(t.job, t.startedAt)],
);

/** Single-row table recording how the current database was seeded. */
export const seedMeta = sqliteTable('seed_meta', {
  id: integer('id').primaryKey().default(1),
  today: text('today').notNull(),
  seed: text('seed').notNull(),
  scale: text('scale').notNull(),
  generatedAt: text('generated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  schemaVersion: text('schema_version').notNull(),
});

export const schema = {
  tenants,
  tenantSettings,
  sites,
  users,
  members,
  plans,
  subscriptions,
  freezes,
  classes,
  bookings,
  paymentRuns,
  charges,
  receipts,
  accessEvents,
  accessSyncState,
  events,
  errors,
  outbox,
  jobRuns,
  seedMeta,
};

export type Tenant = typeof tenants.$inferSelect;
export type Site = typeof sites.$inferSelect;
export type User = typeof users.$inferSelect;
export type Member = typeof members.$inferSelect;
export type Plan = typeof plans.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type Freeze = typeof freezes.$inferSelect;
export type Class = typeof classes.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type PaymentRun = typeof paymentRuns.$inferSelect;
export type Charge = typeof charges.$inferSelect;
export type Receipt = typeof receipts.$inferSelect;
export type AccessEvent = typeof accessEvents.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type ErrorRow = typeof errors.$inferSelect;
export type OutboxRow = typeof outbox.$inferSelect;
