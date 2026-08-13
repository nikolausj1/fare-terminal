// runIngestion: for each active search_definitions row (optionally filtered
// to a subset of ids), calls the appropriate provider's search(), runs the
// normalization pipeline (validate -> dedupe -> flagAnomalies), and persists
// one search_runs row + one offer_observations row per surviving offer.
//
// Used for "refresh now" (app/api/markets/[origin]/[destination]/refresh)
// and future scheduled polling. NOT used for historical backfill — that
// data already exists in the DB after `npm run seed` (see jobs/backfill.ts).
//
// WP-P3 provider selection: every definition uses getActiveProvider() (the
// DATA_PROVIDER-based registry pick, unchanged) EXCEPT the small serpapi
// roster (domain/config.ts#serpapi.routes) — those definitions are routed
// directly to serpapiProvider, gated by SERPAPI_KEY and the monthly/daily
// search budget (lib/providers/serpapi/budget.ts), regardless of whatever
// DATA_PROVIDER is set to. This is deliberately config-driven per-definition
// routing, not a schema column — see domain/config.ts's serpapi block and
// docs/PROVIDERS.md's SerpApi section for the full rationale.

import { and, count, eq, gte, inArray, max } from 'drizzle-orm';

import { db } from '@/db';
import { googlePriceHistory, offerObservations, routePriceInsights, searchDefinitions, searchRuns } from '@/db/schema';
import { config } from '@/domain/config';
import { getNow } from '@/lib/demo-time';
import type { NormalizedPriceInsights } from '@/domain/types';
import {
  dedupeOffers,
  flagAnomalies,
  itineraryFingerprint,
  normalizeAndValidate,
} from '@/domain/normalization';
import { getActiveProvider } from '@/lib/providers';
import { evaluateSerpApiBudget, routeIdFromSlug, serpapiProvider, utcMonthStartMs } from '@/lib/providers/serpapi';
import type { FlightDataProvider } from '@/lib/providers/types';

import { buildQueryFromDefinition, isMainModule, parseDefinitionIdsArg, resolveDefinitionRoute, runCli } from './_shared';

const CHUNK_SIZE = 500;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** True when a search_definitions row's slug belongs to the serpapi-routed
 * roster — see lib/providers/serpapi/index.ts#routeIdFromSlug for how the
 * bare route id (`config.serpapi.routes` entries) is recovered from a full
 * slug like "sea-fco-flex-v1". */
function isSerpApiRouteSlug(slug: string): boolean {
  return (config.serpapi.routes as readonly string[]).includes(routeIdFromSlug(slug));
}

/** COUNT(*) of serpapi search_runs rows started within the current UTC
 * calendar month, as of `now` — the input to the monthly half of
 * evaluateSerpApiBudget(). Deliberately a plain query against the existing
 * search_runs table rather than a new usage-counter table/column — see
 * lib/providers/serpapi/budget.ts's module comment. */
function getSerpApiMonthlySearchCount(now: number): number {
  const monthStart = utcMonthStartMs(now);
  const row = db
    .select({ value: count() })
    .from(searchRuns)
    .where(and(eq(searchRuns.providerId, 'serpapi'), gte(searchRuns.startedAt, monthStart)))
    .get();
  return row?.value ?? 0;
}

/** MAX(started_at) of serpapi search_runs rows for one search_definitions
 * row — the input to the daily half of evaluateSerpApiBudget(). */
function getSerpApiLastRunAt(searchDefinitionId: number): number | undefined {
  const row = db
    .select({ value: max(searchRuns.startedAt) })
    .from(searchRuns)
    .where(and(eq(searchRuns.providerId, 'serpapi'), eq(searchRuns.searchDefinitionId, searchDefinitionId)))
    .get();
  return row?.value ?? undefined;
}

/**
 * WP-P5: persists one serpapi search's price_insights (Google's own
 * price-tracking history — see domain/types.ts#NormalizedPriceInsights) into
 * google_price_history (one UPSERT per day, "keep latest capture" —
 * matches google_price_history's UNIQUE(search_definition_id, price_date)
 * in db/schema.ts) plus one new append-only route_price_insights row.
 *
 * Exported (not an inline closure in the ingest loop) for two reasons: (1)
 * it's directly unit/integration-testable against a real temp DB without
 * needing a live SerpApi response or fetch injection through the module-
 * level `serpapiProvider` singleton, and (2)
 * scripts/backfill-price-insights.ts reuses this exact function rather than
 * re-implementing the upsert — see that script's module comment for why
 * sharing this code path (not just the general shape) matters for the
 * backfill.
 */
export function persistPriceInsights(
  searchDefinitionId: number,
  priceInsights: NormalizedPriceInsights,
  capturedAt: number
): { historyPointsUpserted: number } {
  for (const point of priceInsights.history) {
    db.insert(googlePriceHistory)
      .values({
        searchDefinitionId,
        priceDate: point.date,
        priceMinor: point.priceMinor,
        capturedAt,
      })
      .onConflictDoUpdate({
        target: [googlePriceHistory.searchDefinitionId, googlePriceHistory.priceDate],
        set: { priceMinor: point.priceMinor, capturedAt },
      })
      .run();
  }

  db.insert(routePriceInsights)
    .values({
      searchDefinitionId,
      capturedAt,
      priceLevel: priceInsights.priceLevel,
      typicalLowMinor: priceInsights.typicalLowMinor,
      typicalHighMinor: priceInsights.typicalHighMinor,
      lowestPriceMinor: priceInsights.lowestPriceMinor,
    })
    .run();

  return { historyPointsUpserted: priceInsights.history.length };
}

export interface IngestSummary {
  definitionsProcessed: number;
  searchRunsCreated: number;
  offersInserted: number;
  offersRejected: number;
  errors: { searchDefinitionId: number; message: string }[];
  /** WP-P3: serpapi-routed definitions skipped this run because
   * SERPAPI_KEY is unset. Not counted in definitionsProcessed — no search
   * was attempted, so no search_runs row (success or failure) was written. */
  serpapiSkippedNoKey: number;
  /** WP-P3: serpapi-routed definitions skipped this run by the
   * monthly/daily budget gate (lib/providers/serpapi/budget.ts). Also not
   * counted in definitionsProcessed, for the same reason. */
  serpapiSkippedBudget: { searchDefinitionId: number; reason: string }[];
}

export interface RunIngestionOptions {
  /** WP-P5 backfill-only escape hatch: when true, the per-definition DAILY
   * serpapi gate (evaluateSerpApiBudget's "already swept today (UTC)"
   * check) is bypassed by pretending each definition has no prior run —
   * scripts/backfill-price-insights.ts needs to search all 8 roster
   * definitions in one sitting, which the daily gate would otherwise
   * collapse to 1. The MONTHLY budget gate is NEVER bypassed here — it's
   * still computed and enforced exactly as normal, so this can't be used to
   * exceed config.serpapi.monthlySearchBudget. Never set true from
   * scheduled/production ingestion — only the backfill script's explicit
   * `--force` flag threads this through (see that script's module comment). */
  bypassDailyGate?: boolean;
}

export async function runIngestion(
  searchDefinitionIds?: number[],
  options: RunIngestionOptions = {}
): Promise<IngestSummary> {
  // Unchanged default-provider pick — still used for every definition NOT
  // routed to serpapi. Computed once, exactly like before WP-P3.
  const defaultProvider = getActiveProvider();

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
    serpapiSkippedNoKey: 0,
    serpapiSkippedBudget: [],
  };

  const serpApiKeyPresent = Boolean(process.env.SERPAPI_KEY);
  let loggedNoKeyWarning = false;

  for (const def of defs) {
    let provider: FlightDataProvider;

    if (isSerpApiRouteSlug(def.slug)) {
      if (!serpApiKeyPresent) {
        if (!loggedNoKeyWarning) {
          console.warn(
            `[ingest] SERPAPI_KEY is not set; skipping serpapi-routed definition(s) this run (roster: ${config.serpapi.routes.join(', ')}). Set SERPAPI_KEY to activate — see .env.example / docs/PROVIDERS.md.`
          );
          loggedNoKeyWarning = true;
        }
        summary.serpapiSkippedNoKey += 1;
        continue;
      }

      const checkNow = getNow();
      const decision = evaluateSerpApiBudget(
        {
          monthlySearchCount: getSerpApiMonthlySearchCount(checkNow),
          // WP-P5: bypassDailyGate pretends this definition has never run
          // today — the monthly count above is ALWAYS the real one, so the
          // monthly gate still applies unchanged. See RunIngestionOptions.
          lastRunAtForDefinition: options.bypassDailyGate ? undefined : getSerpApiLastRunAt(def.id),
        },
        checkNow,
        { monthlySearchBudget: config.serpapi.monthlySearchBudget, sweepsPerDay: config.serpapi.sweepsPerDay }
      );
      if (!decision.allowed) {
        const reason = decision.reason ?? 'budget gate';
        console.warn(`[ingest] skipping serpapi search for search_definitions ${def.id} (${def.slug}): ${reason}`);
        summary.serpapiSkippedBudget.push({ searchDefinitionId: def.id, reason });
        continue;
      }

      provider = serpapiProvider;
    } else {
      provider = defaultProvider;
    }

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

      // WP-P5: only the serpapi path ever populates batch.priceInsights
      // (see lib/providers/serpapi/index.ts) — every other provider leaves
      // it undefined, so this is a no-op for the rest of the roster.
      if (batch.priceInsights) {
        const { historyPointsUpserted } = persistPriceInsights(def.id, batch.priceInsights, batch.retrievedAt);
        console.log(
          `[ingest] search_definitions ${def.id} (${def.slug}): captured ${historyPointsUpserted} Google price_insights history point(s), price_level=${batch.priceInsights.priceLevel}.`
        );
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
