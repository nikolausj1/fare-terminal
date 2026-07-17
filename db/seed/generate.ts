// Deterministic synthetic offer generator. Pure functions of (market spec,
// query, run timestamp, "now") — no I/O, no shared mutable state — so the
// same inputs always produce byte-identical NormalizedOffer[] output,
// whether called by the seed script (building history) or by the demo
// provider (building "the current batch" live). See db/seed/markets.ts for
// the market/carrier/airport data and lib/demo-time.ts for how "now" is
// pinned in demos.

import { config } from '@/domain/config';
import type {
  Cabin,
  NormalizedOffer,
  NormalizedSearchQuery,
  Segment,
} from '@/domain/types';

import {
  AIRPORTS_BY_CODE,
  CARRIER_CODES,
  HUB_CODES,
  type AirportSpec,
  type MarketSpec,
  type ScenarioId,
} from './markets';
import { chance, createRng, gaussian, int, pick, seedFrom, type Rng } from './prng';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const CABIN: Cabin = 'ECONOMY';
const FARE_BRANDS = ['Basic', 'Standard', 'Flex'] as const;
type FareBrand = (typeof FARE_BRANDS)[number];

// ---------------------------------------------------------------------------
// Geometry / time helpers
// ---------------------------------------------------------------------------

export function haversineKm(a: AirportSpec, b: AirportSpec): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function toDateStr(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function isoAt(dateStr: string, hour: number, minute: number): string {
  return `${dateStr}T${pad2(hour)}:${pad2(minute)}:00.000Z`;
}

function addMinutesIso(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}

function volatilityFactor(level: MarketSpec['volatility']): number {
  return { LOW: 0.5, MEDIUM: 1, HIGH: 1.8 }[level];
}

function ease(x: number): number {
  const c = clamp(x, 0, 1);
  return c * c * (3 - 2 * c);
}

function roundToNearestDollar(minor: number): number {
  return Math.round(minor / 100) * 100;
}

// ---------------------------------------------------------------------------
// Query builders
// ---------------------------------------------------------------------------

/** Resolve a FLEXIBLE search's concrete departure window as of `asOf` — the
 * window is relative to when the search ran, matching how a real flexible
 * search's window drifts forward day over day. */
export function resolveFlexibleQuery(
  market: Pick<MarketSpec, 'origin' | 'destination'>,
  asOf: number
): NormalizedSearchQuery {
  const start = asOf + config.demoDefaults.flexibleWindowMinDays * DAY_MS;
  const end = asOf + config.demoDefaults.flexibleWindowMaxDays * DAY_MS;
  return {
    origin: market.origin,
    destination: market.destination,
    mode: 'FLEXIBLE',
    departureWindowStart: toDateStr(start),
    departureWindowEnd: toDateStr(end),
    stayMinNights: config.demoDefaults.stayMinNights,
    stayMaxNights: config.demoDefaults.stayMaxNights,
    tripType: 'ROUND_TRIP',
    cabin: CABIN,
    adults: 1,
    maxStops: 1,
    currency: 'USD',
  };
}

/** Resolve an EXACT search's fixed departure/return dates once, relative to
 * `now` at generation time. The same resolved query must be reused for
 * every historical run of that search definition (the dates don't move). */
export function resolveExactQuery(
  market: Pick<MarketSpec, 'origin' | 'destination'>,
  now: number
): NormalizedSearchQuery {
  const depMs = now + 60 * DAY_MS;
  const retMs = depMs + 7 * DAY_MS;
  return {
    origin: market.origin,
    destination: market.destination,
    mode: 'EXACT',
    departureDate: toDateStr(depMs),
    returnDate: toDateStr(retMs),
    tripType: 'ROUND_TRIP',
    cabin: CABIN,
    adults: 1,
    maxStops: 1,
    currency: 'USD',
  };
}

function pickTravelDates(rng: Rng, query: NormalizedSearchQuery): { outDate: string; retDate: string } {
  if (query.mode === 'EXACT') {
    return { outDate: query.departureDate!, retDate: query.returnDate! };
  }
  const start = new Date(`${query.departureWindowStart}T00:00:00.000Z`).getTime();
  const end = new Date(`${query.departureWindowEnd}T00:00:00.000Z`).getTime();
  const totalDays = Math.max(1, Math.round((end - start) / DAY_MS));
  const outMs = start + int(rng, 0, totalDays) * DAY_MS;
  const stayNights = int(rng, query.stayMinNights ?? 5, query.stayMaxNights ?? 9);
  const retMs = outMs + stayNights * DAY_MS;
  return { outDate: toDateStr(outMs), retDate: toDateStr(retMs) };
}

// ---------------------------------------------------------------------------
// Scenario shock model
// ---------------------------------------------------------------------------

interface ScenarioShock {
  /** Multiplicative shock applied on top of the smooth base curve. */
  priceMult: number;
  /** Additive bump to the per-run offer count (can be negative). */
  offerCountBonus: number;
  /** Multiplier on the per-offer noise standard deviation. */
  noiseSdMultiplier: number;
  /** Whether the "Basic" fare brand may appear in this run. */
  allowBasicFareBrand: boolean;
  /** Additive bump to per-offer seatsRemaining. */
  seatsBoost: number;
  /** Force-inject a single anomalously cheap offer into this run. */
  forceAnomaly: boolean;
  /** Per-carrier multiplicative discount (competitive-match scenario). */
  carrierOverrides: Map<string, number>;
}

/** Event-window length (hours) used both for the shock ramp and for how far
 * back to sample intraday runs — null means "no dedicated event window"
 * (STABLE / SHORT_HISTORY / ANOMALY_OFFER, which are instantaneous or
 * volume-based rather than windowed). */
export function intradayWindowHours(scenario: ScenarioId): number | null {
  switch (scenario) {
    case 'SHARP_DROP_SURGE':
      return 48;
    case 'CARRIER_MATCH':
      return 72;
    case 'FARE_BRAND_VANISH':
      return 120;
    case 'INVENTORY_UP':
      return 240;
    case 'VOLATILITY_SPIKE':
      return 336;
    case 'NEW_LOW':
      return 40;
    case 'STALE_OUTAGE':
      return 72;
    default:
      return null;
  }
}

function scenarioShock(market: MarketSpec, t: number, now: number): ScenarioShock {
  const hoursAgo = (now - t) / HOUR_MS;
  const daysAgo = hoursAgo / 24;
  const shock: ScenarioShock = {
    priceMult: 1,
    offerCountBonus: 0,
    noiseSdMultiplier: 1,
    allowBasicFareBrand: true,
    seatsBoost: 0,
    forceAnomaly: false,
    carrierOverrides: new Map(),
  };

  switch (market.scenario) {
    case 'SHARP_DROP_SURGE': {
      const windowH = 48;
      const frac = hoursAgo <= windowH ? ease(1 - hoursAgo / windowH) : 0;
      shock.priceMult = 1 - 0.22 * frac;
      shock.offerCountBonus = Math.round(14 * frac);
      break;
    }
    case 'CARRIER_MATCH': {
      const aStartH = 70;
      const bStartH = 64; // 6h after A — inside config.eventThresholds.carrierMatchWindowHours
      const [carrierA, carrierB] = market.carriers;
      if (carrierA) shock.carrierOverrides.set(carrierA, hoursAgo <= aStartH ? 0.9 : 1);
      if (carrierB) shock.carrierOverrides.set(carrierB, hoursAgo <= bStartH ? 0.9 : 1);
      break;
    }
    case 'FARE_BRAND_VANISH': {
      shock.allowBasicFareBrand = daysAgo > 5;
      break;
    }
    case 'INVENTORY_UP': {
      const windowH = 240;
      const frac = hoursAgo <= windowH ? ease(1 - hoursAgo / windowH) : 0;
      shock.seatsBoost = Math.round(16 * frac);
      shock.priceMult = 1 + 0.025 * frac;
      break;
    }
    case 'VOLATILITY_SPIKE': {
      const windowH = 336;
      const frac = hoursAgo <= windowH ? ease(1 - hoursAgo / windowH) : 0;
      shock.noiseSdMultiplier = 1 + 4.5 * frac;
      break;
    }
    case 'NEW_LOW': {
      const windowH = 36;
      const frac = hoursAgo <= windowH ? ease(1 - hoursAgo / windowH) : 0;
      shock.priceMult = 1 - 0.16 * frac;
      if (t === now) {
        // The ease() ramp saturates well before hoursAgo=0, so nearby runs
        // would otherwise be statistically tied with the "now" run once
        // per-offer/run noise is added. Add a further deterministic step
        // right at "now" so the final run is unambiguously the new low.
        shock.priceMult *= 0.9;
      }
      break;
    }
    case 'ANOMALY_OFFER': {
      shock.forceAnomaly = t === now;
      break;
    }
    default:
      break;
  }

  return shock;
}

function baseCurveMultiplier(market: MarketSpec, t: number, now: number, rng: Rng): number {
  const seasonalPeriodDays = 45 + (market.seed % 30);
  const seasonalPhase = (market.seed % 360) * (Math.PI / 180);
  const seasonal =
    1 + 0.035 * Math.sin((t / (DAY_MS * seasonalPeriodDays)) * 2 * Math.PI + seasonalPhase);

  // NEW_LOW markets get a gentle downtrend that bottoms out exactly at
  // "now", on top of the sharper end-window shock in scenarioShock() — this
  // makes the final run reliably the global historical minimum.
  const daysAgo = (now - t) / DAY_MS;
  const longTrend =
    market.scenario === 'NEW_LOW' ? -0.1 * (1 - Math.min(daysAgo, 120) / 120) : 0;

  const noiseSd = 0.018 * volatilityFactor(market.volatility);
  const noise = gaussian(rng, 0, noiseSd);
  return seasonal * (1 + longTrend) * (1 + noise);
}

// ---------------------------------------------------------------------------
// Itinerary construction
// ---------------------------------------------------------------------------

function flightNumber(rng: Rng, carrierCode: string): string {
  return `${carrierCode}${int(rng, 100, 3999)}`;
}

function flightMinutes(rng: Rng, distanceKm: number): number {
  return Math.round((distanceKm / 830) * 60) + int(rng, 25, 45);
}

function pickHub(rng: Rng, excludeA: string, excludeB: string): string {
  const candidates = HUB_CODES.filter((h) => h !== excludeA && h !== excludeB);
  return pick(rng, candidates.length > 0 ? candidates : HUB_CODES);
}

function buildLeg(
  rng: Rng,
  carrierCode: string,
  fromCode: string,
  toCode: string,
  dateStr: string,
  stop: boolean
): Segment[] {
  const fromAp = AIRPORTS_BY_CODE.get(fromCode);
  const toAp = AIRPORTS_BY_CODE.get(toCode);
  if (!fromAp || !toAp) {
    throw new Error(`Unknown airport in generated leg: ${fromCode} -> ${toCode}`);
  }
  const departHour = int(rng, 5, 22);
  const departMinute = pick(rng, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  const dep1 = isoAt(dateStr, departHour, departMinute);

  if (!stop) {
    const durMin = flightMinutes(rng, haversineKm(fromAp, toAp));
    return [
      {
        operatingFlightNumber: flightNumber(rng, carrierCode),
        origin: fromCode,
        destination: toCode,
        departureAt: dep1,
        arrivalAt: addMinutesIso(dep1, durMin),
        cabin: CABIN,
      },
    ];
  }

  const hubCode = pickHub(rng, fromCode, toCode);
  const hubAp = AIRPORTS_BY_CODE.get(hubCode)!;
  const leg1Min = flightMinutes(rng, haversineKm(fromAp, hubAp));
  const arr1 = addMinutesIso(dep1, leg1Min);
  const layoverMin = int(rng, 45, 180);
  const dep2 = addMinutesIso(arr1, layoverMin);
  const leg2Min = flightMinutes(rng, haversineKm(hubAp, toAp));
  const arr2 = addMinutesIso(dep2, leg2Min);
  return [
    {
      operatingFlightNumber: flightNumber(rng, carrierCode),
      origin: fromCode,
      destination: hubCode,
      departureAt: dep1,
      arrivalAt: arr1,
      cabin: CABIN,
    },
    {
      operatingFlightNumber: flightNumber(rng, carrierCode),
      origin: hubCode,
      destination: toCode,
      departureAt: dep2,
      arrivalAt: arr2,
      cabin: CABIN,
    },
  ];
}

function outboundDurationMinutes(segments: Segment[], stopCount: number): number {
  const outbound = segments.slice(0, stopCount + 1);
  const start = new Date(outbound[0].departureAt).getTime();
  const end = new Date(outbound[outbound.length - 1].arrivalAt).getTime();
  return Math.round((end - start) / 60_000);
}

// ---------------------------------------------------------------------------
// Offer batch generation
// ---------------------------------------------------------------------------

function buildOffer(
  rng: Rng,
  market: MarketSpec,
  query: NormalizedSearchQuery,
  runAt: number,
  runLevelMultiplier: number,
  shock: ScenarioShock,
  index: number
): NormalizedOffer {
  const carrierCode = pick(rng, market.carriers);
  const carrierIndex = market.carriers.indexOf(carrierCode);
  const stop = market.carriers.length > 0 && chance(rng, 0.45); // ~45% one-stop, rest nonstop (maxStops=1)

  const { outDate, retDate } = pickTravelDates(rng, query);
  const outboundSegs = buildLeg(rng, carrierCode, query.origin, query.destination, outDate, stop);
  const inboundSegs = buildLeg(rng, carrierCode, query.destination, query.origin, retDate, stop);
  const segments = [...outboundSegs, ...inboundSegs];
  const stopCount = outboundSegs.length - 1;
  const durationMinutes = outboundDurationMinutes(segments, stopCount);

  const stopFactor = stopCount === 0 ? 1.08 : 0.92;
  const carrierBias =
    1 + (carrierIndex - (market.carriers.length - 1) / 2) * 0.015;
  const carrierOverride = shock.carrierOverrides.get(carrierCode) ?? 1;

  let fareBrand: FareBrand | undefined;
  let brandFactor = 1;
  if (chance(rng, 0.3)) {
    const allowed = shock.allowBasicFareBrand
      ? FARE_BRANDS
      : FARE_BRANDS.filter((b) => b !== 'Basic');
    fareBrand = pick(rng, allowed);
    brandFactor = { Basic: 0.88, Standard: 1, Flex: 1.15 }[fareBrand];
  }

  const noiseSd = 0.05 * volatilityFactor(market.volatility) * shock.noiseSdMultiplier;
  const offerNoise = 1 + gaussian(rng, 0, noiseSd);

  const priceMinor = roundToNearestDollar(
    Math.max(
      2000,
      market.basePriceMinor *
        runLevelMultiplier *
        stopFactor *
        carrierBias *
        carrierOverride *
        brandFactor *
        offerNoise
    )
  );

  const basePriceMinor = Math.round(priceMinor * 0.78);
  const taxesMinor = priceMinor - basePriceMinor;

  const bookingClasses = fareBrand
    ? { Basic: ['Q', 'L'], Standard: ['Y', 'B'], Flex: ['Y', 'J'] }[fareBrand]
    : undefined;

  const seatsRemaining = chance(rng, 0.4)
    ? clamp(int(rng, 1, 9) + shock.seatsBoost, 1, 30)
    : undefined;

  return {
    providerId: 'demo',
    providerOfferId: `demo-${market.id}-${runAt}-${index}-${carrierCode}`,
    observedAt: runAt,
    currency: 'USD',
    totalPriceMinor: priceMinor,
    basePriceMinor,
    taxesMinor,
    optionalFeesKnown: chance(rng, 0.85),
    validatingCarrier: carrierCode,
    marketingCarriers: [carrierCode],
    operatingCarriers: [carrierCode],
    segments,
    durationMinutes,
    stopCount,
    cabin: CABIN,
    fareBrand,
    bookingClasses,
    seatsRemaining,
    qualityFlags: [],
  };
}

/** Generate the full set of NormalizedOffer for a single search run. Pure
 * and deterministic given (market, query, runAt, now) — the same inputs
 * always produce byte-identical output. */
export function generateOfferBatch(
  market: MarketSpec,
  query: NormalizedSearchQuery,
  runAt: number,
  now: number
): NormalizedOffer[] {
  const runRng = createRng(seedFrom(market.seed, runAt, 'level'));
  const shock = scenarioShock(market, runAt, now);
  const runLevelMultiplier = baseCurveMultiplier(market, runAt, now, runRng) * shock.priceMult;

  const offerRng = createRng(seedFrom(market.seed, runAt, query.mode, query.origin, query.destination));
  const baseCount = clamp(int(offerRng, 12, 35) + shock.offerCountBonus, 12, 45);

  const offers: NormalizedOffer[] = [];
  for (let i = 0; i < baseCount; i++) {
    offers.push(buildOffer(offerRng, market, query, runAt, runLevelMultiplier, shock, i));
  }

  if (shock.forceAnomaly && offers.length > 0) {
    const sorted = [...offers].sort((a, b) => a.totalPriceMinor - b.totalPriceMinor);
    const median = sorted[Math.floor(sorted.length / 2)].totalPriceMinor;
    const template = offers[0];
    const anomalyPrice = Math.max(1000, roundToNearestDollar(median * 0.6));
    const anomalyBase = Math.round(anomalyPrice * 0.78);
    offers.push({
      ...template,
      providerOfferId: `${template.providerOfferId}-anomaly`,
      totalPriceMinor: anomalyPrice,
      basePriceMinor: anomalyBase,
      taxesMinor: anomalyPrice - anomalyBase,
      qualityFlags: [],
    });
  }

  return offers;
}

// ---------------------------------------------------------------------------
// Run scheduling
// ---------------------------------------------------------------------------

/** Historical search-run timestamps for a market: one per day for the
 * backfill window, 3-hourly for the last 3 days, dense intraday sampling
 * across the scenario's event window (>= 30 runs for windowed scenarios),
 * and (except for the outage scenario) a final run at exactly `now`. */
export function computeRunTimestamps(market: MarketSpec, now: number): number[] {
  const timestamps = new Set<number>();
  const backfillDays = market.scenario === 'SHORT_HISTORY' ? 6 : 120;
  const dailyHourUtc = 9 + (market.seed % 5); // 9-13 UTC, fixed per market

  for (let d = backfillDays; d >= 0; d--) {
    const dayStart = Math.floor((now - d * DAY_MS) / DAY_MS) * DAY_MS;
    let t = dayStart + dailyHourUtc * HOUR_MS;
    if (t > now) t -= DAY_MS;
    timestamps.add(t);
  }

  for (let h = 0; h <= 72; h += 3) {
    timestamps.add(now - h * HOUR_MS);
  }

  const windowH = intradayWindowHours(market.scenario);
  if (windowH) {
    const step = Math.max(1, Math.floor(windowH / 45));
    for (let h = 0; h <= windowH; h += step) {
      timestamps.add(now - h * HOUR_MS);
    }
  }

  if (market.scenario !== 'STALE_OUTAGE') {
    timestamps.add(now);
  }

  let result = [...timestamps].filter((t) => t <= now);

  if (market.scenario === 'STALE_OUTAGE') {
    const cutoff = now - 10 * HOUR_MS;
    result = result.filter((t) => t <= cutoff);
  }

  if (market.scenario === 'SHORT_HISTORY') {
    const floor = now - 6 * DAY_MS;
    result = result.filter((t) => t >= floor);
  }

  return result.sort((a, b) => a - b);
}

export interface GeneratedRun {
  runAt: number;
  query: NormalizedSearchQuery;
  offers: NormalizedOffer[];
}

/** Build the full deterministic offer-observation history for one search
 * definition (FLEXIBLE window resolved fresh per run, or a fixed EXACT
 * query supplied by the caller once). */
export function generateMarketHistory(
  market: MarketSpec,
  now: number,
  options?: { exactQuery?: NormalizedSearchQuery }
): GeneratedRun[] {
  const timestamps = computeRunTimestamps(market, now);
  return timestamps.map((runAt) => {
    const query = options?.exactQuery ?? resolveFlexibleQuery(market, runAt);
    return { runAt, query, offers: generateOfferBatch(market, query, runAt, now) };
  });
}

// ---------------------------------------------------------------------------
// Generic (non-seeded) market derivation, used by the demo provider when a
// queried route doesn't match one of the curated MARKETS.
// ---------------------------------------------------------------------------

export function deriveGenericMarket(origin: string, destination: string): MarketSpec {
  const seed = seedFrom('generic', origin, destination);
  const rng = createRng(seed);
  const originAp = AIRPORTS_BY_CODE.get(origin);
  const destAp = AIRPORTS_BY_CODE.get(destination);
  const distanceKm = originAp && destAp ? haversineKm(originAp, destAp) : 3000;
  const basePriceMinor = roundToNearestDollar(8000 + distanceKm * 9);
  const carrierCount = int(rng, 3, 4);
  const carriers: string[] = [];
  const pool = [...CARRIER_CODES];
  for (let i = 0; i < carrierCount && pool.length > 0; i++) {
    const idx = Math.floor(rng() * pool.length);
    carriers.push(pool[idx]);
    pool.splice(idx, 1);
  }

  return {
    id: `${origin}-${destination}-generic`,
    origin,
    destination,
    basePriceMinor,
    volatility: 'MEDIUM',
    carriers,
    scenario: 'STABLE',
    scenarioLabel: 'Generic derived market (not one of the curated 12)',
    seed,
  };
}

// ---------------------------------------------------------------------------
// DB-layer helper (fingerprint is derived, not part of NormalizedOffer)
// ---------------------------------------------------------------------------

export function itineraryFingerprint(offer: NormalizedOffer): string {
  const legs = offer.segments
    .map((s) => `${s.operatingFlightNumber}:${s.origin}${s.destination}:${s.departureAt}`)
    .join(',');
  return `${offer.validatingCarrier}|${offer.stopCount}|${legs}`;
}
