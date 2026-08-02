// runRelatedSweep: populates related_fares from /v1/city-directions, one
// request per hub origin, powering the "Related Markets" / destinations-
// explorer feature (PRD §14.9). Staggered like jobs/heatmap.ts — a rotating
// fraction of the roster's distinct origins refresh each sweep, via
// jobs/stagger.ts. Origins don't have a natural DB row id the way routes
// have a search_definitions.id, so hashStringToInt gives each origin a
// stable bucket assignment.
//
// Guard: this module is provider-agnostic and will throw MISSING_TOKEN if
// invoked without TRAVELPAYOUTS_TOKEN set — the DATA_PROVIDER=travelpayouts
// AND-token gate lives in the caller (jobs/pipeline.ts).

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { relatedFares, searchDefinitions } from '@/db/schema';
import { config } from '@/domain/config';
import { travelpayoutsExtras, type TravelpayoutsExtras } from '@/lib/providers/travelpayouts/extras';

import { isMainModule, resolveDefinitionRoute, runCli } from './_shared';
import { hashStringToInt, isInSweepBucket } from './stagger';

export interface RelatedSummary {
  originsInRoster: number;
  originsRefreshedThisSweep: number;
  requestsMade: number;
  faresUpserted: number;
  errors: { origin: string; message: string }[];
}

/** Distinct origin IATA codes across every active search_definitions row —
 * the set of hubs jobs/related.ts surveys via city-directions. */
function distinctActiveOrigins(): string[] {
  const activeDefs = db.select().from(searchDefinitions).where(eq(searchDefinitions.active, true)).all();
  const origins = new Set<string>();
  for (const def of activeDefs) {
    const { origin } = resolveDefinitionRoute(def);
    origins.add(origin);
  }
  // Sorted for a deterministic iteration order (doesn't affect bucket
  // assignment, which is hash-based, but keeps logs/tests reproducible).
  return Array.from(origins).sort();
}

export async function runRelatedSweep(
  now: number = Date.now(),
  extras: TravelpayoutsExtras = travelpayoutsExtras
): Promise<RelatedSummary> {
  const origins = distinctActiveOrigins();
  const bucketCount = config.related.staggerBuckets;
  const originsThisSweep = origins.filter((origin) => isInSweepBucket(hashStringToInt(origin), bucketCount, now));

  const summary: RelatedSummary = {
    originsInRoster: origins.length,
    originsRefreshedThisSweep: originsThisSweep.length,
    requestsMade: 0,
    faresUpserted: 0,
    errors: [],
  };

  for (const origin of originsThisSweep) {
    try {
      const result = await extras.fetchCityDirections(origin);
      summary.requestsMade += 1;

      for (const fare of result.fares) {
        const priceMinor = Math.round(fare.priceMajor * 100);
        db.insert(relatedFares)
          .values({
            origin,
            destination: fare.destination,
            priceMinor,
            observedAt: now,
            source: 'CITY_DIRECTIONS',
          })
          .onConflictDoUpdate({
            // "Replace per pair" — see db/schema.ts's relatedFares doc comment.
            target: [relatedFares.origin, relatedFares.destination],
            set: { priceMinor, observedAt: now, source: 'CITY_DIRECTIONS' },
          })
          .run();
        summary.faresUpserted += 1;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push({ origin, message });
    }
  }

  return summary;
}

if (isMainModule(import.meta.url)) {
  void runCli(() => runRelatedSweep());
}
