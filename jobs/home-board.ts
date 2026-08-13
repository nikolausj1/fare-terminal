// refreshHomeBoard: populates city_direction_history (append-only) AND
// keeps related_fares (upsert-replace "current") fresh, both from a single
// /v1/city-directions call against the owner's home origin
// (config.homeBoard.origin, SEA). Powers the "From Seattle" personal home
// board — see lib/markets/home-board.ts for the read layer and
// domain/config.ts#homeBoard for the tunables.
//
// UNCONDITIONAL, not staggered: unlike jobs/heatmap.ts/jobs/related.ts
// (which rotate a fraction of a large roster through jobs/stagger.ts's
// buckets to control request volume), this job has exactly one origin and
// is cheap enough (1 request) to run in full on every sweep — that's also
// what makes city_direction_history a genuine day-over-day time series
// rather than a staggered/partial one.
//
// Guard: this module is provider-agnostic and will throw MISSING_TOKEN if
// invoked without TRAVELPAYOUTS_TOKEN set — the DATA_PROVIDER=travelpayouts
// AND-token gate lives in the caller (jobs/pipeline.ts), matching how
// jobs/heatmap.ts, jobs/deals.ts, and jobs/related.ts are gated too.

import { db } from '@/db';
import { cityDirectionHistory, relatedFares } from '@/db/schema';
import { config } from '@/domain/config';
import { travelpayoutsExtras, type TravelpayoutsExtras } from '@/lib/providers/travelpayouts/extras';

import { isMainModule, runCli } from './_shared';

export interface HomeBoardSummary {
  origin: string;
  requestsMade: number;
  destinationsObserved: number;
  /** Rows appended to city_direction_history this sweep — always equal to
   * destinationsObserved (one history row per returned destination, no
   * skipping) unless a future validation rule rejects a row. */
  historyRowsAppended: number;
  /** Rows upserted into related_fares this sweep (existing Related Markets
   * feature) — kept fresh as a side effect of this same call so that
   * feature doesn't need its own request against this origin. */
  relatedFaresUpserted: number;
  errors: { message: string }[];
}

export async function refreshHomeBoard(
  now: number = Date.now(),
  extras: TravelpayoutsExtras = travelpayoutsExtras
): Promise<HomeBoardSummary> {
  const origin = config.homeBoard.origin;

  const summary: HomeBoardSummary = {
    origin,
    requestsMade: 0,
    destinationsObserved: 0,
    historyRowsAppended: 0,
    relatedFaresUpserted: 0,
    errors: [],
  };

  try {
    const result = await extras.fetchCityDirections(origin);
    summary.requestsMade += 1;
    summary.destinationsObserved = result.fares.length;

    for (const fare of result.fares) {
      const priceMinor = Math.round(fare.priceMajor * 100);

      // Append-only history — every sweep's observation for this
      // destination is its own row, never overwritten. Contrast with the
      // related_fares upsert immediately below. See db/schema.ts's
      // cityDirectionHistory doc comment.
      db.insert(cityDirectionHistory)
        .values({
          origin,
          destination: fare.destination,
          priceMinor,
          observedAt: now,
          // city-directions carries no real cache-observation timestamp on
          // this endpoint (unlike month-matrix/prices-latest) — see
          // extras.ts's mapCityDirections doc comment.
          foundAt: null,
        })
        .run();
      summary.historyRowsAppended += 1;

      // Also keep related_fares current for the existing Related Markets
      // feature (lib/markets/related.ts / jobs/related.ts), so it stays
      // fresh for this origin even on sweeps where jobs/related.ts's own
      // stagger bucket skips SEA. Same "replace per pair" semantics as
      // jobs/related.ts — see db/schema.ts's relatedFares doc comment.
      db.insert(relatedFares)
        .values({
          origin,
          destination: fare.destination,
          priceMinor,
          observedAt: now,
          source: 'CITY_DIRECTIONS',
        })
        .onConflictDoUpdate({
          target: [relatedFares.origin, relatedFares.destination],
          set: { priceMinor, observedAt: now, source: 'CITY_DIRECTIONS' },
        })
        .run();
      summary.relatedFaresUpserted += 1;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    summary.errors.push({ message });
  }

  return summary;
}

if (isMainModule(import.meta.url)) {
  void runCli(() => refreshHomeBoard());
}
