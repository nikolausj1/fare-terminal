// Read layer for the "recently spotted deals" / movers ticker, built on top
// of latest_deals (populated by jobs/deals.ts from /v2/prices/latest,
// unfiltered — see that job's and db/schema.ts's doc comments for why this
// is a network-wide feed, not scoped to the tracked roster).
//
// NEW FILE per WP-F2 scope — additions only, no changes to
// lib/markets/queries.ts or view-models.ts (a different WP is concurrently
// fixing bugs there). This is the Wave-2 UI contract for the deals feed.

import { desc } from 'drizzle-orm';

import { db } from '@/db';
import { latestDeals } from '@/db/schema';

export interface DealVM {
  origin: string;
  destination: string;
  priceMinor: number;
  departDate: string | null;
  returnDate: string | null;
  /** When Travelpayouts' own cache observed this price (not when this
   * adapter retrieved it) — see db/schema.ts's latestDeals doc comment. */
  foundAt: number;
  distanceKm: number | null;
}

/**
 * Returns up to `limit` of the most recently found deals, newest first.
 * This feed is network-wide (not limited to the tracked roster — see the
 * audit's finding that /v2/prices/latest is empty when filtered to a
 * specific route), so results can include routes with no
 * search_definitions row at all; the UI should treat this as a discovery
 * feed, not a per-market widget.
 */
export function getLatestDeals(limit = 12): DealVM[] {
  const rows = db.select().from(latestDeals).orderBy(desc(latestDeals.foundAt)).limit(limit).all();

  return rows.map((row) => ({
    origin: row.origin,
    destination: row.destination,
    priceMinor: row.priceMinor,
    departDate: row.departDate,
    returnDate: row.returnDate,
    foundAt: row.foundAt,
    distanceKm: row.distanceKm,
  }));
}
