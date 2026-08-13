// Pinned top routes for the "From Seattle" home board (added 2026-08-13,
// owner request): the owner's three main destinations — Milwaukee,
// Phoenix, Minneapolis (domain/config.ts#homeBoard.pinned) — elevated
// above the group rows as richer cards fed by FULL_TRACKING data (these
// three routes get daily Google Flights-depth ingestion via
// domain/config.ts#serpapi.routes), falling back to the same watch-level
// city_direction_history feed lib/markets/home-board.ts uses when no
// reliable FULL_TRACKING snapshot exists yet. Pinning is additive — a
// pinned code is NOT removed from its existing homeBoard group; the pinned
// strip is the deep view, the groups stay the broad view.
//
// Split the same way lib/markets/home-board.ts splits from
// homeBoardMetrics.ts: resolvePinnedRoutePrice below is pure and
// fixture-testable (see tests/unit/pinned.test.ts — plain fixtures, no DB),
// while getPinnedRoutes does the DB-backed assembly (definition/snapshot/
// recommendation/history lookups, cityName).
//
// WP-P5: a pinned route's OWN observation history (offer_observations ->
// market_snapshots) starts thin the moment a route switches onto the
// serpapi roster — a fresh definition may have exactly 1 snapshot. Rather
// than show a flat 1-point line, resolvePinnedRoutePrice below falls back
// to GOOGLE's own price-tracking history (price_insights, persisted by
// jobs/ingest.ts's serpapi path into google_price_history/
// route_price_insights — see db/schema.ts's WP-P5 section) whenever our own
// history is too thin. This is Google's tracking data, not this app's own
// observations — every place it surfaces (sparklineSource, the "Google"
// caption in PinnedRoutes.tsx, the market page's typical-range line) must
// label it as such, never blend it silently with offer_observations-derived
// numbers.

import { and, asc, desc, eq } from 'drizzle-orm';

import { db } from '@/db';
import {
  airports,
  cityDirectionHistory,
  googlePriceHistory,
  marketSnapshots,
  recommendations as recommendationsTable,
  routePriceInsights,
} from '@/db/schema';
import { config } from '@/domain/config';
import { filterCompatibleSnapshots, historicalPercentile } from '@/domain/history';
import type { RecommendationLabel } from '@/domain/types';

import { downsample, SPARKLINE_MAX_POINTS, type Observation } from './homeBoardMetrics';
import { resolveDefinition } from './queries';
import { nearestByTime, pctChange } from './snapshotUtils';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Below this many of our OWN reliable FULL_TRACKING snapshots, the
 * sparkline falls back to Google's price_insights history (when any is
 * available) instead of rendering a near-flat 1-2 point line — see
 * resolvePinnedRoutePrice's FULL_TRACKING branch. */
const OWN_SPARKLINE_MIN_POINTS = 3;

export type PinnedPriceSource = 'FULL_TRACKING' | 'WATCH_FEED' | 'NONE';

/** Where a card's rendered sparkline actually came from — surfaced so the
 * UI can caption a GOOGLE_HISTORY sparkline honestly (see
 * components/home/PinnedRoutes.tsx's "60d · Google" caption). Null exactly
 * when sparkline is empty (PinnedPriceSource === 'NONE'). */
export type PinnedSparklineSource = 'OBSERVATIONS' | 'GOOGLE_HISTORY' | null;

export interface PinnedTypicalRange {
  lowMinor: number;
  highMinor: number;
}

export interface PinnedRouteVM {
  code: string;
  cityName: string | null;
  slug: string | null;
  priceMinor: number | null;
  priceSource: PinnedPriceSource;
  changePct24h: number | null;
  sparkline: number[];
  sparklineSource: PinnedSparklineSource;
  percentile: number | null;
  /** Share of Google's price_insights history priced HIGHER than the
   * current displayed price (same "cheaper than X% of..." convention as
   * `percentile` — see domain/history/percentile.ts#historicalPercentile),
   * computed against the FULL Google history regardless of how thin our own
   * history is. Null when no Google history exists for this route at all
   * (e.g. not on the serpapi roster, or not backfilled yet). */
  googlePercentile: number | null;
  /** Google's own "typical price range" for this route, from the latest
   * route_price_insights row. Null when no insights have been captured. */
  typicalRange: PinnedTypicalRange | null;
  recommendationLabel: RecommendationLabel | null;
  offerCount: number | null;
  observedAt: number | null;
}

// ---------------------------------------------------------------------------
// Pure precedence logic (fixture-testable, no DB)
// ---------------------------------------------------------------------------

/** Minimal shape resolvePinnedRoutePrice needs from a market_snapshots row
 * — narrowed from the full DB row so the pure function stays testable with
 * plain object fixtures instead of a full MarketSnapshotRow. The caller
 * (getPinnedRoutes) is responsible for pre-filtering to
 * config.benchmark.methodologyVersion-compatible rows (via
 * domain/history#filterCompatibleSnapshots, same as
 * lib/markets/queries.ts#loadCompatibleSnapshots) and sorting ascending by
 * snapshotAt before calling. */
export interface PinnedSnapshotLike {
  benchmarkPriceMinor: number;
  dataQualityScore: number;
  validOfferCount: number;
  snapshotAt: number;
}

/** A watch-level city_direction_history row, ascending by observedAt. */
export type PinnedWatchObservation = Observation;

/** One point of Google's own price_insights history (google_price_history),
 * ascending by date. `date` is only used for doc/debugging purposes by
 * callers of this pure function — resolvePinnedRoutePrice itself treats the
 * array as an already-chronological daily series and never parses `date`
 * itself (see its "last 30 days" doc note below for why). */
export type PinnedGoogleHistoryPoint = Observation & { date: string };

export interface PinnedPriceResolution {
  priceMinor: number | null;
  priceSource: PinnedPriceSource;
  changePct24h: number | null;
  sparkline: number[];
  sparklineSource: PinnedSparklineSource;
  percentile: number | null;
  googlePercentile: number | null;
  typicalRange: PinnedTypicalRange | null;
  offerCount: number | null;
  observedAt: number | null;
}

const EMPTY_RESOLUTION: PinnedPriceResolution = {
  priceMinor: null,
  priceSource: 'NONE',
  changePct24h: null,
  sparkline: [],
  sparklineSource: null,
  percentile: null,
  googlePercentile: null,
  typicalRange: null,
  offerCount: null,
  observedAt: null,
};

/** WP-F1 fix 1's reliability rule (lib/markets/queries.ts#isPriceReliable),
 * duplicated here rather than imported: that function isn't exported, and
 * queries.ts is outside this feature's file ownership. It's a two-line
 * check over config.display.minQualityForPrice — the same "duplicate a
 * small stable contract across an ownership boundary" call
 * view-models.ts's ESTIMATED_TIMING_QUALITY_FLAGS already makes for an
 * analogous reason. Keep in sync with queries.ts#isPriceReliable if that
 * threshold ever changes. */
export function isPinnedSnapshotReliable(snapshot: { benchmarkPriceMinor: number; dataQualityScore: number }): boolean {
  return snapshot.benchmarkPriceMinor > 0 && snapshot.dataQualityScore >= config.display.minQualityForPrice;
}

/**
 * Resolves one pinned route's displayed price + supporting metrics per the
 * precedence: latest RELIABLE FULL_TRACKING snapshot -> latest WATCH_FEED
 * (city_direction_history) observation -> NONE. Pure — no DB access.
 *
 * - FULL_TRACKING: `current` is the latest snapshot whose price is
 *   reliable (not just the latest snapshot period — an unreliable latest
 *   snapshot is skipped in favor of an older reliable one, same spirit as
 *   queries.ts's history filtering). changePct24h compares against the
 *   nearest reliable snapshot ~24h earlier (6h tolerance, matching
 *   queries.ts's prev24h). percentile is the share of prior reliable
 *   snapshots priced higher than `current` (null with zero prior history).
 *   sparkline is normally every reliable snapshot (including current),
 *   downsampled to <=20 points — unreliable snapshots are excluded outright
 *   rather than shown as a misleading dip/spike. WP-P5: when there are
 *   fewer than OWN_SPARKLINE_MIN_POINTS reliable snapshots (a near-flat
 *   1-2 point line isn't a useful chart), the sparkline falls back to
 *   Google's price_insights history instead, when any was supplied —
 *   sparklineSource distinguishes which one actually rendered. "Last 30
 *   days" for that fallback is implemented as the newest 30 entries of
 *   `googleHistory` (already-daily, already-chronological — see
 *   PinnedGoogleHistoryPoint), not a `now`-relative date filter, so this
 *   function stays a pure fixture-testable function of its inputs.
 * - WATCH_FEED: only reached when no FULL_TRACKING snapshot is reliable
 *   (including "no snapshots at all", e.g. no search_definition resolved).
 *   `current` is the latest city_direction_history observation; no
 *   percentile/recommendation exists at this tracking depth, but its own
 *   sparkline is always used as-is (never Google-fallback — a watch-level
 *   route's sparkline is already sourced from real observations, just a
 *   thinner feed).
 * - NONE: neither source has any data for this destination yet.
 *
 * Independent of the above: googlePercentile is computed against the FULL
 * `googleHistory` array whenever it's non-empty and there's a `current`
 * price to compare (FULL_TRACKING or WATCH_FEED), regardless of which
 * source ultimately supplied the sparkline. typicalRange passes through
 * `typicalRange` unchanged — it describes the route generally, not a
 * specific price point.
 *
 * `compatibleSnapshots` must already be filterCompatibleSnapshots-filtered
 * and ascending by snapshotAt; `watchHistory` ascending by observedAt;
 * `googleHistory` ascending by date. All three may be empty.
 *
 * No "now"/freshness gating here on purpose — unlike getMarketPulse's
 * isFresh check, a pinned card shows the latest reliable snapshot
 * regardless of age (staleness is a separate concern the card's source
 * tag/tooltip and observedAt timestamp can surface, not a reason to hide
 * the price).
 */
export function resolvePinnedRoutePrice(
  compatibleSnapshots: readonly PinnedSnapshotLike[],
  watchHistory: readonly PinnedWatchObservation[],
  googleHistory: readonly PinnedGoogleHistoryPoint[] = [],
  typicalRange: PinnedTypicalRange | null = null
): PinnedPriceResolution {
  const reliable = compatibleSnapshots.filter(isPinnedSnapshotReliable);
  const googlePrices = googleHistory.map((h) => h.priceMinor);

  function googlePercentileFor(currentPriceMinor: number): number | null {
    return googlePrices.length > 0 ? historicalPercentile(currentPriceMinor, googlePrices) : null;
  }

  if (reliable.length > 0) {
    const current = reliable[reliable.length - 1];
    const history = reliable.slice(0, -1);

    const prev24h = nearestByTime(
      history.map((s) => ({ snapshotAt: s.snapshotAt, benchmarkPriceMinor: s.benchmarkPriceMinor })),
      current.snapshotAt - DAY_MS,
      6 * HOUR_MS
    );
    const changePct24h = prev24h ? pctChange(prev24h.benchmarkPriceMinor, current.benchmarkPriceMinor) : null;

    const historyPrices = history.map((s) => s.benchmarkPriceMinor);
    const percentile = history.length > 0 ? historicalPercentile(current.benchmarkPriceMinor, historyPrices) : null;

    const useGoogleFallback = reliable.length < OWN_SPARKLINE_MIN_POINTS && googleHistory.length > 0;
    const sparkline = useGoogleFallback
      ? downsample(googleHistory.slice(-30), SPARKLINE_MAX_POINTS)
      : downsample(
          reliable.map((s) => ({ priceMinor: s.benchmarkPriceMinor, observedAt: s.snapshotAt })),
          SPARKLINE_MAX_POINTS
        );

    return {
      priceMinor: current.benchmarkPriceMinor,
      priceSource: 'FULL_TRACKING',
      changePct24h,
      sparkline,
      sparklineSource: useGoogleFallback ? 'GOOGLE_HISTORY' : 'OBSERVATIONS',
      percentile,
      googlePercentile: googlePercentileFor(current.benchmarkPriceMinor),
      typicalRange,
      offerCount: current.validOfferCount,
      observedAt: current.snapshotAt,
    };
  }

  if (watchHistory.length > 0) {
    const current = watchHistory[watchHistory.length - 1];
    const sparkline = downsample(watchHistory, SPARKLINE_MAX_POINTS);
    return {
      priceMinor: current.priceMinor,
      priceSource: 'WATCH_FEED',
      changePct24h: null,
      sparkline,
      sparklineSource: 'OBSERVATIONS',
      percentile: null,
      googlePercentile: googlePercentileFor(current.priceMinor),
      typicalRange,
      offerCount: null,
      observedAt: current.observedAt,
    };
  }

  return { ...EMPTY_RESOLUTION, typicalRange };
}

// ---------------------------------------------------------------------------
// DB-backed assembly
// ---------------------------------------------------------------------------

/**
 * Builds the pinned-routes strip: one VM per domain/config.ts#homeBoard.pinned
 * code, in that config's order. Each destination independently resolves via
 * resolvePinnedRoutePrice above — a slug is populated whenever a FLEXIBLE
 * search_definition resolves (even in a WATCH_FEED/NONE price state, so the
 * card can still link through to the market page), and
 * recommendationLabel/percentile are only ever non-null for FULL_TRACKING
 * (a watch-level feed has no recommendation engine behind it).
 */
export function getPinnedRoutes(): PinnedRouteVM[] {
  const origin = config.homeBoard.origin;

  return config.homeBoard.pinned.map((code): PinnedRouteVM => {
    const airport = db.select().from(airports).where(eq(airports.iataCode, code)).get();
    const cityName = airport?.cityName ?? null;

    const definition = resolveDefinition(origin, code);
    const slug = definition?.slug ?? null;

    let compatibleSnapshots: PinnedSnapshotLike[] = [];
    let recommendationLabel: RecommendationLabel | null = null;
    let googleHistory: PinnedGoogleHistoryPoint[] = [];
    let typicalRange: PinnedTypicalRange | null = null;

    if (definition) {
      const rawSnapshots = db
        .select()
        .from(marketSnapshots)
        .where(eq(marketSnapshots.searchDefinitionId, definition.id))
        .orderBy(asc(marketSnapshots.snapshotAt))
        .all();
      compatibleSnapshots = filterCompatibleSnapshots(rawSnapshots, config.benchmark.methodologyVersion);

      const recRow = db
        .select()
        .from(recommendationsTable)
        .where(eq(recommendationsTable.searchDefinitionId, definition.id))
        .orderBy(desc(recommendationsTable.createdAt))
        .limit(1)
        .get();
      recommendationLabel = recRow?.label ?? null;

      // WP-P5: Google's own price-tracking history for this definition, if
      // any has been captured (serpapi roster only — see
      // jobs/ingest.ts#persistPriceInsights and
      // scripts/backfill-price-insights.ts). Ascending by price_date, as
      // resolvePinnedRoutePrice requires.
      const googleRows = db
        .select()
        .from(googlePriceHistory)
        .where(eq(googlePriceHistory.searchDefinitionId, definition.id))
        .orderBy(asc(googlePriceHistory.priceDate))
        .all();
      googleHistory = googleRows.map((r) => ({
        date: r.priceDate,
        priceMinor: r.priceMinor,
        observedAt: r.capturedAt,
      }));

      const latestInsightsRow = db
        .select()
        .from(routePriceInsights)
        .where(eq(routePriceInsights.searchDefinitionId, definition.id))
        .orderBy(desc(routePriceInsights.capturedAt))
        .limit(1)
        .get();
      typicalRange =
        latestInsightsRow && latestInsightsRow.typicalLowMinor !== null && latestInsightsRow.typicalHighMinor !== null
          ? { lowMinor: latestInsightsRow.typicalLowMinor, highMinor: latestInsightsRow.typicalHighMinor }
          : null;
    }

    const watchRows = db
      .select()
      .from(cityDirectionHistory)
      .where(and(eq(cityDirectionHistory.origin, origin), eq(cityDirectionHistory.destination, code)))
      .orderBy(asc(cityDirectionHistory.observedAt))
      .all();
    const watchHistory: PinnedWatchObservation[] = watchRows.map((r) => ({
      priceMinor: r.priceMinor,
      observedAt: r.observedAt,
    }));

    const resolution = resolvePinnedRoutePrice(compatibleSnapshots, watchHistory, googleHistory, typicalRange);

    return {
      code,
      cityName,
      slug,
      priceMinor: resolution.priceMinor,
      priceSource: resolution.priceSource,
      changePct24h: resolution.changePct24h,
      sparkline: resolution.sparkline,
      sparklineSource: resolution.sparklineSource,
      percentile: resolution.percentile,
      googlePercentile: resolution.googlePercentile,
      typicalRange: resolution.typicalRange,
      // Only a FULL_TRACKING price is backed by the recommendation engine —
      // a WATCH_FEED/NONE card never shows a label even if a stale
      // recommendation row happens to exist for the definition.
      recommendationLabel: resolution.priceSource === 'FULL_TRACKING' ? recommendationLabel : null,
      offerCount: resolution.offerCount,
      observedAt: resolution.observedAt,
    };
  });
}
