/**
 * Integration boundaries.
 *
 * Beefcake talks to three classes of external system: a payment provider per
 * market, a door-controller vendor per site, and an email/SMS gateway. None of
 * them run in development or CI, so each has an interface here and a fake in the
 * folder next to it. The fakes are deterministic and write everything they would
 * have sent to the `outbox` table, which is what makes "did the job actually
 * notify the member" inspectable in a test and in the UI.
 *
 * Rules for anything added here:
 *  - The interface describes the *vendor's* model, not ours. Adapters translate.
 *  - Adapters never write to the domain tables. They return values.
 *  - A fake must produce the same answer for the same input, always.
 */

import type { Currency } from '@/domain/money';
import type { FailureCode } from '@/domain/retry-policy';

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export type PaymentMethod = 'autogiro' | 'avtalegiro' | 'card' | 'mobilepay' | 'vipps';

export interface ChargeRequest {
  readonly reference: string;
  readonly tenantId: string;
  readonly memberId: string;
  readonly mandateId: string | null;
  readonly amountMinor: number;
  readonly currency: Currency;
  readonly method: PaymentMethod;
  readonly attempt: number;
  readonly attemptedAt: Date;
  readonly description: string;
}

export type ChargeOutcome =
  | { readonly status: 'succeeded'; readonly providerRef: string; readonly settledAt: Date }
  | { readonly status: 'failed'; readonly providerRef: string; readonly failureCode: FailureCode; readonly message: string };

export interface PaymentProvider {
  readonly name: string;
  readonly supports: readonly PaymentMethod[];
  charge(request: ChargeRequest): ChargeOutcome;
}

// ---------------------------------------------------------------------------
// Access hardware
// ---------------------------------------------------------------------------

export type AccessProviderName = 'access-provider-a' | 'access-provider-b';

/** One entry in the offline allow-list pushed to a door controller. */
export interface AccessGrant {
  readonly cardId: string;
  readonly memberId: string;
  /** Inclusive plain-date window the card is valid for. */
  readonly validFrom: string;
  readonly validTo: string;
}

export interface AccessSyncRequest {
  readonly siteId: string;
  readonly siteTimezone: string;
  readonly grants: readonly AccessGrant[];
  readonly at: Date;
}

export type AccessSyncOutcome =
  | { readonly status: 'ok'; readonly accepted: number; readonly controllerVersion: string }
  | { readonly status: 'error'; readonly message: string; readonly retryable: boolean };

/**
 * A raw check-in as the vendor reports it. The two vendors disagree about
 * timestamps and the adapters are what reconcile them, so this stays deliberately
 * untyped-ish: `timestamp` is whatever string the vendor sends.
 */
export interface RawCheckIn {
  readonly cardId: string;
  readonly doorId: string;
  /** Vendor-specific format. See each adapter. */
  readonly timestamp: string;
  readonly granted: boolean;
}

export interface NormalisedCheckIn {
  readonly cardId: string;
  readonly doorId: string;
  /** UTC instant of the swipe. */
  readonly at: Date;
  /** Site-local calendar day, 'YYYY-MM-DD'. */
  readonly localDay: string;
  readonly granted: boolean;
}

export interface AccessProvider {
  readonly name: AccessProviderName;
  push(request: AccessSyncRequest): AccessSyncOutcome;
  /** Translate a vendor payload into our own model. */
  normalise(raw: RawCheckIn, siteTimezone: string): NormalisedCheckIn;
  /** Format an instant the way this vendor would report it. Used by the seed. */
  formatTimestamp(at: Date, siteTimezone: string): string;
}

// ---------------------------------------------------------------------------
// Email and SMS
// ---------------------------------------------------------------------------

export type MessageTemplate =
  | 'welcome'
  | 'receipt'
  | 'payment_failed'
  | 'payment_retry_scheduled'
  | 'payment_abandoned'
  | 'freeze_confirmed'
  | 'freeze_ending'
  | 'cancellation_confirmed'
  | 'booking_confirmed'
  | 'waitlist_promoted'
  | 'class_cancelled';

export interface Message {
  readonly to: string;
  readonly template: MessageTemplate;
  readonly locale: string;
  readonly variables: Record<string, string | number>;
  readonly at: Date;
}

export type SendOutcome =
  | { readonly status: 'queued'; readonly messageId: string }
  | { readonly status: 'rejected'; readonly reason: string };

export interface EmailSender {
  readonly name: string;
  send(message: Message): SendOutcome;
}
