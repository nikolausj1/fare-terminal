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
    // "4 of 5" lowest-price itineraries replaced by fingerprint. Set-churn
    // between adjacent snapshots is constant background noise; an event is
    // only a story when most of the set turns over AND the benchmark
    // actually moved (see lowFareSetMinBenchmarkMovePct).
    lowFareSetChangeCount: 4,
    // LOW_FARE_SET_CHANGED also requires the benchmark to have moved at
    // least this % between the two snapshots. In a FLEXIBLE-window series
    // the cheapest itineraries legitimately hop across departure dates
    // between observations, so set turnover alone is background noise; it
    // becomes a story only when the price level moved with it.
    lowFareSetMinBenchmarkMovePct: 4,
    // CARRIER_ENTERED_LOW_SET only fires when the entering carrier is at
    // (or within this % of) the from price — i.e. it now sets or nearly
    // sets the market floor. CARRIER_LEFT_LOW_SET mirrors this for the
    // carrier that previously held the floor.
    carrierSetFromPriceProximityPct: 1,
    // Minimum same-direction move of each carrier's cheapest fare for
    // POSSIBLE_CARRIER_MATCH. Intraday noise regularly produces smaller
    // coincidental pairs; 8% keeps only deliberate-looking moves.
    carrierMatchMinMovePct: 8,
    // OFFER_COUNT_SURGE/CONTRACTION need this absolute offer-count change
    // in addition to the % threshold — on small sets (12-35 offers) the
    // percentage alone is noise.
    offerCountChangeAbsMin: 8,
    // VOLATILITY_SPIKE requires trailing MAD/median dispersion of at least
    // this % — young, flat histories make MAD ~0, where any move computes
    // as an infinite deviation ratio.
    volatilityMadFloorPct: 1,
    // Same-type events within this window coalesce into one episode: the
    // stored event's end time extends instead of a new row being created.
    // A severity escalation breaks through the cooldown as a new event.
    eventCooldownHours: 24,
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

  // WP-F1 fix 1: quality-gates whether a snapshot's price is trustworthy
  // enough to *display* at all (independent of pulse.minDataQualityScore,
  // which gates pulse-card eligibility, and recommendationScoring's own
  // 0.35 floor, which gates recommendation generation). A snapshot derived
  // from zero valid offers (e.g. the provider returned nothing for that
  // run) legitimately computes benchmarkPriceMinor: 0 and
  // dataQualityScore: 0 (see domain/snapshots/computeSnapshotMetrics.ts) —
  // that 0 is structurally indistinguishable downstream from a real $0
  // fare unless callers explicitly check it. lib/markets/queries.ts derives
  // MarketSummaryVM.priceReliable from this threshold (OR'd with a direct
  // benchmarkPriceMinor <= 0 check, since a lone bad price could sit in an
  // otherwise-decent-quality snapshot).
  display: {
    minQualityForPrice: 0.25,
  },

  // Market-pulse card gates (PRD §13.3): a definition's latest snapshot must
  // clear all of these before it can appear in a "biggest drops" /
  // "newly favorable" pulse card, on top of the freshness
  // (config.freshness.staleAfterMinutes) and methodology-version
  // (config.benchmark.methodologyVersion) checks already enforced
  // elsewhere. Added by WP4 (lib/markets/queries.ts#getMarketPulse).
  pulse: {
    // Minimum dataQualityScore for a snapshot to be pulse-eligible at all.
    minDataQualityScore: 0.5,
    // Minimum |pct24h| move for a card to qualify as a "biggest drop" /
    // "unusual" price move.
    minMoveAbsPct: 5,
    // Cap on cards rendered per pulse section (drops / newly favorable /
    // unusual events).
    maxCardsPerSection: 5,
  },

  // WP-F2: jobs/heatmap.ts (calendar_prices from /v2/prices/month-matrix).
  heatmap: {
    // How many calendar months (current + this many ahead) a full refresh
    // covers for one route — matches _review/revamp-data-audit.md's
    // "current + next 2 months" heatmap-gappiness verdict (dense near-term,
    // gappy past ~60 days).
    monthsAhead: 3,
    // Roster is split into this many rotating buckets by
    // jobs/stagger.ts#isInSweepBucket; one bucket refreshes per 6h sweep, so
    // with 4 buckets and the existing cron (every 6h) every route's heatmap
    // refreshes ~once per 24h. See jobs/heatmap.ts.
    staggerBuckets: 4,
  },

  // WP-F2: jobs/related.ts (related_fares from /v1/city-directions).
  related: {
    // Same rotation scheme as heatmap, applied to distinct roster origins
    // (hubs) instead of routes — see jobs/related.ts.
    staggerBuckets: 4,
  },

  // WP-F2: jobs/deals.ts (latest_deals from /v2/prices/latest, unfiltered).
  deals: {
    // Requested page size for the /v2/prices/latest call. The endpoint is a
    // firehose across the whole network, not scoped to the roster, so this
    // just caps one sweep's ingest volume.
    fetchLimit: 30,
    // Rows older than this are pruned every sweep — "recently spotted
    // deals" is meant to stay a short rolling window, not accumulate
    // forever.
    retentionHours: 72,
  },

  // WP-F2: jobs/index-series.ts (index_values, the Fare Terminal Index —
  // pure DB compute, no API calls). See that file's module doc comment for
  // the full formula.
  index: {
    methodologyVersion: 'index-v1',
    // The index only starts (base-100 anchor) once at least this fraction
    // of the active roster has a compatible-methodology snapshot on a given
    // day — avoids anchoring the index off a thin, unrepresentative slice
    // of routes.
    minRosterCoveragePct: 70,
    // Each route's "trailing median" denominator in the index formula looks
    // back this many days.
    trailingMedianDays: 28,
  },

  // WP-P1: the "From Seattle" personal home board — the owner's home
  // airport is SEA, and the groups below reflect how he personally thinks
  // about destinations (not a data-driven clustering). jobs/home-board.ts
  // populates city_direction_history from this single origin every sweep
  // (unconditional, not staggered — 1 request); lib/markets/home-board.ts
  // reads it back grouped per this shape. Codes may include destinations
  // city-directions has never returned for SEA (rendered as "unseen" by the
  // read layer) — SBA/STS are deliberately included for honesty ("no data
  // available for this one yet") rather than omitted to make the board look
  // more complete than it is.
  homeBoard: {
    origin: 'SEA',
    originCity: 'Seattle',
    groups: [
      { id: 'hawaii', label: 'Hawaii', codes: ['HNL', 'OGG', 'KOA', 'LIH'] },
      { id: 'bay-area', label: 'Bay Area', codes: ['SFO', 'SJC', 'OAK'] },
      { id: 'california', label: 'California', codes: ['LAX', 'SAN', 'SBA', 'STS'] },
      { id: 'midwest', label: 'MSP + MKE', codes: ['MSP', 'MKE'] },
      { id: 'arizona', label: 'Arizona', codes: ['PHX', 'TUS'] },
      { id: 'florida', label: 'Orlando', codes: ['MCO'] },
      // Added 2026-08-13 alongside sea-iah (PERSONAL, REAL_MARKETS). HOU is
      // watch-level only (no full-tracking search_definitions row) but
      // still appears here per the group-membership "honesty" convention;
      // DFW already has BENCHMARK-independent city-directions coverage
      // (confirmed in the same 2026-08-13 SEA probe) so it shows data
      // immediately.
      { id: 'texas', label: 'Texas', codes: ['IAH', 'HOU', 'DFW'] },
      { id: 'italy', label: 'Italy', codes: ['FCO', 'MXP', 'VCE'] },
      { id: 'france', label: 'France', codes: ['CDG', 'NCE'] },
    ],
    // How many trailing days of city_direction_history feed a
    // destination's sparkline (downsampled to <=20 points by the read
    // layer — see lib/markets/home-board.ts).
    sparklineDays: 30,
    // percentile() (share of history observations HIGHER than current)
    // returns null below this many observations for a destination — too
    // thin a history to say anything meaningful about "cheap vs. usual".
    minObservationsForPercentile: 10,
  },

  // WP-P3: lib/providers/serpapi/ (Google Flights via SerpApi), routed
  // per-definition by jobs/ingest.ts rather than via the global
  // DATA_PROVIDER switch — see that file's selection logic and
  // docs/PROVIDERS.md's SerpApi section. These 8 routes are the owner's
  // personal SEA routes the free travelpayouts cache has little/no coverage
  // for (see scripts/bootstrap-real.ts's REAL_MARKETS comments); route ids
  // match the `${id}` used in that file's/bootstrap-serpapi.ts's slug
  // convention (`${id}-flex-v1` / `${id}-exact-v1`), NOT full slugs.
  // Owner decision: TUS stays watch-level only (home-board/city-directions,
  // WP-P1) — no sea-tus definition is ever created here. sea-mke replaces
  // it. `sea-mke-flex-v1` already exists as an ACTIVE travelpayouts
  // full-tracking definition (WP-P1's roster); once SERPAPI_KEY is set, its
  // ingestion switches from travelpayouts to serpapi on that SAME
  // definition (bootstrap-serpapi.ts idempotently reuses it rather than
  // creating a duplicate — see its slug-collision handling). Mixed-provider
  // history on one definition is intentional and accepted: both are real
  // observations, provider_id is recorded per search_run, and quality
  // metadata reflects the jump in itinerary depth at the switchover.
  serpapi: {
    routes: ['sea-fco', 'sea-cdg', 'sea-ogg', 'sea-lih', 'sea-phx', 'sea-msp', 'sea-mke', 'sea-nce'],
    // SerpApi's free tier is 250 searches/month; 240 leaves headroom for
    // the (free, non-quota) account health check and any ad-hoc manual
    // searches sharing the same key. Hard cap, not prorated — see
    // lib/providers/serpapi/budget.ts's docstring for why the last day(s)
    // of a 31-day month can see definitions skipped once it's hit (8 routes
    // x 1 sweep/day x up to 31 days = up to 248, which exceeds 240).
    monthlySearchBudget: 240,
    // At most one serpapi search per search_definitions row per UTC
    // calendar day — see lib/providers/serpapi/budget.ts#evaluateSerpApiBudget.
    sweepsPerDay: 1,
  },
} as const;

export type AppConfig = typeof config;
