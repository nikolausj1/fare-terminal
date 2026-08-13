// Pure, fixture-driven coverage for the pinned-routes price-source
// precedence (lib/markets/pinned.ts#resolvePinnedRoutePrice) — no DB
// involved, same split as tests/unit/homeBoardMetrics.test.ts for the
// sibling home-board math. See lib/markets/pinned.ts for the DB-backed
// wrapper (getPinnedRoutes) this feeds.

import { describe, expect, it } from 'vitest';

import { config } from '@/domain/config';
import {
  isPinnedSnapshotReliable,
  resolvePinnedRoutePrice,
  type PinnedGoogleHistoryPoint,
  type PinnedSnapshotLike,
  type PinnedWatchObservation,
} from '@/lib/markets/pinned';

const DAY_MS = 86_400_000;
const NOW = Date.parse('2026-08-13T12:00:00.000Z');

function snapshot(overrides: Partial<PinnedSnapshotLike> = {}): PinnedSnapshotLike {
  return {
    benchmarkPriceMinor: 20000,
    dataQualityScore: 0.95,
    validOfferCount: 10,
    snapshotAt: NOW,
    ...overrides,
  };
}

function watchObs(priceMinor: number, observedAt: number): PinnedWatchObservation {
  return { priceMinor, observedAt };
}

/** Builds an ascending, one-point-per-day Google price_history fixture
 * starting `count` days before NOW, ending at NOW — mirrors the shape
 * scripts/backfill-price-insights.ts / jobs/ingest.ts#persistPriceInsights
 * actually store. */
function googleHistory(prices: number[]): PinnedGoogleHistoryPoint[] {
  return prices.map((priceMinor, i) => {
    const observedAt = NOW - (prices.length - 1 - i) * DAY_MS;
    return { date: new Date(observedAt).toISOString().slice(0, 10), priceMinor, observedAt };
  });
}

describe('isPinnedSnapshotReliable', () => {
  it('is reliable when price is positive and quality clears the configured floor', () => {
    expect(isPinnedSnapshotReliable({ benchmarkPriceMinor: 20000, dataQualityScore: 0.9 })).toBe(true);
  });

  it('is unreliable when benchmarkPriceMinor is zero (zero-valid-offer snapshot)', () => {
    expect(isPinnedSnapshotReliable({ benchmarkPriceMinor: 0, dataQualityScore: 0.9 })).toBe(false);
  });

  it('is unreliable when dataQualityScore is below config.display.minQualityForPrice', () => {
    expect(
      isPinnedSnapshotReliable({
        benchmarkPriceMinor: 20000,
        dataQualityScore: config.display.minQualityForPrice - 0.01,
      })
    ).toBe(false);
  });
});

describe('resolvePinnedRoutePrice', () => {
  it('NONE: no snapshots and no watch history', () => {
    const result = resolvePinnedRoutePrice([], []);
    expect(result).toEqual({
      priceMinor: null,
      priceSource: 'NONE',
      changePct24h: null,
      sparkline: [],
      sparklineSource: null,
      percentile: null,
      googlePercentile: null,
      typicalRange: null,
      offerCount: null,
      observedAt: null,
    });
  });

  it('NONE: still passes through a supplied typicalRange even with no price data', () => {
    const result = resolvePinnedRoutePrice([], [], [], { lowMinor: 57000, highMinor: 81000 });
    expect(result.priceSource).toBe('NONE');
    expect(result.priceMinor).toBeNull();
    expect(result.typicalRange).toEqual({ lowMinor: 57000, highMinor: 81000 });
  });

  it('WATCH_FEED: used when there are no FULL_TRACKING snapshots at all', () => {
    const history = [watchObs(28400, NOW - 3 * DAY_MS), watchObs(29000, NOW - 1 * DAY_MS)];
    const result = resolvePinnedRoutePrice([], history);
    expect(result.priceSource).toBe('WATCH_FEED');
    expect(result.priceMinor).toBe(29000);
    expect(result.observedAt).toBe(NOW - 1 * DAY_MS);
    // No recommendation engine at watch-level depth.
    expect(result.percentile).toBeNull();
    expect(result.offerCount).toBeNull();
    expect(result.changePct24h).toBeNull();
    expect(result.sparkline).toEqual([28400, 29000]);
    // Watch-level sparkline is always its own observations, never a Google
    // fallback.
    expect(result.sparklineSource).toBe('OBSERVATIONS');
    expect(result.googlePercentile).toBeNull();
  });

  it('WATCH_FEED: googlePercentile computed against Google history even without any FULL_TRACKING snapshot', () => {
    const history = [watchObs(29000, NOW - 1 * DAY_MS)];
    const google = googleHistory([60000, 65000, 70000, 25000]); // 60k/65k/70k are higher than 29000; 25000 is not
    const result = resolvePinnedRoutePrice([], history, google);
    expect(result.priceSource).toBe('WATCH_FEED');
    // 3 of the 4 google points (60000, 65000, 70000) are higher than 29000.
    expect(result.googlePercentile).toBeCloseTo((3 / 4) * 100, 6);
  });

  it('WATCH_FEED: falls back here when every FULL_TRACKING snapshot is unreliable', () => {
    const badSnapshots = [
      snapshot({ benchmarkPriceMinor: 0, dataQualityScore: 0.99, snapshotAt: NOW - DAY_MS }), // zero-valid-offer
      snapshot({ benchmarkPriceMinor: 15000, dataQualityScore: 0.1, snapshotAt: NOW }), // below quality floor
    ];
    const history = [watchObs(29000, NOW - 1 * DAY_MS)];
    const result = resolvePinnedRoutePrice(badSnapshots, history);
    expect(result.priceSource).toBe('WATCH_FEED');
    expect(result.priceMinor).toBe(29000);
  });

  it('NONE beats an empty watch history even when FULL_TRACKING snapshots exist but are all unreliable', () => {
    const badSnapshots = [snapshot({ benchmarkPriceMinor: 0, dataQualityScore: 0.99 })];
    const result = resolvePinnedRoutePrice(badSnapshots, []);
    expect(result.priceSource).toBe('NONE');
    expect(result.priceMinor).toBeNull();
  });

  it('FULL_TRACKING: single reliable snapshot has a price but no change/percentile (no prior history)', () => {
    const result = resolvePinnedRoutePrice([snapshot({ benchmarkPriceMinor: 20300, snapshotAt: NOW })], []);
    expect(result.priceSource).toBe('FULL_TRACKING');
    expect(result.priceMinor).toBe(20300);
    expect(result.observedAt).toBe(NOW);
    expect(result.changePct24h).toBeNull();
    expect(result.percentile).toBeNull();
    expect(result.offerCount).toBe(10);
    // Sparkline component itself skips rendering <2 points, but the raw
    // series is still exactly the one reliable observation.
    expect(result.sparkline).toEqual([20300]);
  });

  it('FULL_TRACKING: computes 24h change against the nearest reliable snapshot ~24h earlier', () => {
    const snapshots = [
      snapshot({ benchmarkPriceMinor: 22000, snapshotAt: NOW - DAY_MS }),
      snapshot({ benchmarkPriceMinor: 19500, snapshotAt: NOW }),
    ];
    const result = resolvePinnedRoutePrice(snapshots, []);
    expect(result.priceSource).toBe('FULL_TRACKING');
    expect(result.priceMinor).toBe(19500);
    expect(result.changePct24h).toBeCloseTo(((19500 - 22000) / 22000) * 100, 6);
  });

  it('FULL_TRACKING: changePct24h is null when no prior snapshot falls within the 6h tolerance of -24h', () => {
    const snapshots = [
      snapshot({ benchmarkPriceMinor: 22000, snapshotAt: NOW - 10 * DAY_MS }),
      snapshot({ benchmarkPriceMinor: 19500, snapshotAt: NOW }),
    ];
    const result = resolvePinnedRoutePrice(snapshots, []);
    expect(result.changePct24h).toBeNull();
  });

  it('FULL_TRACKING: percentile reflects the share of prior reliable history priced higher than current', () => {
    const snapshots = [
      snapshot({ benchmarkPriceMinor: 30000, snapshotAt: NOW - 3 * DAY_MS }),
      snapshot({ benchmarkPriceMinor: 28000, snapshotAt: NOW - 2 * DAY_MS }),
      snapshot({ benchmarkPriceMinor: 19500, snapshotAt: NOW }), // cheapest of the three
    ];
    const result = resolvePinnedRoutePrice(snapshots, []);
    expect(result.percentile).toBe(100); // both prior points were higher
  });

  it('FULL_TRACKING: an unreliable snapshot is excluded from history/percentile/sparkline, not just skipped as "current"', () => {
    const snapshots = [
      snapshot({ benchmarkPriceMinor: 30000, dataQualityScore: 0.95, snapshotAt: NOW - 3 * DAY_MS }),
      snapshot({ benchmarkPriceMinor: 0, dataQualityScore: 0.99, snapshotAt: NOW - 2 * DAY_MS }), // unreliable: zero price
      snapshot({ benchmarkPriceMinor: 19500, dataQualityScore: 0.95, snapshotAt: NOW }),
    ];
    const result = resolvePinnedRoutePrice(snapshots, []);
    expect(result.priceSource).toBe('FULL_TRACKING');
    expect(result.priceMinor).toBe(19500);
    // Sparkline should have exactly the 2 reliable points, never the 0.
    expect(result.sparkline).toEqual([30000, 19500]);
    expect(result.sparkline).not.toContain(0);
    expect(result.percentile).toBe(100);
  });

  it('FULL_TRACKING: an unreliable LATEST snapshot is skipped in favor of an older reliable one as "current"', () => {
    const snapshots = [
      snapshot({ benchmarkPriceMinor: 21000, dataQualityScore: 0.95, snapshotAt: NOW - DAY_MS }),
      snapshot({ benchmarkPriceMinor: 0, dataQualityScore: 0.99, snapshotAt: NOW }), // latest, but unreliable
    ];
    const result = resolvePinnedRoutePrice(snapshots, []);
    expect(result.priceSource).toBe('FULL_TRACKING');
    expect(result.priceMinor).toBe(21000);
    expect(result.observedAt).toBe(NOW - DAY_MS);
  });

  it('FULL_TRACKING: sparkline downsamples to at most 20 points', () => {
    const snapshots = Array.from({ length: 30 }, (_, i) =>
      snapshot({ benchmarkPriceMinor: 20000 + i * 10, snapshotAt: NOW - (29 - i) * DAY_MS })
    );
    const result = resolvePinnedRoutePrice(snapshots, []);
    expect(result.sparkline.length).toBeLessThanOrEqual(20);
  });

  it('FULL_TRACKING takes precedence over WATCH_FEED even when a watch observation is more recent', () => {
    const snapshots = [snapshot({ benchmarkPriceMinor: 20300, snapshotAt: NOW - 5 * DAY_MS })];
    const history = [watchObs(28400, NOW)]; // more recent than the snapshot, but lower tracking depth
    const result = resolvePinnedRoutePrice(snapshots, history);
    expect(result.priceSource).toBe('FULL_TRACKING');
    expect(result.priceMinor).toBe(20300);
  });

  // ---------------------------------------------------------------------
  // WP-P5: Google price_insights fallback sparkline + googlePercentile +
  // typicalRange
  // ---------------------------------------------------------------------

  it('GOOGLE_HISTORY sparkline fallback: used when our own reliable history has fewer than 3 points', () => {
    const snapshots = [snapshot({ benchmarkPriceMinor: 69000, snapshotAt: NOW })]; // just 1 point of our own
    const google = googleHistory([64000, 60000, 60000, 67000, 69000]);
    const result = resolvePinnedRoutePrice(snapshots, [], google);
    expect(result.priceSource).toBe('FULL_TRACKING');
    expect(result.priceMinor).toBe(69000); // our own price is still authoritative
    expect(result.sparklineSource).toBe('GOOGLE_HISTORY');
    expect(result.sparkline).toEqual([64000, 60000, 60000, 67000, 69000]);
  });

  it('GOOGLE_HISTORY sparkline fallback: also used with exactly 2 of our own reliable points', () => {
    const snapshots = [
      snapshot({ benchmarkPriceMinor: 70000, snapshotAt: NOW - DAY_MS }),
      snapshot({ benchmarkPriceMinor: 69000, snapshotAt: NOW }),
    ];
    const google = googleHistory([64000, 60000, 67000]);
    const result = resolvePinnedRoutePrice(snapshots, [], google);
    expect(result.sparklineSource).toBe('GOOGLE_HISTORY');
    expect(result.sparkline).toEqual([64000, 60000, 67000]);
  });

  it('OBSERVATIONS sparkline: used once our own reliable history reaches 3 points, even with Google history available', () => {
    const snapshots = [
      snapshot({ benchmarkPriceMinor: 71000, snapshotAt: NOW - 2 * DAY_MS }),
      snapshot({ benchmarkPriceMinor: 70000, snapshotAt: NOW - DAY_MS }),
      snapshot({ benchmarkPriceMinor: 69000, snapshotAt: NOW }),
    ];
    const google = googleHistory([64000, 60000, 67000]);
    const result = resolvePinnedRoutePrice(snapshots, [], google);
    expect(result.sparklineSource).toBe('OBSERVATIONS');
    expect(result.sparkline).toEqual([71000, 70000, 69000]);
  });

  it('GOOGLE_HISTORY fallback: falls back to our own (thin) sparkline when no Google history is supplied', () => {
    const snapshots = [snapshot({ benchmarkPriceMinor: 69000, snapshotAt: NOW })];
    const result = resolvePinnedRoutePrice(snapshots, [], []);
    expect(result.sparklineSource).toBe('OBSERVATIONS');
    expect(result.sparkline).toEqual([69000]);
  });

  it('GOOGLE_HISTORY fallback: downsamples to at most 20 points and uses only the newest 30 of a longer series', () => {
    const snapshots = [snapshot({ benchmarkPriceMinor: 69000, snapshotAt: NOW })];
    const google = googleHistory(Array.from({ length: 61 }, (_, i) => 60000 + i * 100)); // 61-day series
    const result = resolvePinnedRoutePrice(snapshots, [], google);
    expect(result.sparklineSource).toBe('GOOGLE_HISTORY');
    expect(result.sparkline.length).toBeLessThanOrEqual(20);
    // Only the newest 30 of the 61 points (values 60000+3100..60000+6000)
    // should ever feed the sparkline — downsample() doesn't guarantee the
    // exact final point survives its even-spacing pick, so assert the whole
    // sparkline stays within that newest-30 value range rather than
    // asserting the last element exactly.
    const oldestAllowedValue = 60000 + 31 * 100; // value 30 points back from the newest (index 61-30=31)
    expect(result.sparkline.every((v) => v >= oldestAllowedValue)).toBe(true);
  });

  it('googlePercentile: share of Google history points priced higher than the current benchmark', () => {
    const snapshots = [
      snapshot({ benchmarkPriceMinor: 71000, snapshotAt: NOW - 2 * DAY_MS }),
      snapshot({ benchmarkPriceMinor: 70000, snapshotAt: NOW - DAY_MS }),
      snapshot({ benchmarkPriceMinor: 69000, snapshotAt: NOW }), // 3 own points -> OBSERVATIONS sparkline
    ];
    const google = googleHistory([60000, 70000, 75000, 80000]); // 3 of 4 higher than 69000
    const result = resolvePinnedRoutePrice(snapshots, [], google);
    expect(result.sparklineSource).toBe('OBSERVATIONS'); // fallback threshold not hit
    expect(result.googlePercentile).toBeCloseTo((3 / 4) * 100, 6); // but googlePercentile still computed
  });

  it('googlePercentile is null when no Google history was supplied', () => {
    const snapshots = [snapshot({ benchmarkPriceMinor: 69000, snapshotAt: NOW })];
    const result = resolvePinnedRoutePrice(snapshots, [], []);
    expect(result.googlePercentile).toBeNull();
  });

  it('typicalRange passes through unchanged onto the FULL_TRACKING resolution', () => {
    const snapshots = [snapshot({ benchmarkPriceMinor: 69000, snapshotAt: NOW })];
    const result = resolvePinnedRoutePrice(snapshots, [], [], { lowMinor: 57000, highMinor: 81000 });
    expect(result.typicalRange).toEqual({ lowMinor: 57000, highMinor: 81000 });
  });
});
