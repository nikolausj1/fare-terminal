// Pure functions mapping raw SerpApi "Google Flights" engine responses
// (https://serpapi.com/google-flights-api) onto the domain's NormalizedOffer
// model (domain/types.ts). No I/O, no env reads — everything needed is
// passed in, which is what makes these fully fixture-testable (see
// tests/unit/serpapi-mapping.test.ts). Mirrors the shape of
// lib/providers/travelpayouts/mapping.ts deliberately; see docs/PROVIDERS.md
// for the full write-up of how this adapter differs from travelpayouts.
//
// Schemas below are deliberately loose (zod strips unrecognized keys rather
// than failing) — SerpApi's response carries several fields this adapter
// doesn't use (airplane, legroom, extensions, carbon_emissions, ...) that
// must pass through harmlessly rather than break mapping when SerpApi adds
// more.

import { createHash } from 'node:crypto';
import { z } from 'zod';

import type { Cabin, NormalizedOffer, NormalizedPriceInsights, NormalizedSearchQuery, Segment } from '@/domain/types';

// Every offer this adapter produces carries this flag: unlike travelpayouts'
// cached "cheapest seen" aggregate, SerpApi runs (or very recently ran) an
// actual Google Flights search and returns real, currently-displayed
// itineraries — the closest thing to a live quote this app has.
export const QUALITY_FLAG_LIVE_SEARCH_SOURCE = 'LIVE_SEARCH_SOURCE';
// SerpApi's departure_airport.time / arrival_airport.time are LOCAL clock
// strings ("YYYY-MM-DD HH:MM") with no UTC offset and no timezone name. This
// adapter has no way to resolve an IATA code to a timezone without another
// external dependency, so it treats each leg's departure time as if it were
// UTC (a labeling choice, not a real UTC instant) and derives that leg's
// arrival from the reported `duration` (which Google computes correctly
// regardless of timezone) rather than separately re-interpreting
// arrival_airport.time in ITS local zone — parsing both fields naively as
// UTC would silently corrupt elapsed time across any itinerary that crosses
// timezones (i.e. almost all of them). See parseLocalTimeAsUtcMs() below.
// Every offer is flagged so downstream code never mistakes these for precise
// wall-clock UTC instants; itinerary-internal ordering (arrival after
// departure) and each leg's duration remain correct.
export const QUALITY_FLAG_NAIVE_LOCAL_TIMESTAMPS = 'NAIVE_LOCAL_TIMESTAMPS';
// A round-trip Google Flights search is a two-step flow: the first call (the
// only one this adapter makes, to conserve the search budget — see
// docs/PROVIDERS.md and lib/providers/serpapi/budget.ts) returns OUTBOUND
// itinerary options only, each carrying a `departure_token` that a SECOND
// search would use to fetch the matching return-leg options. `price` on
// each option is already the full round-trip total, but `flights`/
// `segments` cover only the outbound direction. Confirmed against a real
// captured response (tests/unit/fixtures/serpapi-real-sea-fco-2026-08-02.json,
// SEA-FCO round trip: only SEA->FRA->FCO legs present, nothing for the
// FCO->SEA return). Applied only for ROUND_TRIP queries — a ONE_WAY query's
// single direction is genuinely complete.
export const QUALITY_FLAG_OUTBOUND_ONLY_SEGMENTS = 'OUTBOUND_ONLY_SEGMENTS';

export interface MappingResult {
  offers: NormalizedOffer[];
  warnings: string[];
  /** WP-P5: Google's own price-tracking history, when the response carried a
   * usable price_insights object — see mapPriceInsights below and
   * NormalizedPriceInsights's doc comment in domain/types.ts. */
  priceInsights?: NormalizedPriceInsights;
}

// --- Raw response schemas --------------------------------------------------

const airportRefSchema = z.object({
  name: z.string().optional(),
  id: z.string().optional(),
  time: z.string().optional(),
});

const flightLegSchema = z.object({
  departure_airport: airportRefSchema.optional(),
  arrival_airport: airportRefSchema.optional(),
  duration: z.number().optional(),
  airplane: z.string().optional(),
  airline: z.string().optional(),
  airline_logo: z.string().optional(),
  travel_class: z.string().optional(),
  flight_number: z.string().optional(),
  legroom: z.string().optional(),
  extensions: z.array(z.string()).optional(),
  overnight: z.boolean().optional(),
  often_delayed_by_over_30_min: z.boolean().optional(),
  ticket_also_sold_by: z.array(z.string()).optional(),
});

const layoverSchema = z.object({
  duration: z.number().optional(),
  name: z.string().optional(),
  id: z.string().optional(),
  overnight: z.boolean().optional(),
});

const flightOptionSchema = z.object({
  flights: z.array(flightLegSchema).optional(),
  layovers: z.array(layoverSchema).optional(),
  total_duration: z.number().optional(),
  price: z.union([z.number(), z.string()]).optional(),
  type: z.string().optional(),
  airline_logo: z.string().optional(),
  departure_token: z.string().optional(),
  booking_token: z.string().optional(),
});

const searchMetadataSchema = z.object({
  google_flights_url: z.string().optional(),
});

// Loose on purpose, same spirit as the schemas above: every field optional
// (and the whole object optional at the call site) so a response with no
// price_insights at all, or one SerpApi/Google trims down over time, maps
// to `undefined`/partial rather than a hard failure. See
// QUALITY note in mapPriceInsights below for exactly which combinations of
// missing fields cause the whole object to be dropped vs. individual
// fields to go null.
const priceInsightsSchema = z.object({
  lowest_price: z.union([z.number(), z.string()]).optional(),
  price_level: z.string().optional(),
  typical_price_range: z.array(z.union([z.number(), z.string()])).optional(),
  price_history: z.array(z.array(z.union([z.number(), z.string()]))).optional(),
});

export const googleFlightsResponseSchema = z.object({
  search_metadata: searchMetadataSchema.optional(),
  best_flights: z.array(flightOptionSchema).optional(),
  other_flights: z.array(flightOptionSchema).optional(),
  price_insights: priceInsightsSchema.optional(),
  error: z.string().optional(),
});

// --- Shared helpers ----------------------------------------------------

const LOCAL_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;

/** Parses SerpApi's "YYYY-MM-DD HH:MM" local-clock string as if it were a
 * UTC instant (see QUALITY_FLAG_NAIVE_LOCAL_TIMESTAMPS above for why this is
 * a deliberate, documented approximation rather than a bug). Returns
 * undefined for anything that doesn't match the documented shape, rather
 * than falling through to the more lenient (and less predictable across JS
 * engines) `Date.parse` on a space-separated, non-ISO string. */
function parseLocalTimeAsUtcMs(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const match = LOCAL_TIME_RE.exec(raw.trim());
  if (!match) return undefined;
  const [, year, month, day, hour, minute] = match;
  const ms = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  return Number.isNaN(ms) ? undefined : ms;
}

function toPrice(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : undefined;
}

const CABIN_BY_TRAVEL_CLASS: Record<string, Cabin> = {
  economy: 'ECONOMY',
  'premium economy': 'PREMIUM_ECONOMY',
  business: 'BUSINESS',
  'business class': 'BUSINESS',
  first: 'FIRST',
  'first class': 'FIRST',
};

/** Maps Google's free-text travel_class ("Economy", "Premium economy", ...)
 * onto the domain Cabin enum, falling back to the query's requested cabin
 * when the string is missing or unrecognized (mirrors how every other
 * provider in this app treats cabin as "what we asked for" in the absence
 * of better data). */
function mapCabin(rawTravelClass: string | undefined, fallback: Cabin): Cabin {
  if (!rawTravelClass) return fallback;
  return CABIN_BY_TRAVEL_CLASS[rawTravelClass.trim().toLowerCase()] ?? fallback;
}

/** Extracts the 2-3 letter IATA carrier code from a Google-style flight
 * number ("DE 2033" -> "DE", "AF1104" -> "AF") — used for
 * validatingCarrier/marketingCarriers/operatingCarriers, which the rest of
 * the app (event/carrier-match detection, db/seed carrier catalog) treats as
 * short codes, not full airline names like SerpApi's separate `airline`
 * field ("Condor", "Lufthansa Group airlines "). */
function carrierCodeFromFlightNumber(flightNumber: string): string {
  const match = /^([A-Za-z]{1,3})\s*\d/.exec(flightNumber.trim());
  return match ? match[1].toUpperCase() : flightNumber.trim();
}

function computeProviderOfferId(parts: Array<string | number>): string {
  const hash = createHash('sha1');
  hash.update(parts.join('|'));
  return `sp_${hash.digest('hex').slice(0, 24)}`;
}

interface BuildOfferParams {
  legs: z.infer<typeof flightLegSchema>[];
  layovers: z.infer<typeof layoverSchema>[];
  totalDurationRaw?: number;
  priceMajor: number;
  query: NormalizedSearchQuery;
  retrievedAt: number;
  googleFlightsUrl?: string;
  departureToken?: string;
  optionIndex: number;
  source: 'best' | 'other';
}

/** Builds one NormalizedOffer from a single best_flights/other_flights
 * entry's already-validated legs. Returns undefined (with a warning pushed
 * onto `warnings`) when the entry can't be turned into a usable offer. */
function buildOffer(
  params: BuildOfferParams,
  warnings: string[]
): NormalizedOffer | undefined {
  const { legs, query, retrievedAt } = params;
  const label = `${params.source}_flights[${params.optionIndex}]`;

  if (legs.length === 0) {
    warnings.push(`${label}: skipped, no flights[] legs present.`);
    return undefined;
  }

  const segments: Segment[] = [];
  // Accumulated independently of the segments' own (possibly cross-timezone,
  // naively-labeled) timestamps — see the comment below on why total elapsed
  // time is summed from each leg's own reliable `duration` plus each
  // layover's own reliable `duration`, never from subtracting one segment's
  // naive UTC-labeled timestamp from another's.
  let accumulatedLegMinutes = 0;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const origin = leg.departure_airport?.id;
    const destination = leg.arrival_airport?.id;
    const departureMs = parseLocalTimeAsUtcMs(leg.departure_airport?.time);

    const missing: string[] = [];
    if (!origin) missing.push('flights[].departure_airport.id');
    if (!destination) missing.push('flights[].arrival_airport.id');
    if (departureMs === undefined) missing.push('flights[].departure_airport.time');
    if (missing.length > 0) {
      warnings.push(`${label}: skipped, leg ${i} missing/unparseable field(s): ${missing.join(', ')}.`);
      return undefined;
    }

    // Prefer the leg's own reported duration to derive arrival (accurate,
    // timezone-independent per Google) over re-parsing arrival_airport.time
    // in its own (different, unknown) local zone — see
    // QUALITY_FLAG_NAIVE_LOCAL_TIMESTAMPS. Only fall back to the raw arrival
    // string, naively parsed the same way as departure, when duration is
    // entirely absent — better than dropping the leg, though the resulting
    // duration may be wrong for a timezone-crossing leg in that fallback
    // case (rare; not observed in any real capture so far).
    let arrivalMs: number;
    let legMinutes: number;
    if (leg.duration !== undefined && leg.duration > 0) {
      legMinutes = leg.duration;
      arrivalMs = (departureMs as number) + legMinutes * 60_000;
    } else {
      const fallbackArrival = parseLocalTimeAsUtcMs(leg.arrival_airport?.time);
      if (fallbackArrival === undefined) {
        warnings.push(`${label}: skipped, leg ${i} has no duration and no parseable arrival time.`);
        return undefined;
      }
      arrivalMs = fallbackArrival;
      legMinutes = Math.max(0, (fallbackArrival - (departureMs as number)) / 60_000);
      warnings.push(
        `${label}: leg ${i} has no reported duration; arrival time and leg duration derived by naively re-parsing arrival_airport.time, which may be inaccurate across timezone changes.`
      );
    }
    accumulatedLegMinutes += legMinutes;

    const flightNumber = leg.flight_number?.trim();
    if (!flightNumber) {
      warnings.push(`${label}: skipped, leg ${i} missing flight_number.`);
      return undefined;
    }

    segments.push({
      operatingFlightNumber: flightNumber,
      marketingFlightNumber: flightNumber,
      origin: origin as string,
      destination: destination as string,
      departureAt: new Date(departureMs as number).toISOString(),
      arrivalAt: new Date(arrivalMs).toISOString(),
      cabin: mapCabin(leg.travel_class, query.cabin),
    });
  }

  const qualityFlags = [QUALITY_FLAG_LIVE_SEARCH_SOURCE, QUALITY_FLAG_NAIVE_LOCAL_TIMESTAMPS];
  if (query.tripType === 'ROUND_TRIP') {
    qualityFlags.push(QUALITY_FLAG_OUTBOUND_ONLY_SEGMENTS);
  }

  const stopCount = params.layovers.length > 0 ? params.layovers.length : Math.max(segments.length - 1, 0);
  // Prefer Google's own total_duration (accurate and timezone-independent).
  // The fallback — accumulated per-leg minutes plus each layover's own
  // reported duration — deliberately never subtracts one segment's naive
  // UTC-labeled timestamp from another's; a departure_airport.time from a
  // different airport than the previous leg's arrival_airport.time carries a
  // DIFFERENT (unknown) real-world offset under this adapter's naive-UTC
  // labeling (see QUALITY_FLAG_NAIVE_LOCAL_TIMESTAMPS), so that cross-leg
  // delta is not a trustworthy duration even though each leg's OWN
  // duration/timestamps are internally consistent.
  const layoverMinutes = params.layovers.reduce((sum, l) => sum + (l.duration ?? 0), 0);
  const durationMinutes = params.totalDurationRaw ?? accumulatedLegMinutes + layoverMinutes;
  const totalPriceMinor = Math.round(params.priceMajor * 100);

  const marketingCarriers = Array.from(new Set(segments.map((s) => carrierCodeFromFlightNumber(s.operatingFlightNumber))));
  const validatingCarrier = marketingCarriers[0] ?? 'UNKNOWN';

  const providerOfferId = computeProviderOfferId([
    query.origin,
    query.destination,
    segments.map((s) => `${s.origin}${s.destination}${s.departureAt}${s.operatingFlightNumber}`).join(','),
    totalPriceMinor,
    params.departureToken ?? '',
    retrievedAt,
  ]);

  const offer: NormalizedOffer = {
    providerId: 'serpapi',
    providerOfferId,
    observedAt: retrievedAt,
    currency: query.currency,
    totalPriceMinor,
    optionalFeesKnown: false,
    validatingCarrier,
    marketingCarriers,
    operatingCarriers: marketingCarriers,
    segments,
    durationMinutes: Math.round(durationMinutes),
    stopCount,
    cabin: segments[0]?.cabin ?? query.cabin,
    outboundUrl: params.googleFlightsUrl,
    qualityFlags,
  };

  return offer;
}

/** Converts a price_history unix-SECONDS timestamp to a UTC calendar-day
 * string (YYYY-MM-DD). Google's price_history points already land on
 * day boundaries (00:00 UTC in every fixture observed), so this is a
 * straightforward slice of the ISO string rather than a timezone
 * negotiation — matches the rest of this adapter's convention of treating
 * every date-only value as UTC (see parseLocalTimeAsUtcMs's module comment
 * for the analogous choice on timestamps). */
function toHistoryDateUtc(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

/**
 * Maps a raw price_insights object onto NormalizedPriceInsights. Returns
 * undefined (with a warning) when the object is absent entirely, or when
 * either of the two fields the contract treats as required —
 * lowest_price and price_level — is missing/unparseable: there's no honest
 * partial value for "the tracked low price" or "is this typical", so rather
 * than fabricate one this drops the whole object, same as buildOffer()
 * above drops a whole offer when a required leg field is missing.
 * typical_price_range and price_history are genuinely optional: a missing
 * or partially-unparseable range yields null low/high (independently), and
 * unparseable individual history points are skipped (not the whole array).
 * Never throws — every failure path is a skip + warning push.
 */
export function mapPriceInsights(
  raw: z.infer<typeof priceInsightsSchema> | undefined,
  warnings: string[]
): NormalizedPriceInsights | undefined {
  if (!raw) return undefined;

  const lowestPrice = toPrice(raw.lowest_price);
  if (lowestPrice === undefined) {
    warnings.push('price_insights: skipped, missing/invalid lowest_price.');
    return undefined;
  }
  if (!raw.price_level) {
    warnings.push('price_insights: skipped, missing price_level.');
    return undefined;
  }

  let typicalLowMinor: number | null = null;
  let typicalHighMinor: number | null = null;
  if (raw.typical_price_range) {
    const [rawLow, rawHigh] = raw.typical_price_range;
    const low = toPrice(rawLow);
    const high = toPrice(rawHigh);
    if (low !== undefined && high !== undefined) {
      typicalLowMinor = Math.round(low * 100);
      typicalHighMinor = Math.round(high * 100);
    } else {
      warnings.push(
        'price_insights: typical_price_range present but not a valid [low, high] numeric pair; typical range omitted.'
      );
    }
  }

  const history: { date: string; priceMinor: number }[] = [];
  (raw.price_history ?? []).forEach((point, index) => {
    const [rawTs, rawPrice] = point;
    const ts = typeof rawTs === 'number' ? rawTs : Number(rawTs);
    const price = toPrice(rawPrice);
    if (!Number.isFinite(ts) || price === undefined) {
      warnings.push(`price_insights: skipped history point ${index}, unparseable [timestamp, price] pair.`);
      return;
    }
    history.push({ date: toHistoryDateUtc(ts), priceMinor: Math.round(price * 100) });
  });

  return {
    lowestPriceMinor: Math.round(lowestPrice * 100),
    priceLevel: raw.price_level,
    typicalLowMinor,
    typicalHighMinor,
    history,
  };
}

/**
 * Maps a raw SerpApi google_flights engine response (best_flights +
 * other_flights) onto NormalizedOffer[]. See the module-level quality-flag
 * doc comments above for the three honesty caveats every offer here carries.
 */
export function mapGoogleFlights(
  json: unknown,
  query: NormalizedSearchQuery,
  retrievedAt: number
): MappingResult {
  const parsed = googleFlightsResponseSchema.safeParse(json);
  if (!parsed.success) {
    return {
      offers: [],
      warnings: [
        `google_flights: response did not match the expected shape (${parsed.error.issues.length} issue(s)); no offers extracted.`,
      ],
    };
  }

  const warnings: string[] = [];
  if (parsed.data.error) {
    warnings.push(`google_flights: SerpApi reported an in-band error: "${parsed.data.error}".`);
  }

  const googleFlightsUrl = parsed.data.search_metadata?.google_flights_url;
  const offers: NormalizedOffer[] = [];

  const sections: { source: 'best' | 'other'; options: z.infer<typeof flightOptionSchema>[] }[] = [
    { source: 'best', options: parsed.data.best_flights ?? [] },
    { source: 'other', options: parsed.data.other_flights ?? [] },
  ];

  for (const section of sections) {
    section.options.forEach((option, index) => {
      const price = toPrice(option.price);
      if (price === undefined || price <= 0) {
        warnings.push(`${section.source}_flights[${index}]: skipped, missing/invalid price.`);
        return;
      }

      const offer = buildOffer(
        {
          legs: option.flights ?? [],
          layovers: option.layovers ?? [],
          totalDurationRaw: option.total_duration,
          priceMajor: price,
          query,
          retrievedAt,
          googleFlightsUrl,
          departureToken: option.departure_token,
          optionIndex: index,
          source: section.source,
        },
        warnings
      );
      if (offer) offers.push(offer);
    });
  }

  if (offers.length === 0) {
    warnings.push('google_flights: 0 offers extracted from response.');
  }

  const priceInsights = mapPriceInsights(parsed.data.price_insights, warnings);

  return { offers, warnings, priceInsights };
}
