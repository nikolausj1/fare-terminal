// The "travelpayouts" FlightDataProvider: talks to the TravelPayouts /
// Aviasales Data API (https://api.travelpayouts.com). Unlike demoProvider,
// this one is a thin orchestration layer — all the interesting logic lives
// in client.ts (HTTP), mapping.ts (raw -> NormalizedOffer, pure), and
// rateLimiter.ts (client-side budget). See docs/PROVIDERS.md for the full
// picture, including honesty limitations of this data source.
//
// Only active when DATA_PROVIDER=travelpayouts AND TRAVELPAYOUTS_TOKEN is
// set — see lib/providers/index.ts for the fallback-to-demo logic.

import type {
  NormalizedOffer,
  NormalizedOfferBatch,
  NormalizedSearchQuery,
  ProviderHealth,
} from '@/domain/types';

import type { FlightDataProvider } from '../types';
import { createTravelpayoutsClient, ProviderError, type QueryParams } from './client';
import { mapPricesForDates } from './mapping';
import { createRateLimiter, type RateLimiter } from './rateLimiter';

const PRICES_FOR_DATES_PATH = '/aviasales/v3/prices_for_dates';
const CALENDAR_PATH = '/v1/prices/calendar';

const DEFAULT_MAX_REQUESTS_PER_HOUR = 100;
// A fixed, reliably-busy route used only as a health-check canary — not a
// real user search.
const HEALTH_CHECK_ORIGIN = 'JFK';
const HEALTH_CHECK_DESTINATION = 'LAX';
const HEALTH_CHECK_DEGRADED_LATENCY_MS = 3000;
// FLEXIBLE mode samples the window at month granularity rather than calling
// prices_for_dates once per day; capped to keep a single search cheap
// relative to the ~200 req/hour account-wide limit.
const MAX_FLEXIBLE_MONTH_SAMPLES = 3;

const CACHE_CAVEAT_WARNING =
  'Prices are Travelpayouts/Aviasales cached "cheapest seen" observations (cache age up to ~48h), not live quotes. See qualityFlags on each offer.';

function getMaxRequestsPerHour(): number {
  const raw = process.env.TP_MAX_REQUESTS_PER_HOUR;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_REQUESTS_PER_HOUR;
}

function monthsInWindow(startDateStr: string, endDateStr: string): string[] {
  const start = new Date(`${startDateStr}T00:00:00Z`);
  const end = new Date(`${endDateStr}T00:00:00Z`);
  const months: string[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const endCursor = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));

  while (cursor.getTime() <= endCursor.getTime()) {
    const year = cursor.getUTCFullYear();
    const month = String(cursor.getUTCMonth() + 1).padStart(2, '0');
    months.push(`${year}-${month}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return months;
}

export interface TravelpayoutsProviderOptions {
  /** Injectable for tests; defaults to the global fetch. Never set in production. */
  fetchImpl?: typeof fetch;
  /** Injectable clock for tests. Defaults to Date.now. */
  clock?: () => number;
}

/**
 * Builds a travelpayoutsProvider instance. A factory (rather than a bare
 * object like demoProvider) so tests can inject a fake fetch/clock without
 * ever touching the network or real wall-clock time; production code should
 * just use the `travelpayoutsProvider` singleton below.
 */
export function createTravelpayoutsProvider(options: TravelpayoutsProviderOptions = {}): FlightDataProvider {
  const { fetchImpl, clock = Date.now } = options;

  let rateLimiter: RateLimiter | undefined;
  let rateLimiterBudget: number | undefined;

  function getRateLimiter(): RateLimiter {
    const budget = getMaxRequestsPerHour();
    if (!rateLimiter || rateLimiterBudget !== budget) {
      rateLimiter = createRateLimiter(budget, clock);
      rateLimiterBudget = budget;
    }
    return rateLimiter;
  }

  function getClient() {
    const token = process.env.TRAVELPAYOUTS_TOKEN;
    if (!token) {
      throw new ProviderError(
        'MISSING_TOKEN',
        '(client init)',
        undefined,
        'TRAVELPAYOUTS_TOKEN is not set; the travelpayouts provider cannot make requests. (The registry should have fallen back to demo before reaching here — see lib/providers/index.ts.)'
      );
    }
    return createTravelpayoutsClient({ token, fetchImpl });
  }

  async function callGet<T>(endpoint: string, params: QueryParams): Promise<T> {
    // Client-side budget check first: fail fast locally instead of burning
    // a real request against Travelpayouts' server-side limit.
    getRateLimiter().check(endpoint);
    return getClient().get<T>(endpoint, params);
  }

  async function searchExact(
    query: NormalizedSearchQuery,
    retrievedAt: number
  ): Promise<{ offers: NormalizedOffer[]; warnings: string[] }> {
    if (!query.departureDate) {
      throw new ProviderError(
        'INVALID_QUERY',
        PRICES_FOR_DATES_PATH,
        undefined,
        'EXACT search requires query.departureDate.'
      );
    }
    if (query.tripType === 'ROUND_TRIP' && !query.returnDate) {
      throw new ProviderError(
        'INVALID_QUERY',
        PRICES_FOR_DATES_PATH,
        undefined,
        'EXACT round-trip search requires query.returnDate.'
      );
    }

    const json = await callGet<unknown>(PRICES_FOR_DATES_PATH, {
      origin: query.origin,
      destination: query.destination,
      departure_at: query.departureDate,
      return_at: query.tripType === 'ROUND_TRIP' ? query.returnDate : undefined,
      one_way: query.tripType === 'ONE_WAY',
      unique: false,
      sorting: 'price',
      direct: query.maxStops === 0,
      currency: query.currency.toLowerCase(),
      limit: 100,
    });

    const mapped = mapPricesForDates(json, query, retrievedAt);
    return { offers: mapped.offers, warnings: [...mapped.warnings, CACHE_CAVEAT_WARNING] };
  }

  async function searchFlexible(
    query: NormalizedSearchQuery,
    retrievedAt: number
  ): Promise<{ offers: NormalizedOffer[]; warnings: string[] }> {
    if (!query.departureWindowStart || !query.departureWindowEnd) {
      throw new ProviderError(
        'INVALID_QUERY',
        PRICES_FOR_DATES_PATH,
        undefined,
        'FLEXIBLE search requires query.departureWindowStart and query.departureWindowEnd.'
      );
    }

    const allMonths = monthsInWindow(query.departureWindowStart, query.departureWindowEnd);
    const sampledMonths = allMonths.slice(0, MAX_FLEXIBLE_MONTH_SAMPLES);

    const warnings: string[] = [
      `FLEXIBLE search samples prices_for_dates at month granularity (${sampledMonths.join(', ')}), not every date in the window; treat results as directional, not exhaustive.`,
      CACHE_CAVEAT_WARNING,
    ];
    if (allMonths.length > sampledMonths.length) {
      warnings.push(
        `Window spans ${allMonths.length} months; only the first ${sampledMonths.length} were sampled to stay within the per-search call budget.`
      );
    }

    const offers: NormalizedOffer[] = [];
    for (const month of sampledMonths) {
      const json = await callGet<unknown>(PRICES_FOR_DATES_PATH, {
        origin: query.origin,
        destination: query.destination,
        departure_at: month,
        return_at: query.tripType === 'ROUND_TRIP' ? month : undefined,
        one_way: query.tripType === 'ONE_WAY',
        unique: false,
        sorting: 'price',
        direct: query.maxStops === 0,
        currency: query.currency.toLowerCase(),
        limit: 100,
      });
      const mapped = mapPricesForDates(json, query, retrievedAt);
      offers.push(...mapped.offers);
      warnings.push(...mapped.warnings);
    }

    const windowStartMs = Date.parse(query.departureWindowStart);
    const windowEndMs = Date.parse(query.departureWindowEnd);

    const filtered = offers.filter((offer) => {
      const departureAt = offer.segments[0]?.departureAt;
      const departureMs = departureAt ? Date.parse(departureAt) : Number.NaN;
      if (Number.isNaN(departureMs) || departureMs < windowStartMs || departureMs > windowEndMs) {
        return false;
      }

      if (
        offer.segments.length > 1 &&
        query.stayMinNights !== undefined &&
        query.stayMaxNights !== undefined
      ) {
        const returnDepartureMs = Date.parse(offer.segments[1].departureAt);
        const nights = Math.round((returnDepartureMs - departureMs) / (24 * 3_600_000));
        if (nights < query.stayMinNights || nights > query.stayMaxNights) {
          return false;
        }
      }

      return true;
    });

    return { offers: filtered, warnings };
  }

  return {
    providerId: 'travelpayouts',

    async search(query: NormalizedSearchQuery): Promise<NormalizedOfferBatch> {
      const retrievedAt = clock();
      const { offers, warnings } =
        query.mode === 'EXACT' ? await searchExact(query, retrievedAt) : await searchFlexible(query, retrievedAt);

      return {
        providerId: 'travelpayouts',
        query,
        retrievedAt,
        offers,
        warnings,
      };
    },

    async healthCheck(): Promise<ProviderHealth> {
      const start = clock();
      try {
        const now = new Date(start);
        const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
        await callGet<unknown>(CALENDAR_PATH, {
          origin: HEALTH_CHECK_ORIGIN,
          destination: HEALTH_CHECK_DESTINATION,
          depart_date: month,
          calendar_type: 'departure_date',
          currency: 'usd',
        });
        const latencyMs = clock() - start;
        return {
          providerId: 'travelpayouts',
          status: latencyMs > HEALTH_CHECK_DEGRADED_LATENCY_MS ? 'DEGRADED' : 'OK',
          latencyMs,
        };
      } catch (err) {
        const latencyMs = clock() - start;
        if (err instanceof ProviderError && err.code === 'RATE_LIMITED') {
          // Transient, not an outage — the account/IP is just over budget.
          return {
            providerId: 'travelpayouts',
            status: 'DEGRADED',
            latencyMs,
            details: err.message,
          };
        }
        return {
          providerId: 'travelpayouts',
          status: 'DOWN',
          latencyMs,
          details: err instanceof Error ? err.message : String(err),
        };
      }
    },

    buildOutboundUrl(offer: NormalizedOffer): string | null {
      if (!offer.outboundUrl) return null;
      const marker = process.env.TRAVELPAYOUTS_MARKER;
      if (!marker) return null;
      try {
        const url = new URL(offer.outboundUrl);
        url.searchParams.set('marker', marker);
        return url.toString();
      } catch {
        return null;
      }
    },
  };
}

export const travelpayoutsProvider: FlightDataProvider = createTravelpayoutsProvider();
