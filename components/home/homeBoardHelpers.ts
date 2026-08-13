// Pure formatting/decision helpers for components/home/HomeBoard.tsx
// (WP-P2: "From Seattle" home board). Kept separate from the component file
// so the logic is unit-testable without a DOM/jsdom environment — see
// tests/unit/home-board-helpers.test.ts.

/** Below this many cached observations, a destination's trend/percentile
 * are young enough to be more about the roster still filling in than a
 * meaningful signal — flagged as "building history" rather than presented
 * as a mature reading (mirrors the same idea as IndexHero's
 * MIN_DAYS_FOR_STABLE calibrating badge, at the per-destination level). */
export const MIN_OBSERVATIONS_FOR_HISTORY = 5;

/** A sparkline drawn from 1-2 points reads as noise, not a trend — omit it
 * entirely below this length rather than rendering a near-flat line. */
export const MIN_SPARKLINE_POINTS = 3;

export function shouldShowBuildingHistory(observationCount: number): boolean {
  return observationCount < MIN_OBSERVATIONS_FOR_HISTORY;
}

export function shouldShowSparkline(sparkline: number[]): boolean {
  return sparkline.length >= MIN_SPARKLINE_POINTS;
}

/** Percentile micro-copy for a board card. Distinct wording from
 * MarketCard's "Cheaper than X% of observed history" ("of what we've seen")
 * per the WP-P2 brief's example copy, and the same two boundary-tier
 * callouts MarketCard uses for extreme percentiles. `pct` is expected in
 * [0, 100]; callers should skip rendering entirely when percentile is null. */
export function percentileLabel(pct: number): string {
  if (pct >= 99.5) return 'Cheapest we’ve seen';
  if (pct < 1) return 'Priciest we’ve seen';
  return `Cheaper than ${pct.toFixed(0)}% of what we’ve seen`;
}
