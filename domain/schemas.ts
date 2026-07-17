// Zod schemas mirroring the core types in domain/types.ts. Use these for
// runtime validation at module boundaries (provider responses, API input/
// output, job payloads).

import { z } from 'zod';

export const cabinSchema = z.enum([
  'ECONOMY',
  'PREMIUM_ECONOMY',
  'BUSINESS',
  'FIRST',
]);

export const tripTypeSchema = z.enum(['ROUND_TRIP', 'ONE_WAY']);

export const searchModeSchema = z.enum(['FLEXIBLE', 'EXACT']);

export const recommendationLabelSchema = z.enum([
  'BUY',
  'LEAN_BUY',
  'NEUTRAL',
  'WAIT',
  'INSUFFICIENT_DATA',
]);

export const confidenceLevelSchema = z.enum(['LOW', 'MODERATE', 'HIGH']);

export const eventTypeSchema = z.enum([
  'PRICE_DROP',
  'PRICE_INCREASE',
  'NEW_HISTORICAL_LOW',
  'VOLATILITY_SPIKE',
  'OFFER_COUNT_SURGE',
  'OFFER_COUNT_CONTRACTION',
  'LOW_FARE_SET_CHANGED',
  'CARRIER_ENTERED_LOW_SET',
  'CARRIER_LEFT_LOW_SET',
  'POSSIBLE_CARRIER_MATCH',
  'FARE_PRODUCT_APPEARED',
  'FARE_PRODUCT_DISAPPEARED',
  'DATA_ANOMALY',
]);

export const normalizedSearchQuerySchema = z.object({
  origin: z.string(),
  destination: z.string(),
  mode: searchModeSchema,
  departureDate: z.string().optional(),
  returnDate: z.string().optional(),
  departureWindowStart: z.string().optional(),
  departureWindowEnd: z.string().optional(),
  stayMinNights: z.number().optional(),
  stayMaxNights: z.number().optional(),
  tripType: tripTypeSchema,
  cabin: cabinSchema,
  adults: z.number().int().positive(),
  maxStops: z.number().int().nonnegative(),
  currency: z.string(),
});

export const segmentSchema = z.object({
  operatingFlightNumber: z.string(),
  marketingFlightNumber: z.string().optional(),
  origin: z.string(),
  destination: z.string(),
  departureAt: z.string(),
  arrivalAt: z.string(),
  cabin: cabinSchema,
});

export const normalizedOfferSchema = z.object({
  providerId: z.string(),
  providerOfferId: z.string(),
  observedAt: z.number(),
  expiresAt: z.number().optional(),
  currency: z.string(),
  totalPriceMinor: z.number().int(),
  basePriceMinor: z.number().int().optional(),
  taxesMinor: z.number().int().optional(),
  optionalFeesKnown: z.boolean(),
  validatingCarrier: z.string(),
  marketingCarriers: z.array(z.string()),
  operatingCarriers: z.array(z.string()),
  segments: z.array(segmentSchema),
  durationMinutes: z.number().int(),
  stopCount: z.number().int().nonnegative(),
  cabin: cabinSchema,
  fareBrand: z.string().optional(),
  bookingClasses: z.array(z.string()).optional(),
  seatsRemaining: z.number().int().optional(),
  outboundUrl: z.string().optional(),
  qualityFlags: z.array(z.string()),
});

export const normalizedOfferBatchSchema = z.object({
  providerId: z.string(),
  query: normalizedSearchQuerySchema,
  retrievedAt: z.number(),
  offers: z.array(normalizedOfferSchema),
  warnings: z.array(z.string()),
});

export const snapshotMetricsSchema = z.object({
  benchmarkPriceMinor: z.number().int(),
  fromPriceMinor: z.number().int(),
  medianPriceMinor: z.number().int(),
  p25PriceMinor: z.number().int(),
  validOfferCount: z.number().int(),
  uniqueItineraryCount: z.number().int(),
  carrierCount: z.number().int(),
  nonstopOfferCount: z.number().int(),
  oneStopOfferCount: z.number().int(),
  freshnessSeconds: z.number().int(),
  dataQualityScore: z.number().min(0).max(1),
});

export const recommendationOutputSchema = z.object({
  label: recommendationLabelSchema,
  confidence: confidenceLevelSchema,
  score: z.number(),
  summary: z.string(),
  observedFacts: z.array(z.string()),
  inferences: z.array(
    z.object({ text: z.string(), confidence: confidenceLevelSchema })
  ),
  counterEvidence: z.array(z.string()),
  limitations: z.array(z.string()),
  methodologyVersion: z.string(),
});

export const marketEventSchema = z.object({
  id: z.number().int(),
  searchDefinitionId: z.number().int(),
  eventType: eventTypeSchema,
  eventStartAt: z.number(),
  eventEndAt: z.number().optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  confidence: confidenceLevelSchema,
  observedFacts: z.array(z.string()),
  inference: z
    .object({ text: z.string(), confidence: confidenceLevelSchema })
    .optional(),
  supportingRecordIds: z.array(z.number().int()),
  detectionRuleVersion: z.string(),
  createdAt: z.number(),
});

export const providerHealthSchema = z.object({
  providerId: z.string(),
  status: z.enum(['OK', 'DEGRADED', 'DOWN']),
  latencyMs: z.number().optional(),
  details: z.string().optional(),
});
