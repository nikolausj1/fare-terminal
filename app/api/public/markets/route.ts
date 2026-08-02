// GET /api/public/markets — read-only, unauthenticated: every tracked
// market's current benchmark/delta/percentile/freshness, for external
// citation/embedding (docs/API.md). Distinct from the internal
// /api/markets/** routes (WP-C/WP4), which return the full MarketSummaryVM
// including recommendation/analyst-note/fair-value detail not meant for the
// public feed — see lib/markets/share.ts#toPublicMarketCard for the exact
// trimmed shape.

import { getMarketSummary, listTrackedMarkets, getDatasetAnchor } from '@/lib/markets/queries';
import { ok } from '@/lib/markets/http';
import { resolveSiteUrl, toPublicMarketCard } from '@/lib/markets/share';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const siteUrl = resolveSiteUrl();
  // High limit: this endpoint is meant to enumerate the FULL tracked
  // roster, unlike listTrackedMarkets' own default (12) which is sized for
  // the not-found page's "try one of these" suggestion list.
  const tracked = listTrackedMarkets(500);

  const markets = tracked
    .map((t) => getMarketSummary(t.origin, t.destination))
    .filter((s) => s !== null)
    .map((s) => toPublicMarketCard(s, siteUrl));

  return ok(
    {
      markets,
      count: markets.length,
      generatedAt: Date.now(),
      datasetAnchorAt: getDatasetAnchor(),
    },
    'public, s-maxage=1800, stale-while-revalidate=3600'
  );
}
