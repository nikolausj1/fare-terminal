// Pure functions mapping raw TravelPayouts/Aviasales API responses onto the
// domain's NormalizedOffer model (domain/types.ts). No I/O, no env reads —
// everything needed is passed in, which is what makes these fully
// fixture-testable (tests/unit/travelpayouts.test.ts).
//
// See docs/PROVIDERS.md for the full rationale behind the synthetic-segment
// / aggregated-cached-source honesty flags applied below; the short version:
// these endpoints return a single cached "cheapest observed" row per
// route/date/airline, not real segment-level itinerary data, so every offer
// built here is a best-effort reconstruction, not a verified itinerary.

import { createHash } from 'node:crypto';
import { z } from 'zod';

import type { Cabin, NormalizedOffer, NormalizedSearchQuery, Segment } from '@/domain/types';

export const QUALITY_FLAG_AGGREGATED_CACHED_SOURCE = 'AGGREGATED_CACHED_SOURCE';
export const QUALITY_FLAG_SYNTHETIC_SEGMENTS = 'SYNTHETIC_SEGMENTS';
export const QUALITY_FLAG_ESTIMATED_DURATION = 'ESTIMATED_DURATION';
export const QUALITY_FLAG_ESTIMATED_LEG_SPLIT = 'ESTIMATED_LEG_SPLIT';
// Real prices_for_dates/calendar responses report `origin`/`destination` as
// CITY codes (e.g. NYC, LON) — which can cover several airports — while
// `origin_airport`/`destination_airport` carry the actual airport IATA code
// actually flown. Confirmed against live responses 2026-07-24; not covered
// by the original hand-written fixtures. This adapter always prefers the
// *_airport fields; when they're absent it falls back to the city code and
// flags the offer so downstream consumers know the segment's origin/
// destination may be less precise than a real airport code (e.g. could be
// any of several airports serving that city).
export const QUALITY_FLAG_CITY_CODE_FALLBACK = 'CITY_CODE_FALLBACK';
// Added when an offer was recovered via the /v1/prices/calendar fallback
// path (lib/providers/travelpayouts/index.ts#searchFlexible) rather than
// the primary /aviasales/v3/prices_for_dates call — see the comment there
// for why this fallback exists (real-world round-trip month-granularity
// queries against prices_for_dates are frequently empty for routes that DO
// have real cached data via the calendar endpoint).
export const QUALITY_FLAG_CALENDAR_FALLBACK_SOURCE = 'CALENDAR_FALLBACK_SOURCE';

export interface MappingResult {
  offers: NormalizedOffer[];
  warnings: string[];
}

// --- Raw response schemas --------------------------------------------------
// Deliberately loose: everything beyond the handful of fields we treat as
// "critical" is optional, and zod's default object parsing silently strips
// unrecognized keys instead of failing, so additive API changes never break
// mapping. Critical-field enforcement (skip + warn, with a specific reason)
// happens in application code below rather than in the schema itself.

const priceForDatesItemSchema = z.object({
  origin: z.string().optional(),
  destination: z.string().optional(),
  origin_airport: z.string().optional(),
  destination_airport: z.string().optional(),
  price: z.union([z.number(), z.string()]).optional(),
  airline: z.string().optional(),
  flight_number: z.union([z.string(), z.number()]).optional(),
  departure_at: z.string().optional(),
  return_at: z.string().optional(),
  transfers: z.number().optional(),
  return_transfers: z.number().optional(),
  duration: z.number().optional(),
  link: z.string().optional(),
});

const pricesForDatesResponseSchema = z.object({
  success: z.boolean().optional(),
  currency: z.string().optional(),
  data: z.array(priceForDatesItemSchema).optional(),
  error: z.string().optional(),
});

const calendarItemSchema = z.object({
  origin: z.string().optional(),
  destination: z.string().optional(),
  origin_airport: z.string().optional(),
  destination_airport: z.string().optional(),
  price: z.union([z.number(), z.string()]).optional(),
  airline: z.string().optional(),
  flight_number: z.union([z.string(), z.number()]).optional(),
  transfers: z.number().optional(),
  // Real /v1/prices/calendar responses observed 2026-07-24 use
  // `departure_at`/`return_at` (matching prices_for_dates), NOT
  // `depart_date`/`return_date` as older TravelPayouts docs/examples show.
  // Both spellings are accepted; departure_at/return_at win when both are
  // present (see resolveCalendarDates below).
  depart_date: z.string().optional(),
  return_date: z.string().optional(),
  departure_at: z.string().optional(),
  return_at: z.string().optional(),
  expires_at: z.string().optional(),
});

const calendarResponseSchema = z.object({
  success: z.boolean().optional(),
  currency: z.string().optional(),
  // The v1 calendar endpoint returns an object keyed by ISO date, not an
  // array — each value is the cheapest offer found for that departure date.
  data: z.record(z.string(), calendarItemSchema).optional(),
  error: z.string().optional(),
});

// --- Shared helpers ----------------------------------------------------

// Used only when the source gives us no duration at all (should be rare).
// This is a documented placeholder, not a measurement — every offer that
// hits this path carries QUALITY_FLAG_ESTIMATED_DURATION.
const DEFAULT_ESTIMATED_DURATION_MINUTES = 300;

function toPrice(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function toFlightNumber(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  const str = String(value).trim();
  return str.length > 0 ? str : undefined;
}

/** Prefers the airport-code field; falls back to the (coarser) city code
 * when the airport field is absent. See QUALITY_FLAG_CITY_CODE_FALLBACK. */
function resolveAirportCode(
  cityCode: string | undefined,
  airportCode: string | undefined
): { code: string | undefined; usedCityFallback: boolean } {
  if (airportCode) return { code: airportCode, usedCityFallback: false };
  if (cityCode) return { code: cityCode, usedCityFallback: true };
  return { code: undefined, usedCityFallback: false };
}

function computeProviderOfferId(parts: Array<string | number>): string {
  const hash = createHash('sha1');
  hash.update(parts.join('|'));
  return `tp_${hash.digest('hex').slice(0, 24)}`;
}

interface BuildOfferParams {
  origin: string;
  destination: string;
  airline: string;
  flightNumber: string;
  priceMajor: number;
  departureAt: string;
  returnAt?: string;
  transfers: number;
  returnTransfers?: number;
  durationMinutesRaw?: number;
  link?: string;
  /** found_at / expires_at / a retrievedAt fallback — folded into the offer id hash. */
  observedAtSourceKey: string | number;
  query: NormalizedSearchQuery;
  retrievedAt: number;
  expiresAtMs?: number;
  /** True when origin and/or destination came from the coarser city-code
   * field rather than a per-airport field — see QUALITY_FLAG_CITY_CODE_FALLBACK. */
  usedCityCodeFallback?: boolean;
  /** True when this offer was recovered via the /v1/prices/calendar fallback
   * path rather than the primary prices_for_dates call — see
   * QUALITY_FLAG_CALENDAR_FALLBACK_SOURCE. */
  fromCalendarFallback?: boolean;
}

/**
 * Builds one NormalizedOffer from a single cached price observation.
 *
 * Segment reconstruction: the API gives us at most one flight number and one
 * total duration per result, never real per-leg segment data. So:
 *  - one_way / no return_at -> a single synthetic Segment (origin ->
 *    destination), duration = the raw `duration` field.
 *  - round trip (return_at present) -> two synthetic Segments (outbound and
 *    inbound). The raw `duration` field is the *combined* round-trip flight
 *    time; we assume an even split between the two legs (there is no way to
 *    recover the true split from this endpoint) and flag the offer with
 *    QUALITY_FLAG_ESTIMATED_LEG_SPLIT.
 *  - If `duration` is missing entirely, we fall back to a fixed placeholder
 *    (DEFAULT_ESTIMATED_DURATION_MINUTES) and flag
 *    QUALITY_FLAG_ESTIMATED_DURATION.
 * Both offer.qualityFlags additions are on top of the two flags every
 * Travelpayouts offer always carries: AGGREGATED_CACHED_SOURCE (the price is
 * a cache of a past Aviasales search, not a live quote) and
 * SYNTHETIC_SEGMENTS (segments are reconstructed, not sourced from the API).
 */
function buildOffer(params: BuildOfferParams): { offer: NormalizedOffer; warnings: string[] } {
  const warnings: string[] = [];
  const cabin: Cabin = params.query.cabin;

  const departureMs = Date.parse(params.departureAt);
  const returnMsRaw = params.returnAt ? Date.parse(params.returnAt) : undefined;
  const hasReturnLeg = returnMsRaw !== undefined && !Number.isNaN(returnMsRaw);
  const returnMs = hasReturnLeg ? (returnMsRaw as number) : undefined;

  const qualityFlags = [QUALITY_FLAG_AGGREGATED_CACHED_SOURCE, QUALITY_FLAG_SYNTHETIC_SEGMENTS];
  if (params.usedCityCodeFallback) {
    qualityFlags.push(QUALITY_FLAG_CITY_CODE_FALLBACK);
    warnings.push(
      `${params.origin}-${params.destination} on ${params.departureAt}: origin_airport/destination_airport missing from source, used city code(s) as a lower-precision fallback.`
    );
  }
  if (params.fromCalendarFallback) {
    qualityFlags.push(QUALITY_FLAG_CALENDAR_FALLBACK_SOURCE);
  }

  let outboundDurationMin: number;
  let inboundDurationMin: number | undefined;

  if (params.durationMinutesRaw === undefined || params.durationMinutesRaw <= 0) {
    outboundDurationMin = hasReturnLeg
      ? Math.round(DEFAULT_ESTIMATED_DURATION_MINUTES / 2)
      : DEFAULT_ESTIMATED_DURATION_MINUTES;
    inboundDurationMin = hasReturnLeg ? outboundDurationMin : undefined;
    qualityFlags.push(QUALITY_FLAG_ESTIMATED_DURATION);
    warnings.push(
      `${params.origin}-${params.destination} on ${params.departureAt}: duration missing from source, estimated at ${DEFAULT_ESTIMATED_DURATION_MINUTES}m total and flagged.`
    );
  } else if (hasReturnLeg) {
    outboundDurationMin = Math.round(params.durationMinutesRaw / 2);
    inboundDurationMin = params.durationMinutesRaw - outboundDurationMin;
    qualityFlags.push(QUALITY_FLAG_ESTIMATED_LEG_SPLIT);
  } else {
    outboundDurationMin = params.durationMinutesRaw;
  }

  const outboundArrivalMs = departureMs + outboundDurationMin * 60_000;
  const flightNumber = `${params.airline}${params.flightNumber}`;

  const segments: Segment[] = [
    {
      operatingFlightNumber: flightNumber,
      marketingFlightNumber: flightNumber,
      origin: params.origin,
      destination: params.destination,
      departureAt: new Date(departureMs).toISOString(),
      arrivalAt: new Date(outboundArrivalMs).toISOString(),
      cabin,
    },
  ];

  if (hasReturnLeg && returnMs !== undefined && inboundDurationMin !== undefined) {
    const inboundArrivalMs = returnMs + inboundDurationMin * 60_000;
    segments.push({
      operatingFlightNumber: flightNumber,
      marketingFlightNumber: flightNumber,
      origin: params.destination,
      destination: params.origin,
      departureAt: new Date(returnMs).toISOString(),
      arrivalAt: new Date(inboundArrivalMs).toISOString(),
      cabin,
    });
  }

  const totalDurationMinutes = outboundDurationMin + (inboundDurationMin ?? 0);
  const stopCount = Math.max(params.transfers ?? 0, params.returnTransfers ?? 0);
  const totalPriceMinor = Math.round(params.priceMajor * 100);

  const providerOfferId = computeProviderOfferId([
    params.origin,
    params.destination,
    params.departureAt,
    params.returnAt ?? '',
    params.airline,
    params.flightNumber,
    totalPriceMinor,
    params.observedAtSourceKey,
  ]);

  const offer: NormalizedOffer = {
    providerId: 'travelpayouts',
    providerOfferId,
    // Deliberately the retrieval time, not a source-reported observation
    // time: prices_for_dates/calendar don't reliably expose when the
    // underlying cache entry was written (that's `found_at` on the separate
    // /v2/prices/latest endpoint, which this adapter does not call). Using
    // retrievedAt avoids implying precision we don't have; the fact that the
    // price may itself be up to ~48h stale is communicated via
    // QUALITY_FLAG_AGGREGATED_CACHED_SOURCE and batch warnings instead. See
    // docs/PROVIDERS.md.
    observedAt: params.retrievedAt,
    expiresAt: params.expiresAtMs,
    currency: params.query.currency,
    totalPriceMinor,
    optionalFeesKnown: false,
    validatingCarrier: params.airline,
    marketingCarriers: [params.airline],
    operatingCarriers: [params.airline],
    segments,
    durationMinutes: totalDurationMinutes,
    stopCount,
    cabin,
    outboundUrl: params.link ? `https://www.aviasales.com${params.link}` : undefined,
    qualityFlags,
  };

  return { offer, warnings };
}

// --- /aviasales/v3/prices_for_dates ----------------------------------------

export function mapPricesForDates(
  json: unknown,
  query: NormalizedSearchQuery,
  retrievedAt: number
): MappingResult {
  const parsed = pricesForDatesResponseSchema.safeParse(json);
  if (!parsed.success) {
    return {
      offers: [],
      warnings: [
        `prices_for_dates: response did not match the expected shape (${parsed.error.issues.length} issue(s)); no offers extracted.`,
      ],
    };
  }

  const items = parsed.data.data ?? [];
  const offers: NormalizedOffer[] = [];
  const warnings: string[] = [];

  items.forEach((item, index) => {
    // origin/destination are CITY codes (e.g. NYC, LON) — they can cover
    // several airports. origin_airport/destination_airport carry the actual
    // airport actually flown and are preferred whenever present; see
    // QUALITY_FLAG_CITY_CODE_FALLBACK.
    const originResolved = resolveAirportCode(item.origin, item.origin_airport);
    const destResolved = resolveAirportCode(item.destination, item.destination_airport);
    const origin = originResolved.code;
    const destination = destResolved.code;
    const price = toPrice(item.price);
    const airline = item.airline;
    const departureAt = item.departure_at;

    const missing: string[] = [];
    if (!origin) missing.push('origin/origin_airport');
    if (!destination) missing.push('destination/destination_airport');
    if (price === undefined || price <= 0) missing.push('price');
    if (!airline) missing.push('airline');
    if (!departureAt || Number.isNaN(Date.parse(departureAt))) missing.push('departure_at');

    if (missing.length > 0) {
      warnings.push(`prices_for_dates[${index}]: skipped, missing/invalid field(s): ${missing.join(', ')}.`);
      return;
    }

    const flightNumber = toFlightNumber(item.flight_number) ?? '0000';
    if (!toFlightNumber(item.flight_number)) {
      warnings.push(`prices_for_dates[${index}]: flight_number missing, using placeholder "${flightNumber}".`);
    }

    const { offer, warnings: offerWarnings } = buildOffer({
      origin: origin as string,
      destination: destination as string,
      airline: airline as string,
      flightNumber,
      priceMajor: price as number,
      departureAt: departureAt as string,
      returnAt: item.return_at,
      transfers: item.transfers ?? 0,
      returnTransfers: item.return_transfers,
      durationMinutesRaw: item.duration,
      link: item.link,
      observedAtSourceKey: retrievedAt,
      query,
      retrievedAt,
      usedCityCodeFallback: originResolved.usedCityFallback || destResolved.usedCityFallback,
    });

    offers.push(offer);
    warnings.push(...offerWarnings);
  });

  if (items.length === 0) {
    warnings.push('prices_for_dates: 0 offers in response.');
  }

  return { offers, warnings };
}

// --- /v1/prices/calendar ----------------------------------------------

export interface MapCalendarOptions {
  /** Set when this call is being used as the searchFlexible fallback path
   * (an empty prices_for_dates month re-queried against /v1/prices/calendar)
   * rather than the dedicated healthCheck() call — tags every resulting
   * offer with QUALITY_FLAG_CALENDAR_FALLBACK_SOURCE. */
  fromCalendarFallback?: boolean;
}

export function mapCalendar(
  json: unknown,
  query: NormalizedSearchQuery,
  retrievedAt: number,
  options: MapCalendarOptions = {}
): MappingResult {
  const parsed = calendarResponseSchema.safeParse(json);
  if (!parsed.success) {
    return {
      offers: [],
      warnings: [
        `calendar: response did not match the expected shape (${parsed.error.issues.length} issue(s)); no offers extracted.`,
      ],
    };
  }

  const entries = Object.entries(parsed.data.data ?? {});
  const offers: NormalizedOffer[] = [];
  const warnings: string[] = [];

  entries.forEach(([dateKey, item]) => {
    // Same city-code-vs-airport-code distinction as prices_for_dates (see
    // mapPricesForDates above), though live calendar responses observed so
    // far haven't included the *_airport fields at all — falling back to
    // query.origin/query.destination (the airport codes the search itself
    // was made for) when even the city-code fields are absent, since that's
    // still more precise than leaving the offer unmapped.
    const originResolved = resolveAirportCode(item.origin ?? query.origin, item.origin_airport);
    const destResolved = resolveAirportCode(item.destination ?? query.destination, item.destination_airport);
    const origin = originResolved.code;
    const destination = destResolved.code;
    const price = toPrice(item.price);
    const airline = item.airline;
    // Real /v1/prices/calendar responses observed 2026-07-24 use
    // departure_at/return_at (matching prices_for_dates); depart_date/
    // return_date are accepted too in case older API versions/docs are
    // right for some accounts. The dateKey (the response's own object key)
    // is the final fallback for departure date — it's always a valid date.
    const departureAt = item.departure_at ?? item.depart_date ?? dateKey;
    const returnAt = item.return_at ?? item.return_date;

    const missing: string[] = [];
    if (!origin) missing.push('origin/origin_airport');
    if (!destination) missing.push('destination/destination_airport');
    if (price === undefined || price <= 0) missing.push('price');
    if (!airline) missing.push('airline');
    if (!departureAt || Number.isNaN(Date.parse(departureAt))) missing.push('departure_at/depart_date');

    if (missing.length > 0) {
      warnings.push(`calendar[${dateKey}]: skipped, missing/invalid field(s): ${missing.join(', ')}.`);
      return;
    }

    const flightNumber = toFlightNumber(item.flight_number) ?? '0000';
    if (!toFlightNumber(item.flight_number)) {
      warnings.push(`calendar[${dateKey}]: flight_number missing, using placeholder "${flightNumber}".`);
    }

    const expiresAtMs = item.expires_at ? Date.parse(item.expires_at) : undefined;
    const validExpiresAtMs = expiresAtMs !== undefined && !Number.isNaN(expiresAtMs) ? expiresAtMs : undefined;

    const { offer, warnings: offerWarnings } = buildOffer({
      origin: origin as string,
      destination: destination as string,
      airline: airline as string,
      flightNumber,
      priceMajor: price as number,
      departureAt: departureAt as string,
      returnAt,
      transfers: item.transfers ?? 0,
      link: undefined,
      observedAtSourceKey: item.expires_at ?? retrievedAt,
      query,
      retrievedAt,
      expiresAtMs: validExpiresAtMs,
      usedCityCodeFallback: originResolved.usedCityFallback || destResolved.usedCityFallback,
      fromCalendarFallback: options.fromCalendarFallback,
    });

    offers.push(offer);
    warnings.push(...offerWarnings);
  });

  if (entries.length === 0) {
    warnings.push('calendar: 0 offers in response.');
  }

  return { offers, warnings };
}
