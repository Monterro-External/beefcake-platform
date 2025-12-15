/**
 * The set of integrations a job or a server action runs against. Constructed in
 * one place so a test can hand in stricter fakes (a PSP that always fails, a
 * controller that is always down) without touching the code under test.
 */

import { createFakeSender } from './email/fake-sender';
import { createFakePsp } from './payment/fake-psp';
import { accessProviders } from './access/registry';
import type { AccessProvider, AccessProviderName, EmailSender, PaymentProvider } from './types';

export interface Integrations {
  readonly payments: PaymentProvider;
  readonly access: Record<AccessProviderName, AccessProvider>;
  readonly email: EmailSender;
  readonly sms: EmailSender;
}

export interface IntegrationOptions {
  readonly failureRate?: number;
  readonly accessErrorRate?: number;
  readonly salt?: string;
}

export function createIntegrations(options: IntegrationOptions = {}): Integrations {
  return {
    payments: createFakePsp({ failureRate: options.failureRate, salt: options.salt }),
    access: accessProviders({ errorRate: options.accessErrorRate, salt: options.salt }),
    email: createFakeSender({ channel: 'email', salt: options.salt }),
    sms: createFakeSender({ channel: 'sms', salt: options.salt }),
  };
}

export * from './types';
export { createFakePsp, defaultMethodFor } from './payment/fake-psp';
export { createFakeSender } from './email/fake-sender';
export { accessProviderFor, accessProviders } from './access/registry';
export { parseWallClock } from './access/provider-b';
export { offsetOf } from './access/provider-a';
