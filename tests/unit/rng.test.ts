import { describe, expect, it } from 'vitest';
import { createRng, hashString, mix32, unitFor } from '@/lib/rng';

describe('determinism', () => {
  it('gives the same sequence for the same seed', () => {
    const a = createRng('beefcake');
    const b = createRng('beefcake');
    expect(Array.from({ length: 20 }, () => a.next())).toEqual(
      Array.from({ length: 20 }, () => b.next()),
    );
  });

  it('gives different sequences for different seeds', () => {
    expect(createRng('a').next()).not.toBe(createRng('b').next());
  });

  it('derives independent named streams', () => {
    const parent = createRng('root');
    const first = parent.derive('members').next();
    const parentAgain = createRng('root');
    expect(parentAgain.derive('members').next()).toBe(first);
    expect(parentAgain.derive('classes').next()).not.toBe(first);
  });
});

describe('ranges', () => {
  it('int is inclusive at both ends', () => {
    const rng = createRng('ints');
    const seen = new Set(Array.from({ length: 500 }, () => rng.int(1, 3)));
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  it('around stays inside its clamp', () => {
    const rng = createRng('around');
    for (let i = 0; i < 500; i += 1) {
      const value = rng.around(10, 50, 0, 20);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(20);
    }
  });

  it('sample never repeats an item and never exceeds the pool', () => {
    const rng = createRng('sample');
    const picked = rng.sample([1, 2, 3, 4], 10);
    expect(new Set(picked).size).toBe(4);
  });

  it('shuffle keeps every item', () => {
    const rng = createRng('shuffle');
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(rng.shuffle(items).sort((a, b) => a - b)).toEqual(items);
  });
});

describe('unitFor', () => {
  it('is stable for the same key', () => {
    expect(unitFor('a', 'b', 1)).toBe(unitFor('a', 'b', 1));
  });

  it('stays inside the unit interval', () => {
    for (let i = 0; i < 1000; i += 1) {
      const value = unitFor('key', i);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  /**
   * The reason mix32 exists. Raw FNV-1a puts keys that differ only in a
   * trailing counter a fixed distance apart, so a second draw inherits the
   * first one's outcome. That made every payment retry fail whenever the first
   * attempt failed.
   */
  it('decorrelates keys that differ only in a trailing counter', () => {
    const raw = (key: string, n: number) => hashString(`${key}|${n}`) / 4294967296;
    const share = (draw: (key: string, n: number) => number): number => {
      let firstDrawLow = 0;
      let secondDrawAlsoLow = 0;
      for (let i = 0; i < 20_000; i += 1) {
        const key = `chg_${i}`;
        if (draw(key, 1) >= 0.05) continue;
        firstDrawLow += 1;
        if (draw(key, 2) < 0.38) secondDrawAlsoLow += 1;
      }
      return secondDrawAlsoLow / Math.max(1, firstDrawLow);
    };

    // Unmixed: knowing the first draw was in the bottom 5% all but guarantees
    // the second draw is in the bottom 38%.
    expect(share(raw)).toBeGreaterThan(0.9);
    // Mixed: the second draw is independent, so it lands there 38% of the time.
    expect(share((key, n) => unitFor(key, n))).toBeGreaterThan(0.33);
    expect(share((key, n) => unitFor(key, n))).toBeLessThan(0.43);
  });

  it('is roughly uniform over a large sample', () => {
    const buckets = new Array(10).fill(0);
    const n = 20_000;
    for (let i = 0; i < n; i += 1) {
      const bucket = Math.floor(unitFor('uniform', i) * 10);
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }
    for (const count of buckets) {
      expect(count).toBeGreaterThan(n / 10 * 0.9);
      expect(count).toBeLessThan(n / 10 * 1.1);
    }
  });
});

describe('mix32', () => {
  it('returns an unsigned 32-bit integer', () => {
    for (const input of [0, 1, 2 ** 31, 2 ** 32 - 1]) {
      const out = mix32(input);
      expect(Number.isInteger(out)).toBe(true);
      expect(out).toBeGreaterThanOrEqual(0);
      expect(out).toBeLessThan(2 ** 32);
    }
  });
});
