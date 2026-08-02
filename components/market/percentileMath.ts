// Pure helpers for components/market/PercentileStrip.tsx (WP-F4 §4). Kept
// dependency-free so the axis-position/zone math is unit testable without
// rendering — see tests/unit/percentileMath.test.ts.

/** Quartile tick positions on the 0-100 axis. */
export const PERCENTILE_QUARTILE_TICKS = [25, 50, 75] as const;

/** Clamps a percentile (domain/history/percentile.ts#historicalPercentile
 * always returns [0, 100], but this is the UI's own defensive boundary —
 * never trust an upstream invariant silently) into [0, 100], defaulting a
 * non-finite input (NaN/Infinity) to 0 rather than propagating garbage into
 * a CSS `left` percentage. */
export function clampPercentile(percentile: number): number {
  if (!Number.isFinite(percentile)) return 0;
  return Math.min(100, Math.max(0, percentile));
}

export type PercentileZone = 'expensive' | 'mid' | 'cheap';

/** historicalPercentile's convention: HIGHER percentile = cheaper (today
 * is cheaper than more of history). So the "cheap" (favorable) zone sits at
 * the high end of the axis, and "expensive" at the low end — the inverse of
 * how percentile might intuitively map if read as a price percentile
 * rather than a "cheaper-than-X%-of-history" one. Boundaries match the
 * quartile ticks: top quartile = cheap, bottom quartile = expensive,
 * middle half = mid. */
export function percentileZone(percentile: number): PercentileZone {
  const p = clampPercentile(percentile);
  if (p >= 75) return 'cheap';
  if (p <= 25) return 'expensive';
  return 'mid';
}

/** The marker's horizontal position on the strip, as a CSS percentage
 * string ready for a `left` style. */
export function percentileMarkerLeftPct(percentile: number): string {
  return `${clampPercentile(percentile).toFixed(2)}%`;
}
