// Core domain contracts. All cross-module data must pass through these types —
// see docs/ARCHITECTURE.md for the module map and data-flow rules.

export type Cabin = 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';

export type TripType = 'ROUND_TRIP' | 'ONE_WAY';

export type SearchMode = 'FLEXIBLE' | 'EXACT';

export type RecommendationLabel =
  | 'BUY'
  | 'LEAN_BUY'
  | 'NEUTRAL'
  | 'WAIT'
  | 'INSUFFICIENT_DATA';

export type ConfidenceLevel = 'LOW' | 'MODERATE' | 'HIGH';

export type EventType =
  | 'PRICE_DROP'
  | 'PRICE_INCREASE'
  | 'NEW_HISTORICAL_LOW'
  | 'VOLATILITY_SPIKE'
  | 'OFFER_COUNT_SURGE'
  | 'OFFER_COUNT_CONTRACTION'
  | 'LOW_FARE_SET_CHANGED'
  | 'CARRIER_ENTERED_LOW_SET'
  | 'CARRIER_LEFT_LOW_SET'
  | 'POSSIBLE_CARRIER_MATCH'
  | 'FARE_PRODUCT_APPEARED'
  | 'FARE_PRODUCT_DISAPPEARED'
  | 'DATA_ANOMALY';

export interface NormalizedSearchQuery {
  origin: string;
  destination: string;
  mode: SearchMode;
  departureDate?: string;
  returnDate?: string;
  departureWindowStart?: string;
  departureWindowEnd?: string;
  stayMinNights?: number;
  stayMaxNights?: number;
  tripType: TripType;
  cabin: Cabin;
  adults: number;
  maxStops: number;
  currency: string;
}

export interface Segment {
  operatingFlightNumber: string;
  marketingFlightNumber?: string;
  origin: string;
  destination: string;
  departureAt: string;
  arrivalAt: string;
  cabin: Cabin;
}

export interface NormalizedOffer {
  providerId: string;
  providerOfferId: string;
  observedAt: number;
  expiresAt?: number;
  currency: string;
  totalPriceMinor: number;
  basePriceMinor?: number;
  taxesMinor?: number;
  optionalFeesKnown: boolean;
  validatingCarrier: string;
  marketingCarriers: string[];
  operatingCarriers: string[];
  segments: Segment[];
  durationMinutes: number;
  stopCount: number;
  cabin: Cabin;
  fareBrand?: string;
  bookingClasses?: string[];
  seatsRemaining?: number;
  outboundUrl?: string;
  qualityFlags: string[];
}

export interface NormalizedOfferBatch {
  providerId: string;
  query: NormalizedSearchQuery;
  retrievedAt: number;
  offers: NormalizedOffer[];
  warnings: string[];
}

// Mirrors the numeric fields of the market_snapshots table, camelCase.
export interface SnapshotMetrics {
  benchmarkPriceMinor: number;
  fromPriceMinor: number;
  medianPriceMinor: number;
  p25PriceMinor: number;
  validOfferCount: number;
  uniqueItineraryCount: number;
  carrierCount: number;
  nonstopOfferCount: number;
  oneStopOfferCount: number;
  freshnessSeconds: number;
  dataQualityScore: number;
}

export interface RecommendationOutput {
  label: RecommendationLabel;
  confidence: ConfidenceLevel;
  score: number;
  summary: string;
  observedFacts: string[];
  inferences: { text: string; confidence: ConfidenceLevel }[];
  counterEvidence: string[];
  limitations: string[];
  methodologyVersion: string;
}

// Camelcase mirror of the market_events row, plus derived fields used by
// the events/analyst modules.
export interface MarketEvent {
  id: number;
  searchDefinitionId: number;
  eventType: EventType;
  eventStartAt: number;
  eventEndAt?: number;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  confidence: ConfidenceLevel;
  observedFacts: string[];
  inference?: { text: string; confidence: ConfidenceLevel };
  supportingRecordIds: number[];
  detectionRuleVersion: string;
  createdAt: number;
}

export interface ProviderHealth {
  providerId: string;
  status: 'OK' | 'DEGRADED' | 'DOWN';
  latencyMs?: number;
  details?: string;
}

// Note: FlightDataProvider lives in lib/providers/types.ts (it is a
// provider-layer contract, not a plain data shape), but it is built
// entirely from the types above.
