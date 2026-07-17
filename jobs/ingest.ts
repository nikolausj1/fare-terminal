// runIngestion: for each active search_definitions row (optionally filtered
// to a subset of ids), calls the active provider's search(), runs the
// normalization pipeline (validate -> dedupe -> flagAnomalies), and persists
// one search_runs row + one offer_observations row per surviving offer.
//
// Used for "refresh now" (app/api/markets/[origin]/[destination]/refresh)
// and future scheduled polling. NOT used for historical backfill — that
// data already exists in the DB after `npm run seed` (see jobs/backfill.ts).

import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/db';
import { offerObservations, searchDefinitions, searchRuns } from '@/db/schema';
import { getNow } from '@/lib/demo-time';
import {
  dedupeOffers,
  flagAnomalies,
  itineraryFingerprint,
  normalizeAndValidate,
} from '@/domain/normalization';
import { getActiveProvider } from '@/lib/providers';

import { buildQueryFromDefinition, isMainModule, parseDefinitionIdsArg, resolveDefinitionRoute, runCli } from './_shared';

const CHUNK_SIZE = 500;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export interface IngestSummary {
  definitionsProcessed: number;
  searchRunsCreated: number;
  offersInserted: number;
  offersRejected: number;
  errors: { searchDefinitionId: number; message: string }[];
}

export async function runIngestion(searchDefinitionIds?: number[]): Promise<IngestSummary> {
  const provider = getActiveProvider();

  const defs =
    searchDefinitionIds && searchDefinitionIds.length > 0
      ? db
          .select()
          .from(searchDefinitions)
          .where(
            and(eq(searchDefinitions.active, true), inArray(searchDefinitions.id, searchDefinitionIds))
          )
          .all()
      : db.select().from(searchDefinitions).where(eq(searchDefinitions.active, true)).all();

  const summary: IngestSummary = {
    definitionsProcessed: 0,
    searchRunsCreated: 0,
    offersInserted: 0,
    offersRejected: 0,
    errors: [],
  };

  for (const def of defs) {
    summary.definitionsProcessed += 1;
    const startedAt = getNow();

    try {
      const { origin, destination } = resolveDefinitionRoute(def);
      const query = buildQueryFromDefinition(def, origin, destination, startedAt);
      const batch = await provider.search(query);

      const { valid, rejected } = normalizeAndValidate(batch);
      const deduped = dedupeOffers(valid);
      const finalOffers = flagAnomalies(deduped);

      const [runRow] = db
        .insert(searchRuns)
        .values({
          searchDefinitionId: def.id,
          providerId: provider.providerId,
          startedAt,
          completedAt: getNow(),
          status: 'SUCCESS',
          offerCountRaw: batch.offers.length,
          offerCountNormalized: finalOffers.length,
        })
        .returning({ id: searchRuns.id })
        .all();

      const rows = finalOffers.map((offer) => ({
        searchRunId: runRow.id,
        searchDefinitionId: def.id,
        providerId: offer.providerId,
        providerOfferId: offer.providerOfferId,
        // Canonical fingerprint (domain/normalization/fingerprint.ts) — see
        // db/seed/index.ts for the reconciliation note on why this must be
        // the ONLY source of offer_observations.itinerary_fingerprint.
        itineraryFingerprint: itineraryFingerprint(offer.segments),
        observedAt: offer.observedAt,
        expiresAt: offer.expiresAt ?? null,
        currency: offer.currency,
        totalPriceMinor: offer.totalPriceMinor,
        basePriceMinor: offer.basePriceMinor ?? null,
        taxesMinor: offer.taxesMinor ?? null,
        optionalFeesKnown: offer.optionalFeesKnown,
        validatingCarrier: offer.validatingCarrier,
        marketingCarriers: offer.marketingCarriers,
        operatingCarriers: offer.operatingCarriers,
        segmentsJson: offer.segments,
        durationMinutes: offer.durationMinutes,
        stopCount: offer.stopCount,
        cabin: offer.cabin,
        fareBrand: offer.fareBrand ?? null,
        bookingClassesJson: offer.bookingClasses ?? null,
        seatsRemaining: offer.seatsRemaining ?? null,
        outboundUrl: offer.outboundUrl ?? null,
        qualityFlags: offer.qualityFlags,
      }));

      for (const batchRows of chunk(rows, CHUNK_SIZE)) {
        db.insert(offerObservations).values(batchRows).run();
      }

      summary.searchRunsCreated += 1;
      summary.offersInserted += finalOffers.length;
      summary.offersRejected += rejected.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push({ searchDefinitionId: def.id, message });
      db.insert(searchRuns)
        .values({
          searchDefinitionId: def.id,
          providerId: provider.providerId,
          startedAt,
          completedAt: getNow(),
          status: 'FAILED',
          offerCountRaw: 0,
          offerCountNormalized: 0,
          errorCode: message.slice(0, 200),
        })
        .run();
    }
  }

  return summary;
}

if (isMainModule(import.meta.url)) {
  const ids = parseDefinitionIdsArg(process.argv);
  void runCli(() => runIngestion(ids));
}
