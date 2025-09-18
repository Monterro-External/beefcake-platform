/**
 * Deterministic pseudo-random source. The seed generator must produce the same
 * database on every machine and every run, so `Math.random` is banned in
 * anything under src/db/seed.
 *
 * mulberry32: 32-bit state, fast, good enough for fake data and trivial to
 * reimplement if we ever port the seed to another language.
 */

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  /** True with probability `p`. */
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** `count` distinct items, or all of them if `count` is larger. */
  sample<T>(items: readonly T[], count: number): T[];
  shuffle<T>(items: readonly T[]): T[];
  /** Normal-ish value via the mean of four draws, clamped to [min, max]. */
  around(mean: number, spread: number, min?: number, max?: number): number;
  /** A named child stream, so adding data in one area cannot shift another. */
  derive(name: string): Rng;
}

export function hashString(value: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * Avalanche a 32-bit value so that flipping one input bit changes about half
 * the output bits.
 *
 * FNV-1a on its own does not do this: two strings differing only in the last
 * character hash to values a fixed distance apart, so `hash(x + '1')` and
 * `hash(x + '2')` divided into the unit interval land within about 0.012 of each
 * other. Anything that keys a probability on an attempt number or a sequence
 * index therefore has to mix before it divides, or successive draws are
 * correlated instead of independent.
 */
export function mix32(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x21f0aaad) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x735a2d97) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

/**
 * A stable value in [0, 1) for a set of key parts. Use this, not
 * `hashString(...) / 2**32`, wherever the key parts include a counter.
 */
export function unitFor(...parts: readonly (string | number)[]): number {
  return mix32(hashString(parts.join('|'))) / 4294967296;
}

export function createRng(seed: number | string): Rng {
  let state = (typeof seed === 'string' ? hashString(seed) : seed >>> 0) || 1;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    next,
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    chance: (p) => next() < p,
    pick: (items) => {
      if (items.length === 0) throw new RangeError('pick: empty list');
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    shuffle: (items) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        const a = out[i] as (typeof out)[number];
        const b = out[j] as (typeof out)[number];
        out[i] = b;
        out[j] = a;
      }
      return out;
    },
    sample: (items, count) => rng.shuffle(items).slice(0, Math.min(count, items.length)),
    around: (mean, spread, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) => {
      const draw = (next() + next() + next() + next()) / 4 - 0.5;
      return Math.min(max, Math.max(min, mean + draw * 2 * spread));
    },
    derive: (name) => createRng(hashString(`${state}:${name}`)),
  };

  return rng;
}
