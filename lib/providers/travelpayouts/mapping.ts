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
  price: z.union([z.number(), z.string()]).optional(),
  airline: z.string().optional(),
  flight_number: z.union([z.string(), z.number()]).optional(),
  transfers: z.number().optional(),
  depart_date: z.string().optional(),
  return_date: z.string().optional(),
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
    const origin = item.origin;
    const destination = item.destination;
    const price = toPrice(item.price);
    const airline = item.airline;
    const departureAt = item.departure_at;

    const missing: string[] = [];
    if (!origin) missing.push('origin');
    if (!destination) missing.push('destination');
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

export function mapCalendar(
  json: unknown,
  query: NormalizedSearchQuery,
  retrievedAt: number
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
    const origin = item.origin ?? query.origin;
    const destination = item.destination ?? query.destination;
    const price = toPrice(item.price);
    const airline = item.airline;
    const departureAt = item.depart_date ?? dateKey;

    const missing: string[] = [];
    if (price === undefined || price <= 0) missing.push('price');
    if (!airline) missing.push('airline');
    if (!departureAt || Number.isNaN(Date.parse(departureAt))) missing.push('depart_date');

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
      returnAt: item.return_date,
      transfers: item.transfers ?? 0,
      link: undefined,
      observedAtSourceKey: item.expires_at ?? retrievedAt,
      query,
      retrievedAt,
      expiresAtMs: validExpiresAtMs,
    });

    offers.push(offer);
    warnings.push(...offerWarnings);
  });

  if (entries.length === 0) {
    warnings.push('calendar: 0 offers in response.');
  }

  return { offers, warnings };
}
