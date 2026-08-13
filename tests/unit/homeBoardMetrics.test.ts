// WP-P1: pure, fixture-driven coverage for the home board's
// percentile/sparkline/changePct7d math — no DB involved. See
// lib/markets/home-board.ts for the DB-backed wrapper this feeds.

import { describe, expect, it } from 'vitest';

import {
  computeDestinationMetrics,
  downsample,
  nearestObservation,
  type Observation,
} from '@/lib/markets/homeBoardMetrics';
import { config } from '@/domain/config';

const DAY_MS = 86_400_000;
const NOW = Date.parse('2026-08-13T12:00:00.000Z');

/** `count` daily observations ending at `now` (most recent last), with
 * price(i) = startPrice + i * stepMinor for i = 0..count-1 (i=0 oldest). */
function dailySeries(count: number, startPrice: number, stepMinor: number, now: number = NOW): Observation[] {
  return Array.from({ length: count }, (_, i) => ({
    priceMinor: startPrice + i * stepMinor,
    observedAt: now - (count - 1 - i) * DAY_MS,
  }));
}

describe('downsample', () => {
  it('is a no-op when points are already within the cap', () => {
    const points: Observation[] = [
      { priceMinor: 100, observedAt: 1 },
      { priceMinor: 200, observedAt: 2 },
    ];
    expect(downsample(points, 20)).toEqual([100, 200]);
  });

  it('downsamples to exactly maxPoints, preserving chronological order', () => {
    const points = dailySeries(25, 10000, 100); // ascending prices, oldest first
    const result = downsample(points, 20);
    expect(result).toHaveLength(20);
    // Evenly-spaced selection: index i picks floor(i * 25/20) = floor(i * 1.25).
    const expectedIndices = Array.from({ length: 20 }, (_, i) => Math.floor(i * 1.25));
    expect(result).toEqual(expectedIndices.map((idx) => points[idx].priceMinor));
    // Strictly increasing since the source series is monotonic and order is preserved.
    for (let i = 1; i < result.length; i++) {
      expect(result[i]).toBeGreaterThan(result[i - 1]);
    }
  });

  it('returns an empty array for empty input', () => {
    expect(downsample([], 20)).toEqual([]);
  });
});

describe('nearestObservation', () => {
  const rows: Observation[] = [
    { priceMinor: 100, observedAt: NOW - 10 * DAY_MS },
    { priceMinor: 200, observedAt: NOW - 7 * DAY_MS },
    { priceMinor: 300, observedAt: NOW - 1 * DAY_MS },
  ];

  it('finds the closest row within tolerance', () => {
    const result = nearestObservation(rows, NOW - 7 * DAY_MS, 2 * DAY_MS);
    expect(result?.priceMinor).toBe(200);
  });

  it('returns null when the closest row is outside tolerance', () => {
    const result = nearestObservation(rows, NOW - 20 * DAY_MS, 2 * DAY_MS);
    expect(result).toBeNull();
  });

  it('returns null for an empty row set', () => {
    expect(nearestObservation([], NOW, 2 * DAY_MS)).toBeNull();
  });
});

describe('computeDestinationMetrics', () => {
  it('returns all-null/empty metrics for a destination with no observations', () => {
    const result = computeDestinationMetrics([], NOW);
    expect(result).toEqual({
      currentPriceMinor: null,
      observedAt: null,
      sparkline: [],
      changePct7d: null,
      percentile: null,
      observationCount: 0,
    });
  });

  it('percentile is null below minObservationsForPercentile even with real history', () => {
    // 5 observations, well under the configured minimum (10).
    const observations = dailySeries(5, 30000, -500); // decreasing prices, cheapest most recent
    const result = computeDestinationMetrics(observations, NOW);
    expect(result.observationCount).toBe(5);
    expect(result.percentile).toBeNull();
  });

  it('percentile is 100 when the current price is cheaper than all of history, once the threshold is met', () => {
    // 12 daily observations, strictly decreasing -> current (most recent) is the cheapest ever.
    const observations = dailySeries(12, 30000, -500);
    expect(observations.length).toBeGreaterThanOrEqual(config.homeBoard.minObservationsForPercentile);
    const result = computeDestinationMetrics(observations, NOW);
    expect(result.observationCount).toBe(12);
    expect(result.currentPriceMinor).toBe(observations[observations.length - 1].priceMinor);
    expect(result.percentile).toBe(100); // every one of the 11 prior observations was higher
  });

  it('percentile is 0 when the current price is the most expensive ever observed', () => {
    // 12 daily observations, strictly increasing -> current is the priciest ever.
    const observations = dailySeries(12, 20000, 100);
    const result = computeDestinationMetrics(observations, NOW);
    expect(result.percentile).toBe(0);
  });

  it('changePct7d compares against the observation nearest 7 days ago', () => {
    const observations = dailySeries(12, 30000, -500); // i=0..11, price(i) = 30000 - 500*i
    // i=11 is "now" (current, price 24500); i=4 is 7 days before now (price 28000).
    const result = computeDestinationMetrics(observations, NOW);
    const expectedPct = ((24500 - 28000) / 28000) * 100;
    expect(result.changePct7d).toBeCloseTo(expectedPct, 6);
  });

  it('changePct7d is null when no observation falls near 7 days ago', () => {
    // Only two observations: "now" and one far in the past (60 days) -- outside the 2-day tolerance window around -7d.
    const observations: Observation[] = [
      { priceMinor: 50000, observedAt: NOW - 60 * DAY_MS },
      { priceMinor: 20000, observedAt: NOW },
    ];
    const result = computeDestinationMetrics(observations, NOW);
    expect(result.changePct7d).toBeNull();
  });

  it('sparkline only includes observations within sparklineDays and downsamples to <=20 points', () => {
    // 40 daily observations spanning 40 days; only those within the
    // trailing sparklineDays window should be eligible.
    const observations = dailySeries(40, 10000, 50);
    const cutoff = NOW - config.homeBoard.sparklineDays * DAY_MS;
    const eligible = observations.filter((o) => o.observedAt >= cutoff);
    expect(eligible.length).toBeGreaterThan(20); // sanity check the fixture actually exercises downsampling

    const result = computeDestinationMetrics(observations, NOW);
    expect(result.sparkline).toHaveLength(20);
    // The sparkline should never include a point older than sparklineDays.
    const oldestEligiblePrice = eligible[0].priceMinor;
    expect(Math.min(...result.sparkline)).toBeGreaterThanOrEqual(oldestEligiblePrice);
  });

  it('sparkline is unpadded (shorter than 20) when fewer eligible observations exist', () => {
    const observations = dailySeries(5, 10000, 50);
    const result = computeDestinationMetrics(observations, NOW);
    expect(result.sparkline).toHaveLength(5);
  });

  it('sorts out-of-order input by observedAt before computing "current"', () => {
    const observations: Observation[] = [
      { priceMinor: 999, observedAt: NOW }, // current, but listed first
      { priceMinor: 111, observedAt: NOW - 5 * DAY_MS },
    ];
    const result = computeDestinationMetrics(observations, NOW);
    expect(result.currentPriceMinor).toBe(999);
    expect(result.observedAt).toBe(NOW);
  });
});
