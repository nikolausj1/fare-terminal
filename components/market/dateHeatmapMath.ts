// Pure helpers for components/market/DateHeatmap.tsx (WP-F4 §2, PRD §14.8).
// Kept dependency-free (no DOM, no recharts) so the color-scale math and
// visible-range stats can be unit tested directly — see
// tests/unit/dateHeatmapMath.test.ts.

import type { HeatmapMonthVM } from '@/lib/markets/heatmap';

interface RGB {
  r: number;
  g: number;
  b: number;
}

// Matches app/globals.css's --pos / --warn / --neg so the heatmap's
// cheapest -> priciest gradient reads as the same semantic colors used
// everywhere else in the app (DeltaTag, RecommendationBadge, etc.) rather
// than an unrelated palette.
const GREEN: RGB = { r: 34, g: 197, b: 94 }; // --pos
const AMBER: RGB = { r: 245, g: 158, b: 11 }; // --warn
const RED: RGB = { r: 239, g: 68, b: 68 }; // --neg

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return { r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) };
}

function rgbToCss(c: RGB, alpha: number): string {
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${alpha})`;
}

/**
 * Maps a price into a cheapest(green) -> mid(amber) -> priciest(red) CSS
 * color, linearly interpolated within [min, max]. `alpha` controls opacity
 * (cells render translucent so the dark panel background still reads
 * through, matching FairValueBand/the chart's own --accent-bg treatment).
 *
 * Degenerate case (max <= min — every observed cell in range is the same
 * price, including the single-cell case): there's no relative cheap/pricey
 * signal to show, so this returns the neutral midpoint (amber) rather than
 * dividing by zero or guessing a direction.
 */
export function priceToHeatmapColor(price: number, min: number, max: number, alpha = 0.55): string {
  if (!Number.isFinite(price) || !Number.isFinite(min) || !Number.isFinite(max)) {
    return rgbToCss(AMBER, alpha);
  }
  if (max <= min) {
    return rgbToCss(AMBER, alpha);
  }
  const t = Math.min(1, Math.max(0, (price - min) / (max - min)));
  const rgb = t <= 0.5 ? mixRgb(GREEN, AMBER, t / 0.5) : mixRgb(AMBER, RED, (t - 0.5) / 0.5);
  return rgbToCss(rgb, alpha);
}

export interface HeatmapVisibleStats {
  minMinor: number;
  medianMinor: number;
  maxMinor: number;
  observedCount: number;
}

/** min/median/max across every OBSERVED cell in the given months (the
 * "visible range" the legend and color scale both key off). Null when
 * there's not a single observed cell — the caller renders the route-level
 * empty state instead. */
export function heatmapVisibleStats(months: HeatmapMonthVM[]): HeatmapVisibleStats | null {
  const prices = months
    .flatMap((m) => m.days)
    .filter((d) => d.cellState === 'OBSERVED' && d.priceMinor !== null)
    .map((d) => d.priceMinor as number);

  if (prices.length === 0) return null;

  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianMinor = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

  return {
    minMinor: sorted[0],
    medianMinor,
    maxMinor: sorted[sorted.length - 1],
    observedCount: sorted.length,
  };
}

/** True when not one cell across all given months has an observation — the
 * route-level "calendar data is still being collected" empty state. */
export function heatmapHasNoData(months: HeatmapMonthVM[]): boolean {
  return heatmapVisibleStats(months) === null;
}
