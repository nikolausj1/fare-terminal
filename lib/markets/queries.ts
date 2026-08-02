// Typed read layer: the ONLY place app/api/** route handlers (and any
// future server components) should query the DB from. Everything here
// returns lib/markets/view-models.ts shapes, never raw DB rows or domain
// types directly.
//
// Demo freshness (WP4 §4): the seeded dataset is anchored at seed time
// (DEMO_NOW, or real Date.now() if unset), not "now" as the app is actually
// being viewed. On a Vercel demo deploy, comparing snapshot ages against the
// real wall clock would mark everything stale within hours of the last
// seed/pipeline run. Instead, freshness here is computed relative to
// getDatasetAnchor() — the newest observed_at across all offer_observations
// — and every VM that exposes freshness also exposes dataSourceMode (plus
// the legacy demoMode boolean alias) and the anchor itself, so the UI can
// label it honestly (demo freshness vs. cached-aggregated freshness) rather
// than implying a live feed either way.
//
// dataSourceMode (WP-C): derived from DISTINCT search_runs.provider_id via
// getDataSourceMode() below — NEVER from process.env.DATA_PROVIDER. The env
// var only says how the ingestion pipeline was configured; the DB's actual
// contents are the only honest source for what kind of data is being shown.

import { cache } from 'react';

import { and, asc, desc, eq, max } from 'drizzle-orm';

import { db } from '@/db';
import {
  airports,
  marketEvents,
  marketScopes,
  marketSnapshots,
  offerObservations,
  recommendations as recommendationsTable,
  analystNotes,
  searchDefinitions,
  searchRuns,
} from '@/db/schema';
import { CARRIERS } from '@/db/seed/markets';
import { config } from '@/domain/config';
import { fairValueRange, filterCompatibleSnapshots, historicalPercentile } from '@/domain/history';
import type {
  Cabin,
  ConfidenceLevel,
  RecommendationOutput,
  SearchMode,
  TripType,
} from '@/domain/types';

import { deriveDataSourceMode } from './dataSourceMode';
import { loadOfferRowsForSearchRunIds } from './offers';
import { nearestByTime, pctChange } from './snapshotUtils';
import {
  EVENT_TYPE_LABELS,
  type DataSourceMode,
  type HistoryPointVM,
  type MarketCardVM,
  type MarketEventVM,
  type MarketSummaryVM,
  type OfferRowVM,
  type PulseVM,
} from './view-models';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const CARRIER_NAME_BY_CODE = new Map(CARRIERS.map((c) => [c.code, c.name]));

function carrierName(code: string): string {
  return CARRIER_NAME_BY_CODE.get(code) ?? code;
}

/**
 * The DB-derived data source mode (see DataSourceMode in view-models.ts),
 * computed from DISTINCT search_runs.provider_id — deliberately NOT from
 * process.env.DATA_PROVIDER, which only says how the pipeline was
 * configured, not what actually landed in this DB file. One cheap
 * SELECT DISTINCT, memoized per server request via React's `cache()` (this
 * module is server-only — every caller is a server component or an
 * app/api/** route handler) so pages that call it multiple times (layout +
 * page + pulse) don't repeat the query within a single render pass.
 */
export const getDataSourceMode = cache((): DataSourceMode => {
  const rows = db.selectDistinct({ providerId: searchRuns.providerId }).from(searchRuns).all();
  return deriveDataSourceMode(rows.map((r) => r.providerId));
});

type SearchDefinitionRow = typeof searchDefinitions.$inferSelect;
type MarketSnapshotRow = typeof marketSnapshots.$inferSelect;

// ---------------------------------------------------------------------------
// Dataset anchor / freshness
// ---------------------------------------------------------------------------

/** The newest observed_at across all offer_observations — the "now" the
 * demo dataset is anchored to. See module docstring for why freshness is
 * computed relative to this instead of the real wall clock. */
export function getDatasetAnchor(): number {
  const row = db
    .select({ maxObservedAt: max(offerObservations.observedAt) })
    .from(offerObservations)
    .get();
  return row?.maxObservedAt ?? Date.now();
}

function dataQualityLabel(score: number): 'HIGH' | 'MEDIUM' | 'LOW' {
  const bands = config.recommendationScoring.confidenceBands;
  if (score >= bands.highMinQuality) return 'HIGH';
  if (score >= bands.moderateMinQuality) return 'MEDIUM';
  return 'LOW';
}

/** WP-F1 fix 1: whether a snapshot's benchmark price is reliable enough to
 * display as a real price. See config.display.minQualityForPrice and
 * MarketSummaryVM.priceReliable for the full rationale — the short version
 * is that a snapshot derived from zero valid offers legitimately computes
 * benchmarkPriceMinor: 0 / dataQualityScore: 0
 * (domain/snapshots/computeSnapshotMetrics.ts), which is structurally
 * indistinguishable from a real $0 fare unless checked explicitly here. */
function isPriceReliable(snapshot: { benchmarkPriceMinor: number; dataQualityScore: number }): boolean {
  return snapshot.benchmarkPriceMinor > 0 && snapshot.dataQualityScore >= config.display.minQualityForPrice;
}

// ---------------------------------------------------------------------------
// Definition resolution
// ---------------------------------------------------------------------------

export interface MarketLookupParams {
  mode?: SearchMode;
  cabin?: Cabin;
  stops?: number;
  depart?: string;
  return?: string;
}

/** Non-null when the caller asked for EXACT-date data but resolution had to
 * silently substitute the FLEXIBLE-window definition instead — see
 * resolveDefinitionDetailed. Mirrors MarketSummaryVM.modeFallback. */
export interface ModeFallback {
  requested: 'EXACT';
  served: 'FLEXIBLE';
}

export interface DefinitionResolution {
  definition: SearchDefinitionRow | null;
  modeFallback: ModeFallback | null;
}

/** Resolves a search_definitions row from an origin/destination IATA pair +
 * optional disambiguating params, and reports whether the requested mode
 * had to be silently substituted (WP-F1 fix 2 — previously this fallback
 * was invisible to callers, so an EXACT-date request that had no matching
 * definition would render as if it were honored, with no indication the
 * numbers are actually the flexible-window benchmark). Does NOT create
 * anything — a route with no matching definition at all (not even a
 * FLEXIBLE fallback) should 404. Defaults to FLEXIBLE unless `mode` is
 * given or a `depart` date implies EXACT. */
export function resolveDefinitionDetailed(
  origin: string,
  destination: string,
  params: MarketLookupParams = {}
): DefinitionResolution {
  const NOT_FOUND: DefinitionResolution = { definition: null, modeFallback: null };
  const originCode = origin.toUpperCase();
  const destCode = destination.toUpperCase();

  const originScope = db
    .select()
    .from(marketScopes)
    .where(and(eq(marketScopes.scopeType, 'AIRPORT'), eq(marketScopes.code, originCode)))
    .get();
  const destScope = db
    .select()
    .from(marketScopes)
    .where(and(eq(marketScopes.scopeType, 'AIRPORT'), eq(marketScopes.code, destCode)))
    .get();
  if (!originScope || !destScope) return NOT_FOUND;

  const candidates = db
    .select()
    .from(searchDefinitions)
    .where(
      and(
        eq(searchDefinitions.originScopeId, originScope.id),
        eq(searchDefinitions.destinationScopeId, destScope.id),
        eq(searchDefinitions.active, true)
      )
    )
    .all();
  if (candidates.length === 0) return NOT_FOUND;

  const desiredMode: SearchMode = params.mode ?? (params.depart ? 'EXACT' : 'FLEXIBLE');

  function filterFor(mode: SearchMode): SearchDefinitionRow[] {
    return candidates.filter((def) => {
      if (def.mode !== mode) return false;
      if (params.cabin && def.cabin !== params.cabin) return false;
      if (params.stops !== undefined && def.maxStops !== params.stops) return false;
      return true;
    });
  }

  const primary = filterFor(desiredMode);
  if (primary.length > 0) {
    if (desiredMode === 'EXACT' && params.depart) {
      const exact = primary.find((def) => def.departureDate === params.depart);
      if (exact) return { definition: exact, modeFallback: null };
    }
    return { definition: primary[0], modeFallback: null };
  }

  // Fall back to FLEXIBLE (the always-seeded mode) when the requested mode
  // has no matching definition. desiredMode is narrowed to 'EXACT' here
  // since SearchMode only has the two values and we already returned above
  // for a non-empty 'FLEXIBLE' primary match.
  if (desiredMode !== 'FLEXIBLE') {
    const fallback = filterFor('FLEXIBLE');
    if (fallback.length > 0) {
      return { definition: fallback[0], modeFallback: { requested: 'EXACT', served: 'FLEXIBLE' } };
    }
  }

  return NOT_FOUND;
}

/** Definition-only convenience wrapper around resolveDefinitionDetailed for
 * the callers (refresh/history/events routes) that never pass a `mode`/
 * `depart` param and so can never trigger a fallback worth reporting. */
export function resolveDefinition(
  origin: string,
  destination: string,
  params: MarketLookupParams = {}
): SearchDefinitionRow | null {
  return resolveDefinitionDetailed(origin, destination, params).definition;
}

export function resolveDefinitionByIdOrSlug(defIdOrSlug: number | string): SearchDefinitionRow | null {
  if (typeof defIdOrSlug === 'number') {
    return db.select().from(searchDefinitions).where(eq(searchDefinitions.id, defIdOrSlug)).get() ?? null;
  }
  return db.select().from(searchDefinitions).where(eq(searchDefinitions.slug, defIdOrSlug)).get() ?? null;
}

function windowDescription(def: SearchDefinitionRow): string {
  if (def.mode === 'EXACT') {
    if (def.tripType === 'ONE_WAY') {
      return `Depart ${def.departureDate ?? 'TBD'}`;
    }
    return `Depart ${def.departureDate ?? 'TBD'}, return ${def.returnDate ?? 'TBD'}`;
  }
  const minDays = config.demoDefaults.flexibleWindowMinDays;
  const maxDays = config.demoDefaults.flexibleWindowMaxDays;
  const nights =
    def.stayMinNights && def.stayMaxNights
      ? `, ${def.stayMinNights}-${def.stayMaxNights} night stay`
      : '';
  return `Anytime in ${minDays}-${maxDays} days${nights}`;
}

// ---------------------------------------------------------------------------
// Market summary
// ---------------------------------------------------------------------------

function loadCompatibleSnapshots(searchDefinitionId: number): MarketSnapshotRow[] {
  const rows = db
    .select()
    .from(marketSnapshots)
    .where(eq(marketSnapshots.searchDefinitionId, searchDefinitionId))
    .orderBy(asc(marketSnapshots.snapshotAt))
    .all();
  return filterCompatibleSnapshots(rows, config.benchmark.methodologyVersion);
}

function toSnapshotMetrics(row: MarketSnapshotRow) {
  return {
    benchmarkPriceMinor: row.benchmarkPriceMinor,
    fromPriceMinor: row.fromPriceMinor,
    medianPriceMinor: row.medianPriceMinor,
    p25PriceMinor: row.p25PriceMinor,
    validOfferCount: row.validOfferCount,
    uniqueItineraryCount: row.uniqueItineraryCount,
    carrierCount: row.carrierCount,
    nonstopOfferCount: row.nonstopOfferCount,
    oneStopOfferCount: row.oneStopOfferCount,
    freshnessSeconds: row.freshnessSeconds,
    dataQualityScore: row.dataQualityScore,
    snapshotAt: row.snapshotAt,
  };
}

function rowToRecommendationOutput(row: typeof recommendationsTable.$inferSelect): RecommendationOutput {
  return {
    label: row.label,
    confidence: row.confidence,
    score: row.score,
    summary: row.summary,
    observedFacts: row.observedFactsJson,
    inferences: row.inferencesJson,
    counterEvidence: row.counterevidenceJson,
    limitations: row.limitationsJson,
    methodologyVersion: row.methodologyVersion,
  };
}

/** Builds the full MarketSummaryVM for one market. Returns null when no
 * matching search_definition exists (route should 404) or it has no
 * snapshots yet (nothing derived; route should also treat this as
 * not-found-yet). */
export function getMarketSummary(
  origin: string,
  destination: string,
  params: MarketLookupParams = {}
): MarketSummaryVM | null {
  const { definition: def, modeFallback } = resolveDefinitionDetailed(origin, destination, params);
  if (!def) return null;

  const compatible = loadCompatibleSnapshots(def.id);
  if (compatible.length === 0) return null;

  // `current` is always the latest compatible snapshot regardless of its
  // reliability — WP-F1 fix 1 wants the summary card to visibly flag an
  // unreliable current price, not silently fall back to an older snapshot
  // and understate staleness. History used for change%/percentile/fair
  // value comparisons, however, is filtered to reliable points only: a
  // zero-valid-offer snapshot sitting in the middle of the series would
  // otherwise corrupt those statistics (a $0 "previous" price turns any
  // later comparison into a nonsensical +Infinity%/-100% swing).
  const current = compatible[compatible.length - 1];
  const history = compatible.slice(0, -1).filter(isPriceReliable);
  const priceReliable = isPriceReliable(current);

  const originScope = db.select().from(marketScopes).where(eq(marketScopes.id, def.originScopeId)).get();
  const destScope = db
    .select()
    .from(marketScopes)
    .where(eq(marketScopes.id, def.destinationScopeId))
    .get();
  const originAirport = originScope
    ? db.select().from(airports).where(eq(airports.iataCode, originScope.code)).get()
    : undefined;
  const destAirport = destScope
    ? db.select().from(airports).where(eq(airports.iataCode, destScope.code)).get()
    : undefined;

  // change/percentile/fairValue all compare `current`'s price against
  // history — skip computing them (leave null) when current itself isn't
  // reliable, so an unreliable price never surfaces as a misleading "-100%"
  // delta or "cheaper than 100% of history" percentile in ANY consumer
  // (SummaryCard, WhatChangedPanel, the raw API response), not just the
  // one component that explicitly checks priceReliable.
  let change: MarketSummaryVM['change'] = null;
  if (priceReliable && history.length > 0) {
    const prev24h = nearestByTime(history, current.snapshotAt - DAY_MS, 6 * HOUR_MS);
    const prev7d = nearestByTime(history, current.snapshotAt - 7 * DAY_MS, 2 * DAY_MS);
    change = {
      pct24h: prev24h ? pctChange(prev24h.benchmarkPriceMinor, current.benchmarkPriceMinor) : null,
      abs24hMinor: prev24h ? current.benchmarkPriceMinor - prev24h.benchmarkPriceMinor : null,
      pct7d: prev7d ? pctChange(prev7d.benchmarkPriceMinor, current.benchmarkPriceMinor) : null,
    };
  }

  const historyPrices = history.map((s) => s.benchmarkPriceMinor);
  const percentile =
    priceReliable && history.length > 0 ? historicalPercentile(current.benchmarkPriceMinor, historyPrices) : null;
  const fairValue = fairValueRange(historyPrices);

  const recRow = db
    .select()
    .from(recommendationsTable)
    .where(eq(recommendationsTable.searchDefinitionId, def.id))
    .orderBy(desc(recommendationsTable.createdAt))
    .limit(1)
    .get();

  const noteRow = db
    .select()
    .from(analystNotes)
    .where(eq(analystNotes.searchDefinitionId, def.id))
    .orderBy(desc(analystNotes.createdAt))
    .limit(1)
    .get();

  const anchor = getDatasetAnchor();
  const ageSeconds = Math.max(0, Math.round((anchor - current.snapshotAt) / 1000));
  const dataSourceMode = getDataSourceMode();

  return {
    definition: {
      slug: def.slug,
      origin: originScope?.code ?? origin.toUpperCase(),
      destination: destScope?.code ?? destination.toUpperCase(),
      originCity: originAirport?.cityName ?? originScope?.code ?? origin.toUpperCase(),
      destinationCity: destAirport?.cityName ?? destScope?.code ?? destination.toUpperCase(),
      mode: def.mode,
      cabin: def.cabin as Cabin,
      tripType: def.tripType as TripType,
      currency: def.currency,
      windowDescription: windowDescription(def),
    },
    snapshot: toSnapshotMetrics(current),
    change,
    percentile,
    fairValue,
    recommendation: recRow ? rowToRecommendationOutput(recRow) : null,
    analystNote: noteRow
      ? { text: noteRow.noteText, generationMode: noteRow.generationMode, createdAt: noteRow.createdAt }
      : null,
    freshness: {
      ageSeconds,
      isStale: ageSeconds > config.freshness.staleAfterMinutes * 60,
    },
    dataQuality: current.dataQualityScore,
    dataSourceMode,
    demoMode: dataSourceMode === 'DEMO',
    datasetAnchorAt: anchor,
    priceReliable,
    modeFallback,
  };
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export type HistoryRange = '7d' | '30d' | '90d' | 'all';

function rangeToMs(range: HistoryRange): number | null {
  switch (range) {
    case '7d':
      return 7 * DAY_MS;
    case '30d':
      return 30 * DAY_MS;
    case '90d':
      return 90 * DAY_MS;
    case 'all':
      return null;
  }
}

/** Returns compatible-methodology snapshot points within `range`, with
 * gapAfter set when the next point is more than 2x the series' 90th-
 * percentile inter-snapshot interval away. The p90 (not median) matters on
 * mixed cadences: dense intraday sampling in recent days drags the median
 * down to hours, which would falsely mark every ordinary daily step in the
 * older history as a gap and shatter the chart line into isolated dots. */
export function getMarketHistory(defIdOrSlug: number | string, range: HistoryRange): HistoryPointVM[] {
  const def = resolveDefinitionByIdOrSlug(defIdOrSlug);
  if (!def) return [];

  const compatible = loadCompatibleSnapshots(def.id);
  if (compatible.length === 0) return [];

  const anchor = compatible[compatible.length - 1].snapshotAt;
  const windowMs = rangeToMs(range);
  const inRangeAll = windowMs === null ? compatible : compatible.filter((s) => s.snapshotAt >= anchor - windowMs);
  // WP-F1 fix 1: drop points whose price isn't reliable (see
  // HistoryPointVM's doc comment for why exclusion rather than a flag) —
  // the gapAfter logic below then naturally renders a visual break across
  // whatever was removed, since the interval between the surrounding kept
  // points widens.
  const inRange = inRangeAll.filter(isPriceReliable);
  if (inRange.length === 0) return [];

  const intervals: number[] = [];
  for (let i = 1; i < inRange.length; i++) {
    intervals.push(inRange[i].snapshotAt - inRange[i - 1].snapshotAt);
  }
  const sortedIntervals = [...intervals].sort((a, b) => a - b);
  const p90Interval =
    sortedIntervals.length === 0
      ? 0
      : sortedIntervals[Math.min(sortedIntervals.length - 1, Math.floor(sortedIntervals.length * 0.9))];

  return inRange.map((s, i) => {
    const next = inRange[i + 1];
    const gapAfter = p90Interval > 0 && !!next && next.snapshotAt - s.snapshotAt > 2 * p90Interval;
    return {
      snapshotAt: s.snapshotAt,
      benchmarkPriceMinor: s.benchmarkPriceMinor,
      fromPriceMinor: s.fromPriceMinor,
      dataQualityScore: s.dataQualityScore,
      gapAfter,
    };
  });
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface MarketEventFilters {
  eventTypes?: string[];
  since?: number;
  until?: number;
  limit?: number;
}

function toEventVM(row: typeof marketEvents.$inferSelect): MarketEventVM {
  return {
    id: row.id,
    searchDefinitionId: row.searchDefinitionId,
    eventType: row.eventType as MarketEventVM['eventType'],
    eventStartAt: row.eventStartAt,
    eventEndAt: row.eventEndAt ?? undefined,
    severity: row.severity,
    confidence: row.confidence,
    observedFacts: row.observedFactsJson,
    inference: row.inferenceJson ?? undefined,
    supportingRecordIds: row.supportingRecordIds,
    detectionRuleVersion: row.detectionRuleVersion,
    createdAt: row.createdAt,
    label: EVENT_TYPE_LABELS[row.eventType as MarketEventVM['eventType']] ?? row.eventType,
    eventStartIso: new Date(row.eventStartAt).toISOString(),
    eventEndIso: row.eventEndAt ? new Date(row.eventEndAt).toISOString() : null,
    createdIso: new Date(row.createdAt).toISOString(),
  };
}

export function getMarketEvents(
  defIdOrSlug: number | string,
  filters: MarketEventFilters = {}
): MarketEventVM[] {
  const def = resolveDefinitionByIdOrSlug(defIdOrSlug);
  if (!def) return [];

  let rows = db
    .select()
    .from(marketEvents)
    .where(eq(marketEvents.searchDefinitionId, def.id))
    .orderBy(desc(marketEvents.eventStartAt))
    .all();

  if (filters.eventTypes && filters.eventTypes.length > 0) {
    const wanted = new Set(filters.eventTypes);
    rows = rows.filter((r) => wanted.has(r.eventType));
  }
  if (filters.since !== undefined) {
    rows = rows.filter((r) => r.eventStartAt >= filters.since!);
  }
  if (filters.until !== undefined) {
    rows = rows.filter((r) => r.eventStartAt <= filters.until!);
  }
  if (filters.limit !== undefined) {
    rows = rows.slice(0, filters.limit);
  }

  return rows.map(toEventVM);
}

// ---------------------------------------------------------------------------
// Current offers
// ---------------------------------------------------------------------------

export function getCurrentOffers(defIdOrSlug: number | string): OfferRowVM[] {
  const def = resolveDefinitionByIdOrSlug(defIdOrSlug);
  if (!def) return [];

  const latestRun = db
    .select()
    .from(searchRuns)
    .where(and(eq(searchRuns.searchDefinitionId, def.id), eq(searchRuns.status, 'SUCCESS')))
    .orderBy(desc(searchRuns.completedAt))
    .limit(1)
    .get();
  if (!latestRun) return [];

  const rows = loadOfferRowsForSearchRunIds([latestRun.id]);
  const outbound = rows
    .filter((r) => !r.qualityFlags.includes('SUSPECTED_ANOMALY'))
    .sort((a, b) => a.totalPriceMinor - b.totalPriceMinor);

  return outbound.map((r) => {
    const segments = r.segmentsJson as { departureAt: string; arrivalAt: string }[];
    const first = segments[0];
    const last = segments[segments.length - 1];
    return {
      carrierCode: r.validatingCarrier,
      carrierName: carrierName(r.validatingCarrier),
      priceMinor: r.totalPriceMinor,
      currency: r.currency,
      stops: r.stopCount,
      durationMinutes: r.durationMinutes,
      departIso: first?.departureAt ?? '',
      arriveIso: last?.arrivalAt ?? '',
      fareBrand: r.fareBrand ?? null,
      seatsRemaining: r.seatsRemaining ?? null,
      lastObservedAt: r.observedAt,
      outboundUrl: r.outboundUrl ?? null,
      qualityFlags: r.qualityFlags,
    };
  });
}

// ---------------------------------------------------------------------------
// Market pulse
// ---------------------------------------------------------------------------

function buildMarketCard(
  def: SearchDefinitionRow,
  origin: string,
  destination: string,
  current: MarketSnapshotRow,
  changePct: number | null,
  changeAbsMinor: number | null,
  percentile: number | null,
  confidence: ConfidenceLevel | null,
  note: string | null
): MarketCardVM {
  return {
    origin,
    destination,
    slug: def.slug,
    benchmarkPriceMinor: current.benchmarkPriceMinor,
    changePct,
    changeAbsMinor,
    windowLabel: windowDescription(def),
    percentile,
    confidence,
    dataQualityLabel: dataQualityLabel(current.dataQualityScore),
    note,
  };
}

/** Assembles a deterministic market-pulse brief from already-derived
 * snapshots/recommendations/events. Quality-gated per PRD §13.3
 * (config.pulse + config.freshness + config.benchmark.methodologyVersion). */
export function getMarketPulse(): PulseVM {
  const anchor = getDatasetAnchor();
  const defs = db.select().from(searchDefinitions).where(eq(searchDefinitions.active, true)).all();

  type Candidate = {
    def: SearchDefinitionRow;
    origin: string;
    destination: string;
    current: MarketSnapshotRow;
    changePct: number | null;
    changeAbsMinor: number | null;
    percentile: number | null;
    confidence: ConfidenceLevel | null;
  };

  const candidates: Candidate[] = [];

  for (const def of defs) {
    const compatible = loadCompatibleSnapshots(def.id);
    if (compatible.length === 0) continue;

    const current = compatible[compatible.length - 1];
    const ageSeconds = Math.max(0, Math.round((anchor - current.snapshotAt) / 1000));
    const isFresh = ageSeconds <= config.freshness.staleAfterMinutes * 60;
    if (!isFresh) continue;
    if (current.dataQualityScore < config.pulse.minDataQualityScore) continue;
    // WP-F1 fix 1: config.pulse.minDataQualityScore (0.5) already excludes
    // the zero-valid-offer case (dataQualityScore 0) that motivated this
    // check, but it's stricter on quality alone — a snapshot could clear
    // 0.5 overall quality while its benchmarkPriceMinor is still <= 0 (or
    // near enough to be unreliable per config.display.minQualityForPrice).
    // Explicit here so a market card never shows a $0/near-$0 "drop".
    if (!isPriceReliable(current)) continue;

    const history = compatible.slice(0, -1).filter(isPriceReliable);
    const prev24h = nearestByTime(history, current.snapshotAt - DAY_MS, 6 * HOUR_MS);
    const changePct = prev24h ? pctChange(prev24h.benchmarkPriceMinor, current.benchmarkPriceMinor) : null;
    const changeAbsMinor = prev24h ? current.benchmarkPriceMinor - prev24h.benchmarkPriceMinor : null;

    const historyPrices = history.map((s) => s.benchmarkPriceMinor);
    const percentile = history.length > 0 ? historicalPercentile(current.benchmarkPriceMinor, historyPrices) : null;

    const recRow = db
      .select()
      .from(recommendationsTable)
      .where(eq(recommendationsTable.searchDefinitionId, def.id))
      .orderBy(desc(recommendationsTable.createdAt))
      .limit(1)
      .get();

    const originScope = db.select().from(marketScopes).where(eq(marketScopes.id, def.originScopeId)).get();
    const destScope = db
      .select()
      .from(marketScopes)
      .where(eq(marketScopes.id, def.destinationScopeId))
      .get();
    if (!originScope || !destScope) continue;

    candidates.push({
      def,
      origin: originScope.code,
      destination: destScope.code,
      current,
      changePct,
      changeAbsMinor,
      percentile,
      confidence: recRow?.confidence ?? null,
    });
  }

  const moveGate = config.pulse.minMoveAbsPct;
  const cap = config.pulse.maxCardsPerSection;

  const biggestDropsRaw = candidates
    .filter((c) => c.changePct !== null && c.changePct <= -moveGate)
    .sort((a, b) => (a.changePct ?? 0) - (b.changePct ?? 0))
    .slice(0, cap);

  const newlyFavorableRaw = candidates
    .filter((c) => c.confidence !== null)
    .filter((c) => (c.percentile ?? 0) >= 100 - config.eventThresholds.priceDropPct * 2)
    .filter((c) => !biggestDropsRaw.some((d) => d.def.id === c.def.id))
    .sort((a, b) => (b.percentile ?? 0) - (a.percentile ?? 0))
    .slice(0, cap);

  const biggestDrops = biggestDropsRaw.map((c) =>
    buildMarketCard(
      c.def,
      c.origin,
      c.destination,
      c.current,
      c.changePct,
      c.changeAbsMinor,
      c.percentile,
      c.confidence,
      `Benchmark moved ${c.changePct?.toFixed(1)}% in the last 24h.`
    )
  );

  const newlyFavorable = newlyFavorableRaw.map((c) =>
    buildMarketCard(
      c.def,
      c.origin,
      c.destination,
      c.current,
      c.changePct,
      c.changeAbsMinor,
      c.percentile,
      c.confidence,
      c.percentile !== null
        ? c.percentile >= 99.5
          ? 'Cheapest level in observed history.'
          : c.percentile < 1
            ? 'At the high end of observed history.'
            : `Cheaper than ${c.percentile.toFixed(0)}% of observed history.`
        : null
    )
  );

  const allEvents = db
    .select()
    .from(marketEvents)
    .orderBy(desc(marketEvents.eventStartAt))
    .limit(50)
    .all();
  const unusualTypes = new Set(['VOLATILITY_SPIKE', 'POSSIBLE_CARRIER_MATCH', 'DATA_ANOMALY', 'NEW_HISTORICAL_LOW']);
  const defById = new Map(defs.map((d) => [d.id, d]));
  const scopeCache = new Map<number, string>();
  function scopeCode(scopeId: number): string {
    if (!scopeCache.has(scopeId)) {
      const scope = db.select().from(marketScopes).where(eq(marketScopes.id, scopeId)).get();
      scopeCache.set(scopeId, scope?.code ?? '');
    }
    return scopeCache.get(scopeId)!;
  }

  const unusualEvents = allEvents
    .filter((e) => unusualTypes.has(e.eventType) && e.eventStartAt >= anchor - 48 * HOUR_MS)
    .slice(0, cap)
    .map((e) => {
      const def = defById.get(e.searchDefinitionId);
      return {
        marketSlug: def?.slug ?? '',
        origin: def ? scopeCode(def.originScopeId) : '',
        destination: def ? scopeCode(def.destinationScopeId) : '',
        event: toEventVM(e),
      };
    })
    .filter((e) => e.marketSlug !== '');

  const briefText = `Tracking ${defs.length} market${defs.length === 1 ? '' : 's'}. ${biggestDrops.length} price drop${biggestDrops.length === 1 ? '' : 's'} of ${moveGate}%+ in the last 24h. ${newlyFavorable.length} market${newlyFavorable.length === 1 ? '' : 's'} newly look${newlyFavorable.length === 1 ? 's' : ''} favorable. ${unusualEvents.length} unusual signal${unusualEvents.length === 1 ? '' : 's'} detected in the last 48h.`;

  const dataSourceMode = getDataSourceMode();

  return {
    brief: { text: briefText, generatedAt: anchor, mode: 'TEMPLATE' },
    biggestDrops,
    newlyFavorable,
    unusualEvents,
    freshness: { datasetAnchorAt: anchor, generatedAt: Date.now() },
    dataSourceMode,
    demoMode: dataSourceMode === 'DEMO',
  };
}

// ---------------------------------------------------------------------------
// Tracked markets (WP-F1 fix 3)
// ---------------------------------------------------------------------------

export interface TrackedMarketSummary {
  origin: string;
  destination: string;
  originCity: string;
  destinationCity: string;
  /** search_definitions.slug for the FLEXIBLE definition — usable directly
   * with buildMarketUrl(origin, destination, { mode: 'flexible' }). */
  slug: string;
}

/** Active FLEXIBLE-mode definitions, one card per market (a market can have
 * both a FLEXIBLE and an EXACT definition; FLEXIBLE is the one every market
 * always has and the one canonical /market/[origin]/[destination] links to
 * — see resolveDefinition's default). Used by the not-found page (WP-F1 fix
 * 3) to show what IS tracked instead of leaving "try one of the markets
 * below" with nothing underneath it. Sorted alphabetically by
 * origin+destination, capped at `limit`. */
export function listTrackedMarkets(limit = 12): TrackedMarketSummary[] {
  const defs = db
    .select()
    .from(searchDefinitions)
    .where(and(eq(searchDefinitions.active, true), eq(searchDefinitions.mode, 'FLEXIBLE')))
    .all();

  const results: TrackedMarketSummary[] = [];
  for (const def of defs) {
    const originScope = db.select().from(marketScopes).where(eq(marketScopes.id, def.originScopeId)).get();
    const destScope = db.select().from(marketScopes).where(eq(marketScopes.id, def.destinationScopeId)).get();
    if (!originScope || !destScope) continue;

    const originAirport = db.select().from(airports).where(eq(airports.iataCode, originScope.code)).get();
    const destAirport = db.select().from(airports).where(eq(airports.iataCode, destScope.code)).get();

    results.push({
      origin: originScope.code,
      destination: destScope.code,
      originCity: originAirport?.cityName ?? originScope.code,
      destinationCity: destAirport?.cityName ?? destScope.code,
      slug: def.slug,
    });
  }

  return results
    .sort((a, b) => `${a.origin}${a.destination}`.localeCompare(`${b.origin}${b.destination}`))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Location search
// ---------------------------------------------------------------------------

export interface LocationResult {
  iataCode: string;
  name: string;
  cityName: string;
  countryCode: string;
}

/** Prefix/substring match on seeded airports, including city names. Prefix
 * matches on the IATA code rank first, then prefix matches on city/name,
 * then substring matches anywhere. */
export function searchLocations(q: string, limit = 10): LocationResult[] {
  const query = q.trim().toLowerCase();
  if (query.length === 0) return [];

  const rows = db.select().from(airports).where(eq(airports.active, true)).all();

  function rank(a: typeof rows[number]): number {
    const code = a.iataCode.toLowerCase();
    const city = a.cityName.toLowerCase();
    const name = a.name.toLowerCase();
    if (code === query) return 0;
    if (code.startsWith(query)) return 1;
    if (city.startsWith(query)) return 2;
    if (name.startsWith(query)) return 3;
    if (code.includes(query) || city.includes(query) || name.includes(query)) return 4;
    return -1;
  }

  return rows
    .map((a) => ({ a, r: rank(a) }))
    .filter(({ r }) => r >= 0)
    .sort((x, y) => x.r - y.r || x.a.cityName.localeCompare(y.a.cityName))
    .slice(0, limit)
    .map(({ a }) => ({
      iataCode: a.iataCode,
      name: a.name,
      cityName: a.cityName,
      countryCode: a.countryCode,
    }));
}
