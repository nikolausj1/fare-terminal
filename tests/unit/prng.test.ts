import { describe, expect, it } from 'vitest';

import { createRng, gaussian, int, pick, seedFrom } from '@/db/seed/prng';

describe('prng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it('always returns values in [0, 1)', () => {
    const rng = createRng(12345);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('seedFrom is deterministic for the same inputs', () => {
    expect(seedFrom('sea-fco', 1700000000000, 'FLEXIBLE')).toBe(
      seedFrom('sea-fco', 1700000000000, 'FLEXIBLE')
    );
    expect(seedFrom('sea-fco', 1700000000000, 'FLEXIBLE')).not.toBe(
      seedFrom('sea-fco', 1700000000001, 'FLEXIBLE')
    );
  });

  it('int() stays within [min, max] inclusive', () => {
    const rng = createRng(7);
    for (let i = 0; i < 500; i++) {
      const v = int(rng, 12, 35);
      expect(v).toBeGreaterThanOrEqual(12);
      expect(v).toBeLessThanOrEqual(35);
    }
  });

  it('pick() only returns elements from the input array', () => {
    const rng = createRng(9);
    const items = ['a', 'b', 'c'];
    for (let i = 0; i < 100; i++) {
      expect(items).toContain(pick(rng, items));
    }
  });

  it('gaussian() is deterministic for a given seed', () => {
    const rngA = createRng(99);
    const rngB = createRng(99);
    const a = gaussian(rngA, 100, 10);
    const b = gaussian(rngB, 100, 10);
    expect(a).toBe(b);
  });
});
