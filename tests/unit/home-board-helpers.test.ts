// Pure-function coverage for components/home/homeBoardHelpers.ts (WP-P2:
// "From Seattle" home board honesty-state / copy helpers).

import { describe, expect, it } from 'vitest';

import {
  MIN_OBSERVATIONS_FOR_HISTORY,
  MIN_SPARKLINE_POINTS,
  percentileLabel,
  shouldShowBuildingHistory,
  shouldShowSparkline,
} from '@/components/home/homeBoardHelpers';

describe('shouldShowBuildingHistory', () => {
  it('is true below the observation threshold', () => {
    expect(shouldShowBuildingHistory(0)).toBe(true);
    expect(shouldShowBuildingHistory(MIN_OBSERVATIONS_FOR_HISTORY - 1)).toBe(true);
  });

  it('is false at and above the threshold', () => {
    expect(shouldShowBuildingHistory(MIN_OBSERVATIONS_FOR_HISTORY)).toBe(false);
    expect(shouldShowBuildingHistory(MIN_OBSERVATIONS_FOR_HISTORY + 10)).toBe(false);
  });
});

describe('shouldShowSparkline', () => {
  it('is false below the minimum point count', () => {
    expect(shouldShowSparkline([])).toBe(false);
    expect(shouldShowSparkline(Array(MIN_SPARKLINE_POINTS - 1).fill(100))).toBe(false);
  });

  it('is true at and above the minimum point count', () => {
    expect(shouldShowSparkline(Array(MIN_SPARKLINE_POINTS).fill(100))).toBe(true);
    expect(shouldShowSparkline(Array(MIN_SPARKLINE_POINTS + 5).fill(100))).toBe(true);
  });
});

describe('percentileLabel', () => {
  it('calls out the extreme-cheap tier', () => {
    expect(percentileLabel(99.5)).toBe('Cheapest we’ve seen');
    expect(percentileLabel(100)).toBe('Cheapest we’ve seen');
  });

  it('calls out the extreme-expensive tier', () => {
    expect(percentileLabel(0)).toBe('Priciest we’ve seen');
    expect(percentileLabel(0.9)).toBe('Priciest we’ve seen');
  });

  it('renders the standard "cheaper than X%" sentence in between', () => {
    expect(percentileLabel(72)).toBe('Cheaper than 72% of what we’ve seen');
    expect(percentileLabel(1)).toBe('Cheaper than 1% of what we’ve seen');
    expect(percentileLabel(99.4)).toBe('Cheaper than 99% of what we’ve seen');
  });
});
