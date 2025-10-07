/**
 * Ids are prefixed and human-readable so that a log line, a CSV export and a
 * support ticket can all be read without a lookup. They are generated from a
 * deterministic counter in the seed and from a random suffix at runtime.
 */

export const ID_PREFIXES = {
  tenant: 'ten',
  site: 'sit',
  user: 'usr',
  member: 'mem',
  plan: 'pln',
  subscription: 'sub',
  freeze: 'frz',
  class: 'cls',
  booking: 'bkg',
  paymentRun: 'run',
  charge: 'chg',
  receipt: 'rcp',
  accessEvent: 'acc',
  event: 'evt',
  error: 'err',
  outbox: 'obx',
  jobRun: 'job',
  card: 'card',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

/** Deterministic id from a stable sequence number. Used by the seed. */
export function sequentialId(kind: IdKind, seq: number): string {
  return `${ID_PREFIXES[kind]}_${seq.toString(36).padStart(7, '0')}`;
}

/** Random id for anything created at runtime. */
export function newId(kind: IdKind): string {
  let suffix = '';
  for (let i = 0; i < 12; i += 1) {
    suffix += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `${ID_PREFIXES[kind]}_${suffix}`;
}

export function kindOf(id: string): IdKind | null {
  const prefix = id.split('_')[0];
  const entry = Object.entries(ID_PREFIXES).find(([, p]) => p === prefix);
  return entry === undefined ? null : (entry[0] as IdKind);
}
