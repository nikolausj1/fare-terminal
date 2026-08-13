// WP-P5: pure fixture coverage for lib/markets/googleInsights.ts — the
// typical-range comparison helpers shared by PinnedRoutes.tsx's "below
// typical range" chip and GoogleInsightsLine.tsx's below/within/above
// one-liner. No DB, no component rendering.

import { describe, expect, it } from 'vitest';

import { isBelowTypicalRange, typicalRangeComparison } from '@/lib/markets/googleInsights';

const RANGE = { lowMinor: 57000, highMinor: 81000 };

describe('isBelowTypicalRange', () => {
  it('is true when price is strictly below the typical range floor', () => {
    expect(isBelowTypicalRange(50000, RANGE)).toBe(true);
  });

  it('is false when price is within the typical range (inclusive of the floor)', () => {
    expect(isBelowTypicalRange(57000, RANGE)).toBe(false);
    expect(isBelowTypicalRange(69000, RANGE)).toBe(false);
  });

  it('is false when price is above the typical range', () => {
    expect(isBelowTypicalRange(90000, RANGE)).toBe(false);
  });

  it('is false (never throws) when there is no typical range to compare against', () => {
    expect(isBelowTypicalRange(50000, null)).toBe(false);
  });
});

describe('typicalRangeComparison', () => {
  it('returns "below" when price is under the range floor', () => {
    expect(typicalRangeComparison(50000, RANGE)).toBe('below');
  });

  it('returns "within" for a price inside the range, including exactly on either boundary', () => {
    expect(typicalRangeComparison(69000, RANGE)).toBe('within');
    expect(typicalRangeComparison(57000, RANGE)).toBe('within');
    expect(typicalRangeComparison(81000, RANGE)).toBe('within');
  });

  it('returns "above" when price is over the range ceiling', () => {
    expect(typicalRangeComparison(90000, RANGE)).toBe('above');
  });
});
