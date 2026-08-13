// WP-P5: tiny pure helpers shared by the two UI surfaces that compare a
// current price against Google's own "typical price range" for a route
// (price_insights, via SerpApi) — components/home/PinnedRoutes.tsx's "below
// typical range" chip and components/market/GoogleInsightsLine.tsx's
// below/within/above one-liner. Split out so this comparison logic is
// unit-testable with plain fixtures (see tests/unit/googleInsights.test.ts),
// matching the split every other pure UI-decision helper in lib/markets/**
// uses (e.g. components/home/homeBoardHelpers.ts).

export interface TypicalRange {
  lowMinor: number;
  highMinor: number;
}

/** True when `priceMinor` sits strictly below Google's own typical-range
 * floor for this route — the trigger for PinnedRoutes.tsx's "Below typical
 * range" chip. False (never throws) when there's no typical range to
 * compare against. */
export function isBelowTypicalRange(priceMinor: number, typicalRange: TypicalRange | null): boolean {
  if (!typicalRange) return false;
  return priceMinor < typicalRange.lowMinor;
}

/** Where `priceMinor` falls relative to Google's typical range — feeds
 * GoogleInsightsLine.tsx's "today's benchmark is {below/within/above} that
 * range" sentence. A price exactly at either boundary counts as "within"
 * (not below/above). */
export function typicalRangeComparison(priceMinor: number, typicalRange: TypicalRange): 'below' | 'within' | 'above' {
  if (priceMinor < typicalRange.lowMinor) return 'below';
  if (priceMinor > typicalRange.highMinor) return 'above';
  return 'within';
}
