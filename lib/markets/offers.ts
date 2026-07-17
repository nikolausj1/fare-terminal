// Shared DB-row <-> domain-type conversions for offer_observations. Used by
// both the derivation jobs (jobs/**, which need NormalizedOffer[] to feed
// the domain engines) and the read layer (lib/markets/queries.ts, which
// needs the same rows for OfferRowVM). Keeping the mapping in one place
// means the row shape only has to be translated once.

import { eq, inArray } from 'drizzle-orm';

import { db } from '@/db';
import { offerObservations } from '@/db/schema';
import type { Cabin, NormalizedOffer, Segment } from '@/domain/types';

export type OfferObservationRow = typeof offerObservations.$inferSelect;

export function rowToNormalizedOffer(row: OfferObservationRow): NormalizedOffer {
  return {
    providerId: row.providerId,
    providerOfferId: row.providerOfferId,
    observedAt: row.observedAt,
    expiresAt: row.expiresAt ?? undefined,
    currency: row.currency,
    totalPriceMinor: row.totalPriceMinor,
    basePriceMinor: row.basePriceMinor ?? undefined,
    taxesMinor: row.taxesMinor ?? undefined,
    optionalFeesKnown: row.optionalFeesKnown,
    validatingCarrier: row.validatingCarrier,
    marketingCarriers: row.marketingCarriers,
    operatingCarriers: row.operatingCarriers,
    segments: row.segmentsJson as Segment[],
    durationMinutes: row.durationMinutes,
    stopCount: row.stopCount,
    cabin: row.cabin as Cabin,
    fareBrand: row.fareBrand ?? undefined,
    bookingClasses: row.bookingClassesJson ?? undefined,
    seatsRemaining: row.seatsRemaining ?? undefined,
    outboundUrl: row.outboundUrl ?? undefined,
    qualityFlags: row.qualityFlags,
  };
}

/** Loads every offer_observations row for a set of search_runs (typically
 * one run's worth for a snapshot, or a run + its predecessor for event
 * detection) and returns the raw rows. */
export function loadOfferRowsForSearchRunIds(runIds: number[]): OfferObservationRow[] {
  if (runIds.length === 0) return [];
  return db
    .select()
    .from(offerObservations)
    .where(inArray(offerObservations.searchRunId, runIds))
    .all();
}

/** Same as loadOfferRowsForSearchRunIds, converted to NormalizedOffer[] for
 * feeding directly into the domain engines. */
export function loadOffersForSearchRunIds(runIds: number[]): NormalizedOffer[] {
  return loadOfferRowsForSearchRunIds(runIds).map(rowToNormalizedOffer);
}

/**
 * Loads every offer_observations row for a whole search_definitions row in
 * ONE query and groups the results by search_run_id, converted to
 * NormalizedOffer[]. Used by jobs/snapshots.ts and jobs/events.ts, which
 * both need "this run's offers" for potentially hundreds of runs per
 * definition — looping a per-run query for each of those runs turns into
 * hundreds of round trips; loading everything for the definition once and
 * grouping in memory is dramatically faster (this cut the full 12-market
 * demo pipeline from ~95s to a few seconds).
 */
export function loadOffersGroupedByRunId(searchDefinitionId: number): Map<number, NormalizedOffer[]> {
  const rows = db
    .select()
    .from(offerObservations)
    .where(eq(offerObservations.searchDefinitionId, searchDefinitionId))
    .all();

  const grouped = new Map<number, NormalizedOffer[]>();
  for (const row of rows) {
    const offer = rowToNormalizedOffer(row);
    const existing = grouped.get(row.searchRunId);
    if (existing) {
      existing.push(offer);
    } else {
      grouped.set(row.searchRunId, [offer]);
    }
  }
  return grouped;
}
