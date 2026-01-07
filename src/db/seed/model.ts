/**
 * In-memory model the seed builds before it writes anything.
 *
 * Generating rows table by table would mean re-deriving the same facts (which
 * period did this member cancel in, was she frozen in March) in four places.
 * Instead the generator builds one compact record per member, then each table
 * writer reads from it. At full scale this is roughly 50,000 objects, which is
 * nothing next to the row count.
 */

import type { BillingPeriod, PlainDate, Timezone } from '@/domain/dates';
import type { Currency } from '@/domain/money';
import type { AccessProviderName, PaymentMethod } from '@/integrations/types';
import type { TenantBlueprint } from './blueprint';

export interface SeedSite {
  readonly id: string;
  readonly tenantId: string;
  readonly index: number;
  readonly name: string;
  readonly timezone: Timezone;
  readonly accessProvider: AccessProviderName;
  readonly openedOn: PlainDate;
  /** Staff who can be assigned as instructors. */
  readonly staffIds: string[];
}

export interface SeedPlan {
  readonly id: string;
  readonly index: number;
  readonly name: string;
  readonly priceMinor: number;
  readonly currency: Currency;
  readonly bindingMonths: number;
  readonly sitesScope: 'home_site' | 'all_sites';
}

export interface SeedFreeze {
  readonly id: string;
  readonly startsOn: PlainDate;
  readonly endsOn: PlainDate;
  readonly months: number;
  readonly reason: string;
}

export interface SeedPlanChange {
  readonly on: PlainDate;
  readonly fromPlanIndex: number;
  readonly toPlanIndex: number;
}

export interface SeedMember {
  readonly id: string;
  readonly seq: number;
  readonly siteIndex: number;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly birthYear: number;
  readonly cardId: string;
  readonly joinedOn: PlainDate;
  status: 'active' | 'blocked' | 'former';

  readonly subscriptionId: string;
  /** Plan the member is on today (after any change). */
  planIndex: number;
  readonly startedOn: PlainDate;
  bindingUntil: PlainDate | null;
  /** Set once the member has given notice. */
  cancelledOn: PlainDate | null;
  noticeEndsOn: PlainDate | null;
  endsOn: PlainDate | null;
  cancelReason: string | null;
  subscriptionStatus: 'pending' | 'active' | 'cancelling' | 'cancelled';
  /** Why they left, for the churn signal: 'voluntary' or 'payment_failure'. */
  churnDriver: 'voluntary' | 'payment_failure' | null;

  readonly freezes: SeedFreeze[];
  planChange: SeedPlanChange | null;
  readonly method: PaymentMethod;
  /** Null models a mandate that was never set up or has lapsed. */
  readonly mandateId: string | null;
  readonly usesApp: boolean;
}

export interface SeedStaff {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: 'owner' | 'site_manager' | 'front_desk';
  readonly siteIndex: number | null;
}

export interface SeedTenant {
  readonly blueprint: TenantBlueprint;
  readonly id: string;
  readonly createdOn: PlainDate;
  readonly createdAt: string;
  readonly city: string;
  readonly orgNumber: string;
  readonly sites: SeedSite[];
  readonly plans: SeedPlan[];
  readonly members: SeedMember[];
  readonly staff: SeedStaff[];
  /** Periods the tenant existed for, oldest first. */
  readonly livePeriods: BillingPeriod[];
}

export interface SeedWorld {
  readonly tenants: SeedTenant[];
  readonly beefcakeStaff: { id: string; name: string; email: string }[];
}

export interface TableCounts {
  [table: string]: number;
}

export interface SeedSummary {
  readonly today: PlainDate;
  readonly seed: string;
  readonly scale: string;
  readonly counts: TableCounts;
  readonly durationMs: number;
  readonly databasePath: string;
  readonly lastCompletedRun: BillingPeriod;
  readonly nextRunDue: PlainDate;
}
