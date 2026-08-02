// WP-F4 §2: unit coverage for the pure color-scale/stats helpers backing
// components/market/DateHeatmap.tsx. Only exercises the pure functions (no
// rendering/DOM) — the component's own behavior is covered by manual
// Playwright screenshot verification against real.db (see the WP-F4 final
// report) and the existing tests/e2e suite, which the market page's new
// heatmap section must not break.

import { describe, expect, it } from 'vitest';

import { heatmapHasNoData, heatmapVisibleStats, priceToHeatmapColor } from '@/components/market/dateHeatmapMath';
import type { HeatmapMonthVM } from '@/lib/markets/heatmap';

function makeMonth(overrides: Partial<HeatmapMonthVM> = {}): HeatmapMonthVM {
  return {
    month: '2026-08',
    days: [],
    coveragePct: 0,
    ...overrides,
  };
}

describe('priceToHeatmapColor', () => {
  it('returns the cheapest-end color at the minimum price', () => {
    const c = priceToHeatmapColor(10000, 10000, 30000, 1);
    // Green-ish: g channel should dominate r/b at the cheap end.
    const [r, g, b] = c.match(/[\d.]+/g)!.map(Number);
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });

  it('returns the priciest-end color at the maximum price', () => {
    const c = priceToHeatmapColor(30000, 10000, 30000, 1);
    const [r, g] = c.match(/[\d.]+/g)!.map(Number);
    expect(r).toBeGreaterThan(g);
  });

  it('clamps prices outside [min, max] instead of extrapolating', () => {
    const below = priceToHeatmapColor(0, 10000, 30000, 1);
    const atMin = priceToHeatmapColor(10000, 10000, 30000, 1);
    expect(below).toBe(atMin);

    const above = priceToHeatmapColor(999999, 10000, 30000, 1);
    const atMax = priceToHeatmapColor(30000, 10000, 30000, 1);
    expect(above).toBe(atMax);
  });

  it('degenerate case: min === max (single observed price) returns a fixed neutral color, no NaN/divide-by-zero', () => {
    const c = priceToHeatmapColor(15000, 15000, 15000, 1);
    expect(c).not.toContain('NaN');
    // Same color regardless of the (irrelevant, since min===max) price value.
    expect(priceToHeatmapColor(1, 15000, 15000, 1)).toBe(c);
    expect(priceToHeatmapColor(999999, 15000, 15000, 1)).toBe(c);
  });

  it('degenerate case: max < min (malformed input) also falls back to the neutral color rather than throwing', () => {
    expect(() => priceToHeatmapColor(15000, 20000, 10000, 1)).not.toThrow();
  });

  it('applies the requested alpha', () => {
    const c = priceToHeatmapColor(15000, 10000, 30000, 0.4);
    expect(c).toMatch(/, 0\.4\)$/);
  });
});

describe('heatmapVisibleStats', () => {
  it('returns null when no month has any OBSERVED cell', () => {
    const months = [
      makeMonth({
        days: [
          { date: '2026-08-01', priceMinor: null, transfers: null, observedAt: null, cellState: 'NO_DATA' },
          { date: '2026-08-02', priceMinor: null, transfers: null, observedAt: null, cellState: 'NO_DATA' },
        ],
      }),
    ];
    expect(heatmapVisibleStats(months)).toBeNull();
    expect(heatmapHasNoData(months)).toBe(true);
  });

  it('computes min/median/max across OBSERVED cells only, ignoring NO_DATA cells', () => {
    const months = [
      makeMonth({
        month: '2026-08',
        days: [
          { date: '2026-08-01', priceMinor: 20000, transfers: 0, observedAt: 1, cellState: 'OBSERVED' },
          { date: '2026-08-02', priceMinor: null, transfers: null, observedAt: null, cellState: 'NO_DATA' },
          { date: '2026-08-03', priceMinor: 10000, transfers: 1, observedAt: 1, cellState: 'OBSERVED' },
        ],
      }),
      makeMonth({
        month: '2026-09',
        days: [{ date: '2026-09-01', priceMinor: 30000, transfers: 0, observedAt: 1, cellState: 'OBSERVED' }],
      }),
    ];
    const stats = heatmapVisibleStats(months);
    expect(stats).toEqual({ minMinor: 10000, medianMinor: 20000, maxMinor: 30000, observedCount: 3 });
    expect(heatmapHasNoData(months)).toBe(false);
  });

  it('averages the two middle values for an even-length observed set', () => {
    const months = [
      makeMonth({
        days: [
          { date: '2026-08-01', priceMinor: 10000, transfers: 0, observedAt: 1, cellState: 'OBSERVED' },
          { date: '2026-08-02', priceMinor: 20000, transfers: 0, observedAt: 1, cellState: 'OBSERVED' },
          { date: '2026-08-03', priceMinor: 30000, transfers: 0, observedAt: 1, cellState: 'OBSERVED' },
          { date: '2026-08-04', priceMinor: 40000, transfers: 0, observedAt: 1, cellState: 'OBSERVED' },
        ],
      }),
    ];
    expect(heatmapVisibleStats(months)?.medianMinor).toBe(25000);
  });

  it('single-observed-cell case: min === median === max', () => {
    const months = [
      makeMonth({
        days: [{ date: '2026-08-01', priceMinor: 17500, transfers: 0, observedAt: 1, cellState: 'OBSERVED' }],
      }),
    ];
    expect(heatmapVisibleStats(months)).toEqual({
      minMinor: 17500,
      medianMinor: 17500,
      maxMinor: 17500,
      observedCount: 1,
    });
  });
});
