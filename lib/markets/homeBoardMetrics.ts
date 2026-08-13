// Pure, DB-free metrics computation for the "From Seattle" home board
// (WP-P1) — split out of lib/markets/home-board.ts so the percentile/
// sparkline/changePct7d math is unit-testable with plain fixtures, the same
// separation lib/markets/snapshotUtils.ts draws for the analogous
// market_snapshots-based calculations. lib/markets/home-board.ts wraps
// computeDestinationMetrics with the DB-backed lookups (cityName,
// trackedRouteSlug) that don't belong in a pure module.

import { config } from '@/domain/config';
import { historicalPercentile } from '@/domain/history';

import { pctChange } from './snapshotUtils';

const DAY_MS = 86_400_000;
/** downsample() caps a sparkline at this many points — see the WP-P1
 * brief's "sparkline = last sparklineDays of history downsampled ≤20 pts". */
export const SPARKLINE_MAX_POINTS = 20;
/** How far a history observation may sit from "exactly 7 days ago" and
 * still count as the changePct7d comparison point — matches
 * lib/markets/queries.ts's prev7d tolerance (2 * DAY_MS) for the analogous
 * market_snapshots-based 7d change, so both features apply the same
 * "roughly weekly sweep cadence" leniency. */
export const CHANGE_7D_TOLERANCE_MS = 2 * DAY_MS;

export interface Observation {
  priceMinor: number;
  observedAt: number;
}

export interface DestinationMetrics {
  currentPriceMinor: number | null;
  observedAt: number | null;
  sparkline: number[];
  changePct7d: number | null;
  percentile: number | null;
  observationCount: number;
}

const EMPTY_METRICS: DestinationMetrics = {
  currentPriceMinor: null,
  observedAt: null,
  sparkline: [],
  changePct7d: null,
  percentile: null,
  observationCount: 0,
};

/** Evenly-spaced downsample to at most `maxPoints` values, preserving
 * chronological order. A no-op when `points` is already short enough. */
export function downsample(points: readonly Observation[], maxPoints: number): number[] {
  if (points.length <= maxPoints) return points.map((p) => p.priceMinor);
  const step = points.length / maxPoints;
  const out: number[] = [];
  for (let i = 0; i < maxPoints; i++) {
    out.push(points[Math.floor(i * step)].priceMinor);
  }
  return out;
}

/** The observation nearest `targetAt`, or null if none falls within
 * `toleranceMs`. Mirrors lib/markets/snapshotUtils.ts#nearestByTime's
 * algorithm, reimplemented on `observedAt` instead of `snapshotAt` since
 * this module's rows aren't market_snapshots. */
export function nearestObservation(
  rows: readonly Observation[],
  targetAt: number,
  toleranceMs: number
): Observation | null {
  if (rows.length === 0) return null;
  let closest = rows[0];
  let closestDiff = Math.abs(closest.observedAt - targetAt);
  for (const row of rows) {
    const diff = Math.abs(row.observedAt - targetAt);
    if (diff < closestDiff) {
      closest = row;
      closestDiff = diff;
    }
  }
  return closestDiff <= toleranceMs ? closest : null;
}

/**
 * Computes a single destination's price metrics from its full (unsorted-ok)
 * observation history, as of `now`. Pure — no DB access, no config other
 * than domain/config.ts#homeBoard's tunables.
 *
 * - percentile: share of history observations HIGHER than the current
 *   (most recent) one — see domain/history/percentile.ts#historicalPercentile.
 *   Null below config.homeBoard.minObservationsForPercentile TOTAL
 *   observations (current + history) — a thin history says nothing
 *   meaningful about "cheap vs. usual".
 * - changePct7d: percent change vs. the history observation nearest 7 days
 *   before `now` (excluding the current observation itself), within
 *   CHANGE_7D_TOLERANCE_MS. Null if none falls in that window.
 * - sparkline: every observation within config.homeBoard.sparklineDays of
 *   `now`, downsampled to at most SPARKLINE_MAX_POINTS.
 */
export function computeDestinationMetrics(
  observations: readonly Observation[],
  now: number
): DestinationMetrics {
  if (observations.length === 0) return EMPTY_METRICS;

  const sorted = [...observations].sort((a, b) => a.observedAt - b.observedAt);
  const current = sorted[sorted.length - 1];
  // Excludes the current (most recent) observation from its own history —
  // same convention as lib/markets/queries.ts's `compatible.slice(0, -1)`.
  const priorHistory = sorted.slice(0, -1);

  const percentile =
    sorted.length >= config.homeBoard.minObservationsForPercentile
      ? historicalPercentile(current.priceMinor, priorHistory.map((r) => r.priceMinor))
      : null;

  const prev7d = nearestObservation(priorHistory, now - 7 * DAY_MS, CHANGE_7D_TOLERANCE_MS);
  const changePct7d = prev7d ? pctChange(prev7d.priceMinor, current.priceMinor) : null;

  const sparklineCutoff = now - config.homeBoard.sparklineDays * DAY_MS;
  const sparklinePoints = sorted.filter((r) => r.observedAt >= sparklineCutoff);

  return {
    currentPriceMinor: current.priceMinor,
    observedAt: current.observedAt,
    sparkline: downsample(sparklinePoints, SPARKLINE_MAX_POINTS),
    changePct7d,
    percentile,
    observationCount: sorted.length,
  };
}
