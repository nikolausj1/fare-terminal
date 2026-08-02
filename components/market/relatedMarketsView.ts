// Pure view-transform for components/market/RelatedMarkets.tsx (WP-F4 §3,
// PRD §14.9). Kept dependency-free (no DOM) so the capping/href logic is
// unit testable without rendering — see
// tests/unit/relatedMarketsView.test.ts.

import { buildMarketUrl } from '@/lib/url-state';
import type { RelatedMarketVM } from '@/lib/markets/related';

export interface RelatedMarketRow {
  destination: string;
  cityLabel: string;
  priceMinor: number;
  observedAt: number;
  /** Market page URL when this destination happens to already be a tracked
   * route; null for explore-only destinations, which render as a
   * non-link, "not tracked"-tinted card instead. */
  href: string | null;
}

const DEFAULT_LIMIT = 6;

/** getRelatedMarkets() already returns cheapest-first; this just caps the
 * count and resolves each row's link (or lack of one). `origin` is the
 * market page's own origin code — reused verbatim for buildMarketUrl since
 * every related market shares the same origin by construction
 * (lib/markets/related.ts#getRelatedMarkets is queried by origin). */
export function toRelatedMarketRows(
  markets: RelatedMarketVM[],
  origin: string,
  limit: number = DEFAULT_LIMIT
): RelatedMarketRow[] {
  return markets.slice(0, limit).map((m) => ({
    destination: m.destination,
    cityLabel: m.cityName ?? m.destination,
    priceMinor: m.priceMinor,
    observedAt: m.observedAt,
    href: m.trackedRouteSlug ? buildMarketUrl(origin, m.destination, { mode: 'flexible' }) : null,
  }));
}
