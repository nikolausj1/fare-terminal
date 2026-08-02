// View-model types for the read layer (lib/markets/queries.ts). Both
// app/api/** route handlers and any future server components should consume
// ONLY these shapes — never raw DB rows, never domain types directly — so
// the UI layer has one stable contract regardless of how the DB/domain
// layers evolve. All prices are integer minor units (cents); all timestamps
// are epoch milliseconds unless suffixed `Iso`.

import type {
  Cabin,
  ConfidenceLevel,
  EventType,
  MarketEvent,
  RecommendationOutput,
  SearchMode,
  SnapshotMetrics,
  TripType,
} from '@/domain/types';
import type { FairValueRange } from '@/domain/history';

/**
 * What kind of data the currently-connected DB actually contains, derived
 * from the DISTINCT provider_id values present in search_runs — NEVER from
 * an env var (env vars describe how the pipeline was *configured* to run,
 * not what ended up in the database; e.g. DATA_PROVIDER could be flipped
 * without re-seeding). See lib/markets/queries.ts#getDataSourceMode.
 *
 * - 'DEMO': every search_runs.provider_id is 'demo' (or there are no runs
 *   yet — an empty/fresh DB defaults to DEMO).
 * - 'AGGREGATED_CACHED': every search_runs.provider_id is a real provider
 *   (currently only 'travelpayouts') — cached, aggregated observations, not
 *   live quotes.
 * - 'MIXED': both demo and real provider_ids are present in the same DB.
 *   This should never happen by design (demo and real deployments use
 *   separate DB files) — it exists purely as a tripwire so a data-integrity
 *   bug surfaces loudly in the UI instead of silently blending synthetic
 *   and real prices.
 */
export type DataSourceMode = 'DEMO' | 'AGGREGATED_CACHED' | 'MIXED';

/** Quality flags (from lib/providers/travelpayouts/mapping.ts) that mean an
 * offer's depart/arrive/duration fields are not sourced from a verified
 * per-leg itinerary and should be labeled "est." in the UI. Duplicated here
 * as plain string literals (rather than imported) so lib/markets stays
 * decoupled from lib/providers/** — the two are owned by different work
 * packages and the flag values are a stable string contract, not a type. */
export const ESTIMATED_TIMING_QUALITY_FLAGS = [
  'SYNTHETIC_SEGMENTS',
  'ESTIMATED_LEG_SPLIT',
  'ESTIMATED_DURATION',
] as const;

/** Everything needed to render one market's detail page / summary card. */
export interface MarketSummaryVM {
  definition: {
    slug: string;
    origin: string;
    destination: string;
    originCity: string;
    destinationCity: string;
    mode: SearchMode;
    cabin: Cabin;
    tripType: TripType;
    currency: string;
    /** Human-readable window description, e.g. "Anytime in 21-90 days,
     * 5-9 night stay" (FLEXIBLE) or "Depart 2026-09-15, return 2026-09-22"
     * (EXACT). */
    windowDescription: string;
  };
  /** The latest compatible-methodology snapshot, camelCase, prices in minor
   * units (as SnapshotMetrics already stores them), plus when it was taken. */
  snapshot: SnapshotMetrics & { snapshotAt: number };
  /** Null when there's no earlier compatible snapshot to compare against;
   * otherwise each field is independently null if no snapshot near that
   * lookback window exists. */
  change: {
    pct24h: number | null;
    abs24hMinor: number | null;
    pct7d: number | null;
  } | null;
  /** "Cheaper than X% of history" — see domain/history/percentile.ts. Null
   * when there's no comparable history yet. */
  percentile: number | null;
  fairValue: FairValueRange | null;
  recommendation: RecommendationOutput | null;
  analystNote: { text: string; generationMode: 'LLM' | 'TEMPLATE'; createdAt: number } | null;
  /** Demo-mode freshness: age relative to getDatasetAnchor() (the newest
   * observed_at in the DB), NOT relative to the real wall clock — see
   * lib/markets/queries.ts#getDatasetAnchor for why. */
  freshness: { ageSeconds: number; isStale: boolean };
  dataQuality: number;
  /** DB-derived data source mode — see DataSourceMode. */
  dataSourceMode: DataSourceMode;
  /** Derived alias: `dataSourceMode === 'DEMO'`. Kept for backward
   * compatibility with existing callers/tests; prefer `dataSourceMode` for
   * anything that needs to distinguish AGGREGATED_CACHED from MIXED. */
  demoMode: boolean;
  /** The dataset anchor (max observed_at across all offer_observations) that
   * `freshness` above is computed relative to. */
  datasetAnchorAt: number;
  /** False when `snapshot`'s price fields shouldn't be trusted/displayed as
   * a real price — either the snapshot's dataQualityScore is below
   * config.display.minQualityForPrice, or benchmarkPriceMinor <= 0 (e.g. a
   * search run that returned zero valid offers still produces a
   * structurally-valid-looking $0 snapshot — see
   * domain/snapshots/computeSnapshotMetrics.ts's zero-valid-offers branch).
   * The UI should render a "price data unreliable" state instead of the
   * price/delta when this is false. See lib/markets/queries.ts#getMarketSummary
   * (WP-F1 fix 1). */
  priceReliable: boolean;
  /** Non-null when the caller requested EXACT-date benchmark data but no
   * matching search_definition existed, so resolution silently served the
   * FLEXIBLE-window definition instead. The UI should surface this near the
   * mode toggle rather than let the page look like it's honoring the
   * request (WP-F1 fix 2). */
  modeFallback: { requested: 'EXACT'; served: 'FLEXIBLE' } | null;
}

/** One point in a market's benchmark-price history chart.
 *
 * WP-F1 fix 1: points whose price isn't reliable (see
 * MarketSummaryVM.priceReliable for the exact condition) are dropped from
 * the array entirely by lib/markets/queries.ts#getMarketHistory, rather
 * than included with a flag — chosen over marking them because (a) the
 * chart already renders a visual gap whenever consecutive kept points are
 * more than 2x the typical interval apart (gapAfter below), so removing an
 * unreliable point naturally produces that gap with zero component changes,
 * and (b) it keeps every consumer of this array (chart line, tooltip,
 * event-marker nearest-point lookup) from having to remember to re-check a
 * flag before touching benchmarkPriceMinor. */
export interface HistoryPointVM {
  snapshotAt: number;
  benchmarkPriceMinor: number;
  fromPriceMinor: number;
  dataQualityScore: number;
  /** True when the NEXT point in the series is more than 2x the median
   * inter-snapshot interval away — i.e. render a visual gap/break after this
   * point rather than a continuous line to the next one. */
  gapAfter: boolean;
}

/** A MarketEvent plus UI-friendly extras: a human label and ISO timestamps
 * (the domain type only carries epoch millis). */
export interface MarketEventVM extends MarketEvent {
  /** Short human-readable label for the event type, e.g. "Price drop". */
  label: string;
  eventStartIso: string;
  eventEndIso: string | null;
  createdIso: string;
}

/** One row in a market's current offers table. */
export interface OfferRowVM {
  carrierCode: string;
  carrierName: string;
  priceMinor: number;
  currency: string;
  stops: number;
  durationMinutes: number;
  departIso: string;
  arriveIso: string;
  fareBrand: string | null;
  seatsRemaining: number | null;
  lastObservedAt: number;
  outboundUrl: string | null;
  /** Raw quality-flag strings carried over from offer_observations.
   * qualityFlags — e.g. 'AGGREGATED_CACHED_SOURCE', 'SYNTHETIC_SEGMENTS'.
   * The UI uses this to decide whether depart/arrive/duration should be
   * labeled "est." — see ESTIMATED_TIMING_QUALITY_FLAGS above. */
  qualityFlags: string[];
}

/** A compact card summarizing one market, used in market-pulse sections and
 * (potentially) list/grid views. */
export interface MarketCardVM {
  origin: string;
  destination: string;
  slug: string;
  benchmarkPriceMinor: number;
  changePct: number | null;
  changeAbsMinor: number | null;
  windowLabel: string;
  percentile: number | null;
  confidence: ConfidenceLevel | null;
  dataQualityLabel: 'HIGH' | 'MEDIUM' | 'LOW';
  note: string | null;
}

/** The market-pulse ("what's happening across all markets") view model. */
export interface PulseVM {
  brief: { text: string; generatedAt: number; mode: 'TEMPLATE' };
  biggestDrops: MarketCardVM[];
  newlyFavorable: MarketCardVM[];
  unusualEvents: {
    marketSlug: string;
    origin: string;
    destination: string;
    event: MarketEventVM;
  }[];
  freshness: { datasetAnchorAt: number; generatedAt: number };
  /** DB-derived data source mode — see DataSourceMode. */
  dataSourceMode: DataSourceMode;
  /** Derived alias: `dataSourceMode === 'DEMO'`. Kept for backward
   * compatibility; prefer `dataSourceMode`. */
  demoMode: boolean;
}

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  PRICE_DROP: 'Price drop',
  PRICE_INCREASE: 'Price increase',
  NEW_HISTORICAL_LOW: 'New historical low',
  VOLATILITY_SPIKE: 'Volatility spike',
  OFFER_COUNT_SURGE: 'Offer count surge',
  OFFER_COUNT_CONTRACTION: 'Offer count contraction',
  LOW_FARE_SET_CHANGED: 'Low-fare set changed',
  CARRIER_ENTERED_LOW_SET: 'Carrier entered low set',
  CARRIER_LEFT_LOW_SET: 'Carrier left low set',
  POSSIBLE_CARRIER_MATCH: 'Possible carrier match',
  FARE_PRODUCT_APPEARED: 'Fare product appeared',
  FARE_PRODUCT_DISAPPEARED: 'Fare product disappeared',
  DATA_ANOMALY: 'Data anomaly',
};
