// Adapter extras: three additional TravelPayouts/Aviasales Data API
// endpoints beyond the core search path (prices_for_dates/calendar) that
// index.ts + mapping.ts already cover. Added by WP-F2 following the live
// audit at _review/revamp-data-audit.md, which found these three endpoints
// materially denser and/or cheaper than what the adapter used before:
//
//  - /v2/prices/month-matrix: a day-by-day cheapest-price grid for one
//    route/month, one request per month. THE real heatmap data source (see
//    audit §1) — NOT /v1/prices/calendar, which the core adapter uses for a
//    different purpose (searchFlexible's empty-round-trip fallback).
//  - /v1/city-directions: ~30 destination fares from one origin in a single
//    request. Powers the Related Markets / destinations-explorer feature.
//  - /v2/prices/latest: an unfiltered, network-wide "recently found
//    cheapest fares" feed. Per the audit, this endpoint returns EMPTY when
//    filtered to a specific origin/destination — it must be called
//    unfiltered to get any data back.
//
// Same conventions as mapping.ts: zod-tolerant parsing (unknown extra
// fields are silently dropped, not an error), critical-field validation
// happens in application code below (skip + warn), no I/O beyond the
// injected fetch. Reuses client.ts (HTTP + retry) and rateLimiter.ts
// (client-side budget) exactly like index.ts's travelpayoutsProvider, via
// its own factory + singleton — jobs/heatmap.ts, jobs/related.ts, and
// jobs/deals.ts each import `travelpayoutsExtras` (or build their own via
// createTravelpayoutsExtras for tests) rather than depending on the
// FlightDataProvider used for search.
//
// Currency: hardcoded to USD on every call here, deliberately. Unlike
// prices_for_dates/calendar (which serve a specific user's NormalizedSearchQuery
// and must honor query.currency), these three endpoints feed background
// sweep tables with no currency column (db/schema.ts's calendar_prices,
// latest_deals, related_fares) — they exist to power roster-wide
// heatmap/related/deals features at a fixed baseline currency, not
// per-request results. If per-currency support is ever needed here, it
// belongs on the read layer (convert at render time), not by multiplying
// the number of background API calls per currency.

import { z } from 'zod';

import { createTravelpayoutsClient, ProviderError, type QueryParams } from './client';
import { createRateLimiter, type RateLimiter } from './rateLimiter';

const MONTH_MATRIX_PATH = '/v2/prices/month-matrix';
const CITY_DIRECTIONS_PATH = '/v1/city-directions';
const LATEST_DEALS_PATH = '/v2/prices/latest';

const DEFAULT_MAX_REQUESTS_PER_HOUR = 100;
const DEFAULT_LATEST_DEALS_LIMIT = 30;
const EXTRAS_CURRENCY = 'usd';

function getMaxRequestsPerHour(): number {
  const raw = process.env.TP_MAX_REQUESTS_PER_HOUR;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_REQUESTS_PER_HOUR;
}

// --- Shared helpers (duplicated from mapping.ts rather than imported/
// exported across the file, to keep these two adapter files independently
// editable without coupling their internals — both are small, stable, and
// intentionally trivial). -----------------------------------------------

function toPrice(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : undefined;
}

/** Non-empty, non-blank string -> the string; everything else (undefined,
 * '', whitespace-only) -> undefined. Several of these endpoints return ""
 * for an absent optional field (e.g. month-matrix's `return_date: ""`)
 * rather than omitting the key or using null — confirmed live 2026-08-02,
 * see tests/unit/fixtures/travelpayouts/month-matrix-real-2026-08-02.json. */
function toOptionalString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Parses a source-reported timestamp, tolerating the two real formats seen
 * live 2026-08-02: /v2/prices/month-matrix's `found_at` carries a trailing
 * "Z" (e.g. "2026-08-02T17:50:10Z"), while /v2/prices/latest's `found_at`
 * carries no timezone indicator at all (e.g. "2026-08-02T17:52:58"). A bare
 * timestamp from this API is UTC in practice (both endpoints' values are
 * clearly the same clock, just formatted differently) — appending "Z" when
 * no zone indicator is present avoids JS's Date.parse silently treating it
 * as local time instead. */
function parseSourceTimestamp(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const hasZoneIndicator = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw);
  const normalized = hasZoneIndicator ? raw : `${raw}Z`;
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? undefined : ms;
}

// --- /v2/prices/month-matrix --------------------------------------------

// Real response shape confirmed live 2026-08-02 (see
// tests/unit/fixtures/travelpayouts/month-matrix-real-2026-08-02.json):
// unlike prices_for_dates/calendar, items here carry origin/destination as
// CITY codes only (e.g. "NYC"/"LON") with NO origin_airport/
// destination_airport fields at all — so mapMonthMatrix does not try to
// read origin/destination off each item; it uses the airport codes the
// caller queried with instead (they're what actually got flown, same as
// the query itself specifies).
const monthMatrixItemSchema = z.object({
  depart_date: z.string().optional(),
  value: z.union([z.number(), z.string()]).optional(),
  number_of_changes: z.number().optional(),
  found_at: z.string().optional(),
  actual: z.boolean().optional(),
  gate: z.string().optional(),
});

const monthMatrixResponseSchema = z.object({
  success: z.boolean().optional(),
  currency: z.string().optional(),
  data: z.array(monthMatrixItemSchema).optional(),
  error: z.string().optional(),
});

/** One priced day cell from a month-matrix response. */
export interface MonthMatrixDay {
  departDate: string; // YYYY-MM-DD
  priceMajor: number;
  transfers: number;
  /** The source's own cache-observation timestamp (epoch ms), when present
   * — this is the "genuine per-cell observed timestamp" the audit calls
   * out as new: prices_for_dates/calendar offers only get the adapter's
   * retrieval time, not a real source timestamp. Undefined if the source
   * omitted found_at or it failed to parse. */
  foundAt: number | undefined;
  /** Source-reported freshness/cache-staleness flag, when present. Not
   * currently persisted to calendar_prices (no column for it) — carried
   * here for callers that want it (e.g. a future qualityFlags surface). */
  actual: boolean | undefined;
  /** OTA name that supplied this cached price. Informational only, not
   * currently modeled anywhere downstream. */
  gate: string | undefined;
}

export interface MonthMatrixResult {
  origin: string;
  destination: string;
  month: string; // YYYY-MM
  days: MonthMatrixDay[];
  warnings: string[];
}

export function mapMonthMatrix(
  json: unknown,
  origin: string,
  destination: string,
  monthISO: string,
  retrievedAt: number
): MonthMatrixResult {
  const parsed = monthMatrixResponseSchema.safeParse(json);
  if (!parsed.success) {
    return {
      origin,
      destination,
      month: monthISO,
      days: [],
      warnings: [
        `month-matrix: response did not match the expected shape (${parsed.error.issues.length} issue(s)); no days extracted.`,
      ],
    };
  }

  const items = parsed.data.data ?? [];
  const days: MonthMatrixDay[] = [];
  const warnings: string[] = [];

  items.forEach((item, index) => {
    const price = toPrice(item.value);
    const departDate = toOptionalString(item.depart_date);

    const missing: string[] = [];
    if (!departDate || Number.isNaN(Date.parse(departDate))) missing.push('depart_date');
    if (price === undefined || price <= 0) missing.push('value');

    if (missing.length > 0) {
      warnings.push(`month-matrix[${index}]: skipped, missing/invalid field(s): ${missing.join(', ')}.`);
      return;
    }

    if (!(departDate as string).startsWith(monthISO)) {
      warnings.push(
        `month-matrix[${index}]: depart_date ${departDate} falls outside the requested month ${monthISO}; kept as-is (it's still real data for that specific day) but flagged for review — see mapMonthMatrix's month-mismatch handling.`
      );
    }

    days.push({
      departDate: departDate as string,
      priceMajor: price as number,
      transfers: item.number_of_changes ?? 0,
      foundAt: parseSourceTimestamp(item.found_at),
      actual: item.actual,
      gate: toOptionalString(item.gate),
    });
  });

  if (items.length === 0) {
    warnings.push('month-matrix: 0 days in response.');
  }

  void retrievedAt; // not currently embedded in the result; kept for a consistent call signature with mapping.ts's mapPricesForDates/mapCalendar and for future use if a fallback timestamp is needed.

  return { origin, destination, month: monthISO, days, warnings };
}

// --- /v1/city-directions --------------------------------------------------

// Real response shape confirmed live 2026-08-02 (see
// tests/unit/fixtures/travelpayouts/city-directions-real-2026-08-02.json):
// an object keyed by destination code (a mix of city and airport-shaped
// codes, e.g. "MOW", "CHI", "LAX"), no distance field on this endpoint (the
// audit's schema note that distance_km is optional on related_fares/
// RelatedMarketVM is why — it's genuinely absent from this source).
const cityDirectionItemSchema = z.object({
  origin: z.string().optional(),
  destination: z.string().optional(),
  airline: z.string().optional(),
  departure_at: z.string().optional(),
  return_at: z.string().optional(),
  expires_at: z.string().optional(),
  price: z.union([z.number(), z.string()]).optional(),
  flight_number: z.union([z.string(), z.number()]).optional(),
  transfers: z.number().optional(),
  distance: z.number().optional(),
});

const cityDirectionsResponseSchema = z.object({
  success: z.boolean().optional(),
  currency: z.string().optional(),
  // Keyed by destination code, not an array — same shape convention as
  // /v1/prices/calendar (see mapping.ts's calendarResponseSchema).
  data: z.record(z.string(), cityDirectionItemSchema).optional(),
  error: z.string().optional(),
});

export interface CityDirectionFare {
  destination: string;
  priceMajor: number;
  airline: string | undefined;
  departureAt: string | undefined; // ISO, when present
  returnAt: string | undefined;
  distanceKm: number | undefined;
}

export interface CityDirectionsResult {
  origin: string;
  fares: CityDirectionFare[];
  warnings: string[];
}

export function mapCityDirections(json: unknown, origin: string, retrievedAt: number): CityDirectionsResult {
  const parsed = cityDirectionsResponseSchema.safeParse(json);
  if (!parsed.success) {
    return {
      origin,
      fares: [],
      warnings: [
        `city-directions: response did not match the expected shape (${parsed.error.issues.length} issue(s)); no fares extracted.`,
      ],
    };
  }

  const entries = Object.entries(parsed.data.data ?? {});
  const fares: CityDirectionFare[] = [];
  const warnings: string[] = [];

  entries.forEach(([destKey, item]) => {
    // Prefer the item's own `destination` field; fall back to the response
    // object's own key (both were identical in every live sample this
    // session, but the key is guaranteed non-empty while the field is
    // optional in the schema).
    const destination = toOptionalString(item.destination) ?? toOptionalString(destKey);
    const price = toPrice(item.price);

    const missing: string[] = [];
    if (!destination) missing.push('destination');
    if (price === undefined || price <= 0) missing.push('price');

    if (missing.length > 0) {
      warnings.push(`city-directions[${destKey}]: skipped, missing/invalid field(s): ${missing.join(', ')}.`);
      return;
    }

    fares.push({
      destination: destination as string,
      priceMajor: price as number,
      airline: toOptionalString(item.airline),
      departureAt: toOptionalString(item.departure_at),
      returnAt: toOptionalString(item.return_at),
      distanceKm: item.distance,
    });
  });

  if (entries.length === 0) {
    warnings.push('city-directions: 0 destinations in response.');
  }

  void retrievedAt; // see mapMonthMatrix's identical note.

  return { origin, fares, warnings };
}

// --- /v2/prices/latest ------------------------------------------------

// Real response shape confirmed live 2026-08-02 (see
// tests/unit/fixtures/travelpayouts/latest-deals-real-2026-08-02.json and
// latest-deals-empty-filtered-real-2026-08-02.json): an array, same item
// shape as month-matrix (depart_date/return_date/value/found_at/gate/
// number_of_changes/duration/distance/actual), but network-wide instead of
// scoped to one route. Confirmed empty when origin+destination params are
// supplied — mapLatestDeals doesn't take an origin/destination filter
// parameter at all, matching fetchLatestDeals(limit) always calling this
// unfiltered.
const latestDealItemSchema = z.object({
  origin: z.string().optional(),
  destination: z.string().optional(),
  depart_date: z.string().optional(),
  return_date: z.string().optional(),
  value: z.union([z.number(), z.string()]).optional(),
  found_at: z.string().optional(),
  distance: z.number().optional(),
});

const latestDealsResponseSchema = z.object({
  success: z.boolean().optional(),
  currency: z.string().optional(),
  data: z.array(latestDealItemSchema).optional(),
  error: z.string().optional(),
});

export interface LatestDeal {
  origin: string;
  destination: string;
  priceMajor: number;
  departDate: string | undefined; // YYYY-MM-DD, when present
  returnDate: string | undefined;
  foundAt: number | undefined;
  distanceKm: number | undefined;
}

export interface LatestDealsResult {
  deals: LatestDeal[];
  warnings: string[];
}

export function mapLatestDeals(json: unknown, retrievedAt: number): LatestDealsResult {
  const parsed = latestDealsResponseSchema.safeParse(json);
  if (!parsed.success) {
    return {
      deals: [],
      warnings: [
        `latest-deals: response did not match the expected shape (${parsed.error.issues.length} issue(s)); no deals extracted.`,
      ],
    };
  }

  const items = parsed.data.data ?? [];
  const deals: LatestDeal[] = [];
  const warnings: string[] = [];

  items.forEach((item, index) => {
    const origin = toOptionalString(item.origin);
    const destination = toOptionalString(item.destination);
    const price = toPrice(item.value);

    const missing: string[] = [];
    if (!origin) missing.push('origin');
    if (!destination) missing.push('destination');
    if (price === undefined || price <= 0) missing.push('value');

    if (missing.length > 0) {
      warnings.push(`latest-deals[${index}]: skipped, missing/invalid field(s): ${missing.join(', ')}.`);
      return;
    }

    deals.push({
      origin: origin as string,
      destination: destination as string,
      priceMajor: price as number,
      departDate: toOptionalString(item.depart_date),
      returnDate: toOptionalString(item.return_date),
      foundAt: parseSourceTimestamp(item.found_at),
      distanceKm: item.distance,
    });
  });

  if (items.length === 0) {
    warnings.push('latest-deals: 0 deals in response.');
  }

  void retrievedAt; // see mapMonthMatrix's identical note.

  return { deals, warnings };
}

// --- Provider extras: fetch + rate-limit wiring -------------------------

export interface TravelpayoutsExtrasOptions {
  /** Injectable for tests; defaults to the global fetch. Never set in production. */
  fetchImpl?: typeof fetch;
  /** Injectable clock for tests. Defaults to Date.now. */
  clock?: () => number;
}

export interface TravelpayoutsExtras {
  /** One request per call: the full day-by-day price grid for `origin` ->
   * `destination` in the calendar month `monthISO` (e.g. "2026-09"). */
  fetchMonthMatrix(origin: string, destination: string, monthISO: string): Promise<MonthMatrixResult>;
  /** One request per call: ~30 destination fares from `origin`. */
  fetchCityDirections(origin: string): Promise<CityDirectionsResult>;
  /** One request per call: an unfiltered, network-wide page of recently
   * observed cheapest fares (`limit` rows, default
   * DEFAULT_LATEST_DEALS_LIMIT / config.deals.fetchLimit). */
  fetchLatestDeals(limit?: number): Promise<LatestDealsResult>;
}

/**
 * Builds a travelpayoutsExtras instance. A factory (mirroring
 * createTravelpayoutsProvider in index.ts) so tests can inject a fake
 * fetch/clock without ever touching the network or real wall-clock time —
 * see tests/unit/travelpayouts-extras.test.ts. Production code should use
 * the `travelpayoutsExtras` singleton below.
 */
export function createTravelpayoutsExtras(options: TravelpayoutsExtrasOptions = {}): TravelpayoutsExtras {
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
        '(extras client init)',
        undefined,
        'TRAVELPAYOUTS_TOKEN is not set; the travelpayouts extras adapter cannot make requests.'
      );
    }
    return createTravelpayoutsClient({ token, fetchImpl });
  }

  async function callGet<T>(endpoint: string, params: QueryParams): Promise<T> {
    // Client-side budget check first: fail fast locally instead of burning
    // a real request against Travelpayouts' server-side limit. This is a
    // SEPARATE rate-limiter instance from index.ts's travelpayoutsProvider
    // — the two adapters are invoked from different job processes in
    // production (jobs/ingest.ts vs. jobs/pipeline.ts, run as separate `npm
    // run` steps in .github/workflows/real-data-refresh.yml), so each gets
    // its own in-process budget rather than needing to share state across
    // processes. See the workflow file / final report for the combined
    // per-sweep request arithmetic across both.
    getRateLimiter().check(endpoint);
    return getClient().get<T>(endpoint, params);
  }

  return {
    async fetchMonthMatrix(origin, destination, monthISO) {
      const retrievedAt = clock();
      const json = await callGet<unknown>(MONTH_MATRIX_PATH, {
        origin,
        destination,
        month: `${monthISO}-01`,
        currency: EXTRAS_CURRENCY,
        show_to_affiliates: true,
      });
      return mapMonthMatrix(json, origin, destination, monthISO, retrievedAt);
    },

    async fetchCityDirections(origin) {
      const retrievedAt = clock();
      const json = await callGet<unknown>(CITY_DIRECTIONS_PATH, {
        origin,
        currency: EXTRAS_CURRENCY,
      });
      return mapCityDirections(json, origin, retrievedAt);
    },

    async fetchLatestDeals(limit = DEFAULT_LATEST_DEALS_LIMIT) {
      const retrievedAt = clock();
      const json = await callGet<unknown>(LATEST_DEALS_PATH, {
        currency: EXTRAS_CURRENCY,
        limit,
        sorting: 'price',
        page: 1,
      });
      return mapLatestDeals(json, retrievedAt);
    },
  };
}

export const travelpayoutsExtras: TravelpayoutsExtras = createTravelpayoutsExtras();
