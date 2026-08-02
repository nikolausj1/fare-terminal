// runDealsSweep: one /v2/prices/latest sweep (unfiltered — see
// lib/providers/travelpayouts/extras.ts's module doc comment for why this
// endpoint must be called without origin/destination params) into
// latest_deals, then prunes rows older than config.deals.retentionHours.
//
// No staggering here: this endpoint is a network-wide firehose, not scoped
// to the tracked roster, so there's nothing to rotate across sweeps — one
// request per sweep is already the whole job (see the WP-F2 final report
// for the combined per-sweep budget arithmetic across all four new jobs).
//
// Guard: this module is provider-agnostic and will throw MISSING_TOKEN if
// invoked without TRAVELPAYOUTS_TOKEN set — the DATA_PROVIDER=travelpayouts
// AND-token gate lives in the caller (jobs/pipeline.ts).

import { lt } from 'drizzle-orm';

import { db } from '@/db';
import { latestDeals } from '@/db/schema';
import { config } from '@/domain/config';
import { travelpayoutsExtras, type TravelpayoutsExtras } from '@/lib/providers/travelpayouts/extras';

import { isMainModule, runCli } from './_shared';

const HOUR_MS = 3_600_000;

export interface DealsSummary {
  requestsMade: number;
  dealsInserted: number;
  /** Warnings from mapLatestDeals (e.g. a malformed item skipped during
   * mapping) — surfaced here so a sweep with unexpected source data is
   * visible in the job's own logged summary, not just buried in the
   * adapter's return value. */
  mappingWarnings: string[];
  dealsPruned: number;
}

export async function runDealsSweep(
  now: number = Date.now(),
  extras: TravelpayoutsExtras = travelpayoutsExtras
): Promise<DealsSummary> {
  const result = await extras.fetchLatestDeals(config.deals.fetchLimit);

  const rows = result.deals.map((deal) => ({
    origin: deal.origin,
    destination: deal.destination,
    priceMinor: Math.round(deal.priceMajor * 100),
    departDate: deal.departDate ?? null,
    returnDate: deal.returnDate ?? null,
    // The source's own found_at when present; falls back to this sweep's
    // retrieval time only in the rare case the source omitted it (this
    // never happened in the audit's live samples, but mapLatestDeals models
    // foundAt as optional, so this stays honest rather than assuming).
    foundAt: deal.foundAt ?? now,
    observedAt: now,
    distanceKm: deal.distanceKm ?? null,
  }));

  if (rows.length > 0) {
    db.insert(latestDeals).values(rows).run();
  }

  const cutoff = now - config.deals.retentionHours * HOUR_MS;
  const pruneResult = db.delete(latestDeals).where(lt(latestDeals.foundAt, cutoff)).run();

  return {
    requestsMade: 1,
    dealsInserted: rows.length,
    mappingWarnings: result.warnings,
    dealsPruned: pruneResult.changes,
  };
}

if (isMainModule(import.meta.url)) {
  void runCli(() => runDealsSweep());
}
