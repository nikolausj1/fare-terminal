// runHeatmapSweep: populates calendar_prices from /v2/prices/month-matrix,
// the real date-price heatmap data source per
// ../_review/revamp-data-audit.md (see lib/providers/travelpayouts/
// extras.ts's module doc comment for why this endpoint, not
// /v1/prices/calendar).
//
// Budget-staggered: refreshing every active route's full months-ahead
// window on every 6h sweep would cost routeCount * config.heatmap.monthsAhead
// requests every single sweep. Instead each sweep only refreshes the routes
// in the CURRENT stagger bucket (jobs/stagger.ts) — with the default 4
// buckets and the existing 6h cron, a given route's heatmap refreshes ~once
// per 24h. See domain/config.ts#heatmap for the tunables and the WP-F2
// final report for the full budget arithmetic.
//
// Guard: this module is provider-agnostic and will throw MISSING_TOKEN if
// invoked without TRAVELPAYOUTS_TOKEN set — the DATA_PROVIDER=travelpayouts
// AND-token gate lives in the caller (jobs/pipeline.ts), matching how
// jobs/deals.ts and jobs/related.ts are gated too.

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { calendarPrices, searchDefinitions } from '@/db/schema';
import { config } from '@/domain/config';
import { travelpayoutsExtras, type TravelpayoutsExtras } from '@/lib/providers/travelpayouts/extras';

import { isMainModule, resolveDefinitionRoute, runCli } from './_shared';
import { isInSweepBucket } from './stagger';

export interface HeatmapSummary {
  routesInRoster: number;
  routesRefreshedThisSweep: number;
  monthsPerRoute: number;
  requestsMade: number;
  daysUpserted: number;
  errors: { origin: string; destination: string; message: string }[];
}

/** The current UTC calendar month plus `count - 1` months ahead, as
 * "YYYY-MM" strings — e.g. monthsAheadFrom(nowInAugust, 3) ->
 * ["2026-08", "2026-09", "2026-10"]. */
function monthsAheadFrom(now: number, count: number): string[] {
  const months: string[] = [];
  const cursor = new Date(now);
  for (let i = 0; i < count; i++) {
    const year = cursor.getUTCFullYear();
    const month = String(cursor.getUTCMonth() + 1).padStart(2, '0');
    months.push(`${year}-${month}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

/** Distinct (origin, destination) routes across every active
 * search_definitions row, deduped since a route can in principle have both
 * a FLEXIBLE and an EXACT definition — the heatmap is per-route, not
 * per-definition. Each route is keyed by its first-seen definition id,
 * which is what jobs/stagger.ts uses for the bucket assignment; this is
 * stable as long as that definition stays active, which is exactly the
 * "mostly stable bucket assignment" property jobs/stagger.ts documents. */
function distinctActiveRoutes(): { id: number; origin: string; destination: string }[] {
  const activeDefs = db.select().from(searchDefinitions).where(eq(searchDefinitions.active, true)).all();
  const byKey = new Map<string, { id: number; origin: string; destination: string }>();
  for (const def of activeDefs) {
    const { origin, destination } = resolveDefinitionRoute(def);
    const key = `${origin}-${destination}`;
    if (!byKey.has(key)) {
      byKey.set(key, { id: def.id, origin, destination });
    }
  }
  return Array.from(byKey.values());
}

export async function runHeatmapSweep(
  now: number = Date.now(),
  extras: TravelpayoutsExtras = travelpayoutsExtras
): Promise<HeatmapSummary> {
  const routes = distinctActiveRoutes();
  const bucketCount = config.heatmap.staggerBuckets;
  const routesThisSweep = routes.filter((r) => isInSweepBucket(r.id, bucketCount, now));
  const months = monthsAheadFrom(now, config.heatmap.monthsAhead);

  const summary: HeatmapSummary = {
    routesInRoster: routes.length,
    routesRefreshedThisSweep: routesThisSweep.length,
    monthsPerRoute: months.length,
    requestsMade: 0,
    daysUpserted: 0,
    errors: [],
  };

  for (const route of routesThisSweep) {
    for (const month of months) {
      try {
        const result = await extras.fetchMonthMatrix(route.origin, route.destination, month);
        summary.requestsMade += 1;

        for (const day of result.days) {
          const priceMinor = Math.round(day.priceMajor * 100);
          const observedAt = day.foundAt ?? now;
          db.insert(calendarPrices)
            .values({
              origin: route.origin,
              destination: route.destination,
              departDate: day.departDate,
              priceMinor,
              transfers: day.transfers,
              observedAt,
              source: 'MONTH_MATRIX',
            })
            .onConflictDoUpdate({
              // "Replace per (origin, destination, depart_date)" — see
              // db/schema.ts's calendarPrices doc comment.
              target: [calendarPrices.origin, calendarPrices.destination, calendarPrices.departDate],
              set: { priceMinor, transfers: day.transfers, observedAt, source: 'MONTH_MATRIX' },
            })
            .run();
          summary.daysUpserted += 1;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        summary.errors.push({ origin: route.origin, destination: route.destination, message });
      }
    }
  }

  return summary;
}

if (isMainModule(import.meta.url)) {
  void runCli(() => runHeatmapSweep());
}
