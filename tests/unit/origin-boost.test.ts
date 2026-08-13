// Pure-function coverage for components/home/originBoost.ts (WP-P2
// deliverable 4: TopMovers' Seattle-boost). Only the exported pure function
// is imported (never the React component), so this needs no DOM/jsdom
// environment.

import { describe, expect, it } from 'vitest';

import { applyOriginBoost } from '@/components/home/originBoost';

describe('applyOriginBoost', () => {
  it('flags items whose origin matches the home origin, case-insensitively', () => {
    const items = [
      { slug: 'a', origin: 'sea', changePct: -5 },
      { slug: 'b', origin: 'JFK', changePct: -5 },
    ];
    const result = applyOriginBoost(items, 'SEA');
    expect(result.find((r) => r.slug === 'a')!.isHome).toBe(true);
    expect(result.find((r) => r.slug === 'b')!.isHome).toBe(false);
  });

  it('moves a home-origin item ahead of a non-home item with the same |changePct|', () => {
    const items = [
      { slug: 'jfk-route', origin: 'JFK', changePct: -8 },
      { slug: 'sea-route', origin: 'SEA', changePct: 8 },
    ];
    const result = applyOriginBoost(items, 'SEA');
    expect(result.map((r) => r.slug)).toEqual(['sea-route', 'jfk-route']);
  });

  it('does not disturb relative order across different |changePct| magnitudes', () => {
    // Already ranked by |pct| descending, as lib/markets/movers.ts's
    // rankMoversByAbsChange produces. A home-origin item with a SMALLER
    // magnitude must not jump ahead of a non-home item with a larger one.
    const items = [
      { slug: 'big-drop', origin: 'JFK', changePct: -20 },
      { slug: 'sea-small', origin: 'SEA', changePct: 3 },
      { slug: 'small-drop', origin: 'LAX', changePct: -3 },
    ];
    const result = applyOriginBoost(items, 'SEA');
    // big-drop (20) stays first; sea-small and small-drop tie at magnitude 3,
    // and the home-origin one (sea-small) moves ahead of small-drop within
    // that tie.
    expect(result.map((r) => r.slug)).toEqual(['big-drop', 'sea-small', 'small-drop']);
  });

  it('treats null changePct as its own tie bucket, boosting home-origin within it', () => {
    // Realistic upstream shape: lib/markets/movers.ts#rankMoversByAbsChange
    // already sorts null-change items last, so they arrive here after
    // 'ranked'. The boost is a pure stable re-sort on top of that — it must
    // not pull the null-change group ahead of a ranked item (0 is returned
    // for non-tied magnitude pairs, so their relative order from upstream
    // is preserved); it only reorders WITHIN the null-change tie group.
    const items = [
      { slug: 'ranked', origin: 'LAX', changePct: -10 },
      { slug: 'jfk-null', origin: 'JFK', changePct: null },
      { slug: 'sea-null', origin: 'SEA', changePct: null },
    ];
    const result = applyOriginBoost(items, 'SEA');
    expect(result.map((r) => r.slug)).toEqual(['ranked', 'sea-null', 'jfk-null']);
  });

  it('is a no-op reorder when no item is home-origin', () => {
    const items = [
      { slug: 'a', origin: 'JFK', changePct: -5 },
      { slug: 'b', origin: 'LAX', changePct: -5 },
    ];
    const result = applyOriginBoost(items, 'SEA');
    expect(result.map((r) => r.slug)).toEqual(['a', 'b']);
    expect(result.every((r) => !r.isHome)).toBe(true);
  });

  it('handles an empty list', () => {
    expect(applyOriginBoost([], 'SEA')).toEqual([]);
  });
});
