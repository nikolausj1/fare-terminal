// Deterministic demo dataset spec: fictional-carrier / real-airport markets
// covering the scenario catalogue in PRD §33.2. This file is pure data (no
// randomness, no I/O) so it can be imported by the generator, the demo
// provider, the seed script, and tests without side effects.

export interface AirportSpec {
  iataCode: string;
  icaoCode?: string;
  name: string;
  cityName: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

export interface CarrierSpec {
  code: string;
  name: string;
}

/** Fictional carriers only — never a real airline code/name. */
export const CARRIERS: readonly CarrierSpec[] = [
  { code: 'VA', name: 'Vantage Air' },
  { code: 'NB', name: 'Nimbus' },
  { code: 'CS', name: 'Crosswind' },
  { code: 'PF', name: 'Pacific Fern' },
  { code: 'AL', name: 'Alpenlicht' },
  { code: 'TB', name: 'Turbina' },
] as const;

export const CARRIER_CODES: readonly string[] = CARRIERS.map((c) => c.code);

// Real airport codes (approximate, publicly known coordinates/tz — fine for
// synthetic demo data; not used for anything safety- or nav-critical).
export const AIRPORTS: readonly AirportSpec[] = [
  { iataCode: 'SEA', icaoCode: 'KSEA', name: 'Seattle-Tacoma Intl', cityName: 'Seattle', countryCode: 'US', latitude: 47.4502, longitude: -122.3088, timezone: 'America/Los_Angeles' },
  { iataCode: 'FCO', icaoCode: 'LIRF', name: 'Rome Fiumicino', cityName: 'Rome', countryCode: 'IT', latitude: 41.8003, longitude: 12.2389, timezone: 'Europe/Rome' },
  { iataCode: 'JFK', icaoCode: 'KJFK', name: 'John F. Kennedy Intl', cityName: 'New York', countryCode: 'US', latitude: 40.6413, longitude: -73.7781, timezone: 'America/New_York' },
  { iataCode: 'LHR', icaoCode: 'EGLL', name: 'London Heathrow', cityName: 'London', countryCode: 'GB', latitude: 51.4700, longitude: -0.4543, timezone: 'Europe/London' },
  { iataCode: 'LAX', icaoCode: 'KLAX', name: 'Los Angeles Intl', cityName: 'Los Angeles', countryCode: 'US', latitude: 33.9416, longitude: -118.4085, timezone: 'America/Los_Angeles' },
  { iataCode: 'HND', icaoCode: 'RJTT', name: 'Tokyo Haneda', cityName: 'Tokyo', countryCode: 'JP', latitude: 35.5494, longitude: 139.7798, timezone: 'Asia/Tokyo' },
  { iataCode: 'ORD', icaoCode: 'KORD', name: "Chicago O'Hare Intl", cityName: 'Chicago', countryCode: 'US', latitude: 41.9742, longitude: -87.9073, timezone: 'America/Chicago' },
  { iataCode: 'CDG', icaoCode: 'LFPG', name: 'Paris Charles de Gaulle', cityName: 'Paris', countryCode: 'FR', latitude: 49.0097, longitude: 2.5479, timezone: 'Europe/Paris' },
  { iataCode: 'MSP', icaoCode: 'KMSP', name: 'Minneapolis-Saint Paul Intl', cityName: 'Minneapolis', countryCode: 'US', latitude: 44.8848, longitude: -93.2223, timezone: 'America/Chicago' },
  { iataCode: 'CUN', icaoCode: 'MMUN', name: 'Cancun Intl', cityName: 'Cancun', countryCode: 'MX', latitude: 21.0365, longitude: -86.8771, timezone: 'America/Cancun' },
  { iataCode: 'DEN', icaoCode: 'KDEN', name: 'Denver Intl', cityName: 'Denver', countryCode: 'US', latitude: 39.8561, longitude: -104.6737, timezone: 'America/Denver' },
  { iataCode: 'KEF', icaoCode: 'BIKF', name: 'Keflavik Intl', cityName: 'Reykjavik', countryCode: 'IS', latitude: 63.9850, longitude: -22.6056, timezone: 'Atlantic/Reykjavik' },
  { iataCode: 'SFO', icaoCode: 'KSFO', name: 'San Francisco Intl', cityName: 'San Francisco', countryCode: 'US', latitude: 37.6213, longitude: -122.3790, timezone: 'America/Los_Angeles' },
  { iataCode: 'BCN', icaoCode: 'LEBL', name: 'Barcelona-El Prat', cityName: 'Barcelona', countryCode: 'ES', latitude: 41.2971, longitude: 2.0785, timezone: 'Europe/Madrid' },
  { iataCode: 'ATL', icaoCode: 'KATL', name: 'Hartsfield-Jackson Atlanta Intl', cityName: 'Atlanta', countryCode: 'US', latitude: 33.6407, longitude: -84.4277, timezone: 'America/New_York' },
  { iataCode: 'LIS', icaoCode: 'LPPT', name: 'Lisbon Humberto Delgado', cityName: 'Lisbon', countryCode: 'PT', latitude: 38.7813, longitude: -9.1359, timezone: 'Europe/Lisbon' },
  { iataCode: 'BOS', icaoCode: 'KBOS', name: 'Boston Logan Intl', cityName: 'Boston', countryCode: 'US', latitude: 42.3656, longitude: -71.0096, timezone: 'America/New_York' },
  { iataCode: 'DUB', icaoCode: 'EIDW', name: 'Dublin Airport', cityName: 'Dublin', countryCode: 'IE', latitude: 53.4213, longitude: -6.2701, timezone: 'Europe/Dublin' },
  { iataCode: 'AUS', icaoCode: 'KAUS', name: 'Austin-Bergstrom Intl', cityName: 'Austin', countryCode: 'US', latitude: 30.1975, longitude: -97.6664, timezone: 'America/Chicago' },
  { iataCode: 'MEX', icaoCode: 'MMMX', name: 'Mexico City Intl', cityName: 'Mexico City', countryCode: 'MX', latitude: 19.4363, longitude: -99.0721, timezone: 'America/Mexico_City' },
  { iataCode: 'PDX', icaoCode: 'KPDX', name: 'Portland Intl', cityName: 'Portland', countryCode: 'US', latitude: 45.5898, longitude: -122.5951, timezone: 'America/Los_Angeles' },
  { iataCode: 'YVR', icaoCode: 'CYVR', name: 'Vancouver Intl', cityName: 'Vancouver', countryCode: 'CA', latitude: 49.1947, longitude: -123.1792, timezone: 'America/Vancouver' },
];

export const AIRPORTS_BY_CODE: ReadonlyMap<string, AirportSpec> = new Map(
  AIRPORTS.map((a) => [a.iataCode, a])
);

/** Hub airports usable as a plausible connection point for 1-stop
 * itineraries (kept distinct from any given origin/destination pair). */
export const HUB_CODES: readonly string[] = ['ORD', 'JFK', 'LHR', 'CDG', 'DEN', 'ATL'];

export type ScenarioId =
  | 'STABLE'
  | 'SHARP_DROP_SURGE'
  | 'CARRIER_MATCH'
  | 'FARE_BRAND_VANISH'
  | 'INVENTORY_UP'
  | 'VOLATILITY_SPIKE'
  | 'NEW_LOW'
  | 'STALE_OUTAGE'
  | 'SHORT_HISTORY'
  | 'ANOMALY_OFFER';

export type VolatilityLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface MarketSpec {
  /** Stable slug base, e.g. "sea-fco". */
  id: string;
  origin: string;
  destination: string;
  /** Base price level in minor units (cents) for a nonstop economy fare at
   * "fair value", before scenario shocks / seasonal drift / noise. */
  basePriceMinor: number;
  volatility: VolatilityLevel;
  /** 3-5 of the 6 fictional carrier codes serving this market. */
  carriers: readonly string[];
  scenario: ScenarioId;
  /** Human-readable summary of what the scenario demonstrates, used in
   * seed logging only. */
  scenarioLabel: string;
  /** Deterministic per-market seed root (any stable 32-bit-ish integer). */
  seed: number;
  /** Also create an EXACT-date search_definitions row for this market, in
   * addition to the standard FLEXIBLE one. */
  includeExactDefinition?: boolean;
}

export const MARKETS: readonly MarketSpec[] = [
  {
    id: 'sea-fco',
    origin: 'SEA',
    destination: 'FCO',
    basePriceMinor: 82000,
    volatility: 'LOW',
    carriers: ['VA', 'NB', 'CS'],
    scenario: 'STABLE',
    scenarioLabel: 'Stable, trading near fair value',
    seed: 1001,
    includeExactDefinition: true,
  },
  {
    id: 'jfk-lhr',
    origin: 'JFK',
    destination: 'LHR',
    basePriceMinor: 61000,
    volatility: 'MEDIUM',
    carriers: ['VA', 'AL', 'TB', 'CS'],
    scenario: 'SHARP_DROP_SURGE',
    scenarioLabel: 'Sharp price drop + offer-count surge in the last 48h',
    seed: 1002,
  },
  {
    id: 'lax-hnd',
    origin: 'LAX',
    destination: 'HND',
    basePriceMinor: 98000,
    volatility: 'MEDIUM',
    carriers: ['PF', 'NB', 'AL'],
    scenario: 'CARRIER_MATCH',
    scenarioLabel: 'Possible competitive match: two carriers drop within hours, last 72h',
    seed: 1003,
  },
  {
    id: 'ord-cdg',
    origin: 'ORD',
    destination: 'CDG',
    basePriceMinor: 71000,
    volatility: 'MEDIUM',
    carriers: ['VA', 'CS', 'TB'],
    scenario: 'FARE_BRAND_VANISH',
    scenarioLabel: 'Lowest fare product ("Basic") disappears from recent observations',
    seed: 1004,
  },
  {
    id: 'msp-cun',
    origin: 'MSP',
    destination: 'CUN',
    basePriceMinor: 41000,
    volatility: 'LOW',
    carriers: ['NB', 'PF', 'CS', 'AL'],
    scenario: 'INVENTORY_UP',
    scenarioLabel: 'Inventory (seatsRemaining) rises with only a modest price response',
    seed: 1005,
  },
  {
    id: 'den-kef',
    origin: 'DEN',
    destination: 'KEF',
    basePriceMinor: 57000,
    volatility: 'HIGH',
    carriers: ['AL', 'TB', 'VA'],
    scenario: 'VOLATILITY_SPIKE',
    scenarioLabel: 'Volatility spike in the last 14 days',
    seed: 1006,
  },
  {
    id: 'sfo-bcn',
    origin: 'SFO',
    destination: 'BCN',
    basePriceMinor: 68000,
    volatility: 'MEDIUM',
    carriers: ['VA', 'PF', 'NB'],
    scenario: 'NEW_LOW',
    scenarioLabel: 'Current benchmark is a new historical low',
    seed: 1007,
    includeExactDefinition: true,
  },
  {
    id: 'atl-lis',
    origin: 'ATL',
    destination: 'LIS',
    basePriceMinor: 53000,
    volatility: 'MEDIUM',
    carriers: ['CS', 'AL', 'TB'],
    scenario: 'STALE_OUTAGE',
    scenarioLabel: 'Stale data / provider outage: no observations in the last ~10h',
    seed: 1008,
  },
  {
    id: 'bos-dub',
    origin: 'BOS',
    destination: 'DUB',
    basePriceMinor: 45000,
    volatility: 'LOW',
    carriers: ['VA', 'NB', 'PF'],
    scenario: 'SHORT_HISTORY',
    scenarioLabel: 'Too little history: only ~6 days of observations',
    seed: 1009,
  },
  {
    id: 'aus-mex',
    origin: 'AUS',
    destination: 'MEX',
    basePriceMinor: 28000,
    volatility: 'LOW',
    carriers: ['NB', 'CS', 'PF'],
    scenario: 'ANOMALY_OFFER',
    scenarioLabel: 'Single anomalous cheap offer (~40% below batch median) in the latest batch',
    seed: 1010,
  },
  {
    id: 'pdx-yvr',
    origin: 'PDX',
    destination: 'YVR',
    basePriceMinor: 21000,
    volatility: 'LOW',
    carriers: ['TB', 'AL'],
    scenario: 'STABLE',
    scenarioLabel: 'Stable variant #2: short-haul, low price level, thin carrier mix',
    seed: 1011,
  },
  {
    id: 'den-atl',
    origin: 'DEN',
    destination: 'ATL',
    basePriceMinor: 33000,
    volatility: 'MEDIUM',
    carriers: ['VA', 'NB', 'CS', 'TB', 'AL'],
    scenario: 'STABLE',
    scenarioLabel: 'Stable variant #3: domestic, higher price level, full carrier mix',
    seed: 1012,
  },
];

export const MARKETS_BY_ID: ReadonlyMap<string, MarketSpec> = new Map(
  MARKETS.map((m) => [m.id, m])
);

/** Look up (or synthesize) a market spec for an arbitrary origin/destination
 * pair, used by the demo provider when the queried route isn't one of the
 * seeded markets. */
export function findMarketByRoute(origin: string, destination: string): MarketSpec | undefined {
  return MARKETS.find(
    (m) =>
      (m.origin === origin && m.destination === destination) ||
      (m.origin === destination && m.destination === origin)
  );
}
