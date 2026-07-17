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
  /** Always true for the demo provider (DATA_PROVIDER=demo). Exposed so the
   * UI can label prices/freshness as demo data rather than implying a live
   * feed. */
  demoMode: boolean;
  /** The dataset anchor (max observed_at across all offer_observations) that
   * `freshness` above is computed relative to. */
  datasetAnchorAt: number;
}

/** One point in a market's benchmark-price history chart. */
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
