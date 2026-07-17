// Single source of truth for tunable thresholds and defaults. Every module
// that needs one of these values must import it from here — never hardcode
// a threshold inline.

export const config = {
  benchmark: {
    lowOfferSetSize: 5,
    methodologyVersion: 'benchmark-v1',
    // Snapshot data-quality: offer-count component reaches full credit (1.0)
    // once validOfferCount reaches this many offers. Added by WP3.
    minOffersForFullQuality: 8,
  },

  // Normalization-stage thresholds (offer validation, dedupe, anomaly
  // flagging). Added by WP3.
  normalization: {
    // An offer priced this many percent (or more) below the batch median is
    // a candidate anomaly.
    anomalyBelowMedianPct: 35,
    // ...unless a second offer is within this percent of it, which is
    // treated as corroboration that the low price is real.
    anomalySecondOfferWindowPct: 10,
  },

  // History-stage thresholds (fair value band, percentile). Added by WP3.
  history: {
    // MAD-band multiplier for fairValueRange: half-width = k * 1.4826 * MAD.
    fairValueMadK: 1.5,
    // fairValueRange() returns null below this many historical points.
    minHistoryForFairValue: 15,
  },

  // PRD heuristic: score >= 3 -> BUY, 1.5..2.99 -> LEAN_BUY,
  // -1.49..1.49 -> NEUTRAL, <= -1.5 -> WAIT.
  recommendationThresholds: {
    buy: 3,
    leanBuyMin: 1.5,
    leanBuyMax: 2.99,
    neutralMin: -1.49,
    neutralMax: 1.49,
    wait: -1.5,
  },

  // Percentile-RANK bucket (0 = cheapest end of history, 100 = priciest
  // end) -> historical-value score contribution. Note: this is the
  // complement of historicalPercentile()'s "cheaper than X% of history"
  // framing — see domain/history/percentile.ts for the conversion.
  percentileToHistoricalValue: [
    { min: 0, max: 15, value: 2, exclusiveMin: false },
    { min: 15, max: 30, value: 1, exclusiveMin: true },
    { min: 30, max: 65, value: 0, exclusiveMin: true },
    { min: 65, max: 85, value: -1, exclusiveMin: true },
    { min: 85, max: 100, value: -2, exclusiveMin: true },
  ],

  eventThresholds: {
    priceDropPct: 8,
    priceDropAbsMinor: 4000,
    volatilityMadMultiplier: 3,
    offerCountSurgePct: 40,
    carrierMatchWindowHours: 6,
    // Added by WP3:
    offerCountContractionPct: 40,
    // "3 of 5" lowest-price itineraries replaced by fingerprint.
    lowFareSetChangeCount: 3,
    dataAnomalyQualityThreshold: 0.3,
  },

  demoDefaults: {
    flexibleWindowMinDays: 21,
    flexibleWindowMaxDays: 90,
    stayMinNights: 5,
    stayMaxNights: 9,
  },

  freshness: {
    staleAfterMinutes: 360,
  },

  // Recommendation-engine scoring dimensions and confidence/gating
  // thresholds (PRD §15.5). Added by WP3.
  recommendationScoring: {
    // Below this many compatible historical snapshots, or below
    // minDataQualityScore, or staler than freshness.staleAfterMinutes ->
    // INSUFFICIENT_DATA.
    minHistoryForRecommendation: 10,
    minDataQualityScore: 0.35,
    // momentum7dPct / momentumFullScalePct, clamped to [-1, 1].
    momentumFullScalePct: 10,
    // -offerCountChangePct / supplyFullScalePct, clamped to [-1, 1].
    supplyFullScalePct: 30,
    // volatilityPct / volatilityFullScalePct, clamped to [0, 1], negated.
    volatilityFullScalePct: 20,
    // Departure-urgency score bands (-2..+1), keyed on daysToDeparture.
    leadTimeBands: [
      { minDays: -Infinity, maxDays: 3, value: 1 },
      { minDays: 4, maxDays: 14, value: 0.5 },
      { minDays: 15, maxDays: 60, value: 0 },
      { minDays: 61, maxDays: 120, value: -1 },
      { minDays: 121, maxDays: Infinity, value: -2 },
    ],
    // Confidence gating: all three conditions must hold for the tier.
    confidenceBands: {
      highMinQuality: 0.7,
      highMinHistory: 30,
      highMaxVolatilityPct: 15,
      moderateMinQuality: 0.5,
      moderateMinHistory: 15,
      moderateMaxVolatilityPct: 25,
    },
  },
} as const;

export type AppConfig = typeof config;
