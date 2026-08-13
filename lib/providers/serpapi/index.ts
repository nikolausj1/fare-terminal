// The "serpapi" FlightDataProvider: talks to SerpApi's Google Flights engine
// (https://serpapi.com/google-flights-api). Like travelpayoutsProvider, this
// is a thin orchestration layer — the interesting logic lives in client.ts
// (HTTP), mapping.ts (raw -> NormalizedOffer, pure), and budget.ts (the
// monthly/daily search-budget gate, applied by jobs/ingest.ts, NOT here —
// see that file's per-definition provider-selection logic). See
// docs/PROVIDERS.md for the full picture.
//
// Only meaningfully active when jobs/ingest.ts routes a definition to it AND
// SERPAPI_KEY is set — see lib/providers/index.ts for the registry entry and
// jobs/ingest.ts for the per-definition routing/budget gate. This module
// itself has no opinion on budget; it just executes whatever search it's
// asked to run.

import type {
  NormalizedOffer,
  NormalizedOfferBatch,
  NormalizedSearchQuery,
  ProviderHealth,
} from '@/domain/types';

import type { FlightDataProvider } from '../types';
import { createSerpApiClient, SerpApiError, type QueryParams } from './client';
import { mapGoogleFlights } from './mapping';

const SEARCH_PATH = '/search';
const ACCOUNT_PATH = '/account.json';

const HEALTH_CHECK_DEGRADED_LATENCY_MS = 5000;
const DAY_MS = 86_400_000;

const CABIN_TO_TRAVEL_CLASS: Record<NormalizedSearchQuery['cabin'], number> = {
  ECONOMY: 1,
  PREMIUM_ECONOMY: 2,
  BUSINESS: 3,
  FIRST: 4,
};

function tripTypeParam(tripType: NormalizedSearchQuery['tripType']): number {
  // SerpApi's `type`: 1=Round trip, 2=One way, 3=Multi-city. This app never
  // issues multi-city queries.
  return tripType === 'ONE_WAY' ? 2 : 1;
}

function toDateStr(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * FLEXIBLE-mode date sampling: picks ONE representative departure/return
 * date pair inside [departureWindowStart, departureWindowEnd] rather than
 * querying every date — each SerpApi call costs a real search-budget credit
 * (unlike travelpayouts' month-granularity sampling, there is no cheaper
 * "whole month" query shape for Google Flights). The representative
 * departure date is the window's midpoint (rounded down); the stay length is
 * the midpoint of [stayMinNights, stayMaxNights] (rounded down), or the
 * midpoint of config.demoDefaults' stay bounds when the definition doesn't
 * specify either. Pure function of the query (no wall-clock reads) so it's
 * deterministic and directly unit-testable.
 */
export function pickRepresentativeDates(
  query: Pick<NormalizedSearchQuery, 'departureWindowStart' | 'departureWindowEnd' | 'stayMinNights' | 'stayMaxNights' | 'tripType'>,
  defaultStayMinNights: number,
  defaultStayMaxNights: number
): { departureDate: string; returnDate?: string } {
  if (!query.departureWindowStart || !query.departureWindowEnd) {
    throw new SerpApiError(
      'INVALID_QUERY',
      SEARCH_PATH,
      undefined,
      'FLEXIBLE search requires query.departureWindowStart and query.departureWindowEnd.'
    );
  }

  const startMs = Date.parse(`${query.departureWindowStart}T00:00:00.000Z`);
  const endMs = Date.parse(`${query.departureWindowEnd}T00:00:00.000Z`);
  const midpointMs = startMs + Math.floor((endMs - startMs) / 2);
  const departureDate = toDateStr(midpointMs);

  if (query.tripType === 'ONE_WAY') {
    return { departureDate };
  }

  const stayMin = query.stayMinNights ?? defaultStayMinNights;
  const stayMax = query.stayMaxNights ?? defaultStayMaxNights;
  const stayNights = Math.floor((stayMin + stayMax) / 2);
  const returnDate = toDateStr(midpointMs + stayNights * DAY_MS);

  return { departureDate, returnDate };
}

export interface SerpApiProviderOptions {
  /** Injectable for tests; defaults to the global fetch. Never set in production. */
  fetchImpl?: typeof fetch;
  /** Injectable clock for tests. Defaults to Date.now. */
  clock?: () => number;
  /** Defaults used to fill in a FLEXIBLE definition's stay-night midpoint
   * when the definition itself doesn't specify stayMinNights/stayMaxNights.
   * Defaults to domain/config.ts#demoDefaults' values when omitted. */
  defaultStayMinNights?: number;
  defaultStayMaxNights?: number;
}

/**
 * Builds a serpapiProvider instance. A factory (rather than a bare object)
 * so tests can inject a fake fetch/clock without ever touching the network
 * or real wall-clock time — production code should just use the
 * `serpapiProvider` singleton below. Mirrors
 * lib/providers/travelpayouts/index.ts#createTravelpayoutsProvider.
 */
export function createSerpApiProvider(options: SerpApiProviderOptions = {}): FlightDataProvider {
  const { fetchImpl, clock = Date.now, defaultStayMinNights = 5, defaultStayMaxNights = 9 } = options;

  function getClient() {
    const apiKey = process.env.SERPAPI_KEY;
    if (!apiKey) {
      throw new SerpApiError(
        'MISSING_KEY',
        '(client init)',
        undefined,
        'SERPAPI_KEY is not set; the serpapi provider cannot make requests. (jobs/ingest.ts should have skipped serpapi-routed definitions before reaching here — see its per-definition selection logic.)'
      );
    }
    return createSerpApiClient({ apiKey, fetchImpl });
  }

  function baseSearchParams(query: NormalizedSearchQuery): QueryParams {
    return {
      engine: 'google_flights',
      departure_id: query.origin,
      arrival_id: query.destination,
      currency: query.currency,
      type: tripTypeParam(query.tripType),
      travel_class: CABIN_TO_TRAVEL_CLASS[query.cabin],
      adults: query.adults,
      stops: query.maxStops === 0 ? 1 : undefined, // SerpApi: 1 = nonstop only.
    };
  }

  async function searchExact(
    query: NormalizedSearchQuery,
    retrievedAt: number
  ): Promise<{ offers: NormalizedOffer[]; warnings: string[] }> {
    if (!query.departureDate) {
      throw new SerpApiError('INVALID_QUERY', SEARCH_PATH, undefined, 'EXACT search requires query.departureDate.');
    }
    if (query.tripType === 'ROUND_TRIP' && !query.returnDate) {
      throw new SerpApiError('INVALID_QUERY', SEARCH_PATH, undefined, 'EXACT round-trip search requires query.returnDate.');
    }

    const json = await getClient().get<unknown>(SEARCH_PATH, {
      ...baseSearchParams(query),
      outbound_date: query.departureDate,
      return_date: query.tripType === 'ROUND_TRIP' ? query.returnDate : undefined,
    });

    const mapped = mapGoogleFlights(json, query, retrievedAt);
    return mapped;
  }

  async function searchFlexible(
    query: NormalizedSearchQuery,
    retrievedAt: number
  ): Promise<{ offers: NormalizedOffer[]; warnings: string[] }> {
    const { departureDate, returnDate } = pickRepresentativeDates(query, defaultStayMinNights, defaultStayMaxNights);

    const json = await getClient().get<unknown>(SEARCH_PATH, {
      ...baseSearchParams(query),
      outbound_date: departureDate,
      return_date: returnDate,
    });

    const mapped = mapGoogleFlights(json, query, retrievedAt);
    return {
      offers: mapped.offers,
      warnings: [
        `FLEXIBLE search sampled ONE representative date pair (departure ${departureDate}` +
          `${returnDate ? `, return ${returnDate}` : ''}) inside the requested window, not every date — ` +
          'each SerpApi call spends real search-budget, unlike travelpayouts\' cheaper month-granularity sampling. ' +
          'Treat results as directional, not exhaustive.',
        ...mapped.warnings,
      ],
    };
  }

  return {
    providerId: 'serpapi',

    async search(query: NormalizedSearchQuery): Promise<NormalizedOfferBatch> {
      const retrievedAt = clock();
      const { offers, warnings } =
        query.mode === 'EXACT' ? await searchExact(query, retrievedAt) : await searchFlexible(query, retrievedAt);

      return {
        providerId: 'serpapi',
        query,
        retrievedAt,
        offers,
        warnings,
      };
    },

    async healthCheck(): Promise<ProviderHealth> {
      const start = clock();
      try {
        const apiKey = process.env.SERPAPI_KEY;
        if (!apiKey) {
          return {
            providerId: 'serpapi',
            status: 'DOWN',
            latencyMs: clock() - start,
            details: 'SERPAPI_KEY is not set.',
          };
        }
        const client = createSerpApiClient({ apiKey, fetchImpl });
        // The Account API is free of charge and doesn't count toward the
        // monthly search quota (per SerpApi docs) — safe to call on every
        // health check regardless of the search budget.
        const account = await client.get<{ plan_searches_left?: number; total_searches_left?: number }>(ACCOUNT_PATH);
        const latencyMs = clock() - start;
        const searchesLeft = account.total_searches_left ?? account.plan_searches_left;
        return {
          providerId: 'serpapi',
          status: latencyMs > HEALTH_CHECK_DEGRADED_LATENCY_MS ? 'DEGRADED' : 'OK',
          latencyMs,
          details: searchesLeft !== undefined ? `${searchesLeft} SerpApi searches left this period.` : undefined,
        };
      } catch (err) {
        const latencyMs = clock() - start;
        if (err instanceof SerpApiError && err.code === 'RATE_LIMITED') {
          return { providerId: 'serpapi', status: 'DEGRADED', latencyMs, details: err.message };
        }
        return {
          providerId: 'serpapi',
          status: 'DOWN',
          latencyMs,
          details: err instanceof Error ? err.message : String(err),
        };
      }
    },

    buildOutboundUrl(offer: NormalizedOffer): string | null {
      return offer.outboundUrl ?? null;
    },
  };
}

export const serpapiProvider: FlightDataProvider = createSerpApiProvider();

export { SerpApiError } from './client';
export { evaluateSerpApiBudget, utcMonthStartMs, type SerpApiBudgetLimits, type SerpApiBudgetState } from './budget';

/**
 * True when a search_definitions row's slug belongs to the serpapi-routed
 * roster (domain/config.ts#serpapi.routes), which lists bare route ids
 * ("sea-fco") rather than full slugs ("sea-fco-flex-v1"). Slugs in this app
 * always follow the `${routeId}-${flex|exact}-v${n}` convention (see
 * scripts/bootstrap-real.ts and scripts/bootstrap-serpapi.ts), so the route
 * id is recovered by stripping that suffix. Exported so both
 * jobs/ingest.ts (selection) and scripts/bootstrap-serpapi.ts (idempotent
 * creation) share one definition of the mapping.
 */
export function routeIdFromSlug(slug: string): string {
  return slug.replace(/-(flex|exact)-v\d+$/, '');
}
