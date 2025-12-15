/**
 * Stand-in for the transactional email and SMS gateway. Nothing leaves the
 * machine: every message is accepted and written to `outbox`, where the tenant
 * app's notification log reads it back. The one rejection path that is modelled
 * is a syntactically invalid recipient, because that is the failure support
 * actually sees.
 */

import { hashString } from '@/lib/rng';
import type { EmailSender, Message, SendOutcome } from '../types';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_RE = /^\+?[0-9 ()-]{6,}$/;

export interface FakeSenderOptions {
  readonly channel?: 'email' | 'sms';
  readonly salt?: string;
}

export function createFakeSender(options: FakeSenderOptions = {}): EmailSender {
  const channel = options.channel ?? 'email';
  const salt = options.salt ?? 'sender';

  return {
    name: `fake-${channel}-gateway`,
    send(message: Message): SendOutcome {
      const valid = channel === 'email' ? EMAIL_RE.test(message.to) : PHONE_RE.test(message.to);
      if (!valid) {
        return { status: 'rejected', reason: `invalid ${channel} recipient: ${message.to}` };
      }
      const messageId = `${channel}_${hashString(`${salt}|${message.to}|${message.template}|${message.at.toISOString()}`).toString(36)}`;
      return { status: 'queued', messageId };
    },
  };
}
