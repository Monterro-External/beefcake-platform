import { describe, expect, it } from 'vitest';
import { createFakeSender } from '@/integrations/email/fake-sender';
import type { Message } from '@/integrations/types';

const email = createFakeSender({ channel: 'email', salt: 'test' });
const sms = createFakeSender({ channel: 'sms', salt: 'test' });

function message(over: Partial<Message> = {}): Message {
  return {
    to: 'anna@example.se',
    template: 'payment_failed',
    locale: 'sv-SE',
    variables: { amount: '399,00 kr', attempt: 1 },
    at: new Date('2026-08-26T03:05:00.000Z'),
    ...over,
  };
}

describe('sending', () => {
  it('queues a valid email', () => {
    expect(email.send(message())).toMatchObject({ status: 'queued' });
  });

  it('is deterministic, so the same message keeps the same id', () => {
    expect(email.send(message())).toEqual(email.send(message()));
  });

  it('gives different messages different ids', () => {
    const a = email.send(message({ template: 'receipt' }));
    const b = email.send(message({ template: 'payment_failed' }));
    expect(a).not.toEqual(b);
  });
});

describe('recipient validation', () => {
  it('rejects an address with no domain', () => {
    expect(email.send(message({ to: 'anna@example' }))).toMatchObject({ status: 'rejected' });
  });

  it('rejects an empty recipient', () => {
    expect(email.send(message({ to: '' }))).toMatchObject({ status: 'rejected' });
  });

  it('accepts Nordic phone numbers on the SMS channel', () => {
    for (const to of ['+46701234567', '+4790012345', '+358401234567', '+4520123456']) {
      expect(sms.send(message({ to }))).toMatchObject({ status: 'queued' });
    }
  });

  it('rejects an email address sent down the SMS channel', () => {
    expect(sms.send(message({ to: 'anna@example.se' }))).toMatchObject({ status: 'rejected' });
  });
});
