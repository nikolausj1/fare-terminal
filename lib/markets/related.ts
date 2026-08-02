// Read layer for the "Related Markets" / destinations-explorer feature (PRD
// §14.9), built on top of related_fares (populated by jobs/related.ts from
// /v1/city-directions — see that job's and db/schema.ts's doc comments).
//
// NEW FILE per WP-F2 scope — additions only, no changes to
// lib/markets/queries.ts or view-models.ts (a different WP is concurrently
// fixing bugs there). This is the Wave-2 UI contract for related markets.
// Imports resolveDefinition (read-only usage) from queries.ts to reuse the
// exact same "is this pair a tracked route" lookup the rest of the app
// uses, rather than re-deriving it here.

import { asc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { airports, relatedFares } from '@/db/schema';

import { resolveDefinition } from './queries';

export interface RelatedMarketVM {
  destination: string;
  /** Looked up from the airports table by exact IATA-code match; null when
   * `destination` isn't a code this app has an airport row for (city
   * directions can return either airport- or city-level codes — see
   * extras.ts's mapCityDirections doc comment). */
  cityName: string | null;
  priceMinor: number;
  observedAt: number;
  /** The tracked search_definitions slug for (origin, destination), when
   * this pair happens to already be a full tracked route (bootstrap-real's
   * REAL_MARKETS roster) — lets the UI link straight to that market's page
   * instead of just showing a bare price. Null when it's an
   * explore-only destination. */
  trackedRouteSlug: string | null;
}

/**
 * Returns every related_fares row for `origin`, sorted cheapest-first,
 * excluding `excludeDestination` (typically the destination of the market
 * page the caller is already viewing — showing it again as a "related"
 * market would be redundant).
 */
export function getRelatedMarkets(origin: string, excludeDestination?: string): RelatedMarketVM[] {
  const originCode = origin.toUpperCase();
  const excludeCode = excludeDestination?.toUpperCase();

  const rows = excludeCode
    ? db
        .select()
        .from(relatedFares)
        .where(eq(relatedFares.origin, originCode))
        .orderBy(asc(relatedFares.priceMinor))
        .all()
        .filter((row) => row.destination !== excludeCode)
    : db
        .select()
        .from(relatedFares)
        .where(eq(relatedFares.origin, originCode))
        .orderBy(asc(relatedFares.priceMinor))
        .all();

  return rows.map((row) => {
    const airport = db.select().from(airports).where(eq(airports.iataCode, row.destination)).get();
    const definition = resolveDefinition(originCode, row.destination);

    return {
      destination: row.destination,
      cityName: airport?.cityName ?? null,
      priceMinor: row.priceMinor,
      observedAt: row.observedAt,
      trackedRouteSlug: definition?.slug ?? null,
    };
  });
}
