// Single source of truth for tunable thresholds and defaults. Every module
// that needs one of these values must import it from here — never hardcode
// a threshold inline.

export const config = {
  benchmark: {
    lowOfferSetSize: 5,
    methodologyVersion: 'benchmark-v1',
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

  // Percentile bucket -> historical-value score contribution.
  percentileToHistoricalValue: [
    { min: 0, max: 15, value: 2 },
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
} as const;

export type AppConfig = typeof config;
