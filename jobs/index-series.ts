// deriveIndexSeries: the daily Fare Terminal Index. Pure DB compute -- no
// API calls, unlike jobs/heatmap.ts / jobs/deals.ts / jobs/related.ts. Reads
// market_snapshots (already populated by jobs/snapshots.ts from whichever
// provider is active) and writes one index_values row per day.
//
// ---------------------------------------------------------------------------
// Methodology (index-v1)
// ---------------------------------------------------------------------------
// For each active tracked route, on each UTC calendar day D we take that
// route's most recently observed benchmark price as of D (the same
// benchmarkPriceMinor market_snapshots already computes -- "forward-filled"
// from whenever it was last observed, since different routes snapshot on
// different cadences) and divide it by that route's own trailing
// `config.index.trailingMedianDays`-day median benchmark price. This gives
// a per-route ratio: "how does today's price compare to this route's own
// recent normal?" A ratio of 1.0 means "right at its own trailing median";
// 1.10 means "10% above its own recent norm."
//
// The day's raw index value is the mean of that ratio across every route
// that has data by day D, then the WHOLE SERIES is rebased so the anchor
// day (the first day at least `config.index.minRosterCoveragePct`% of the
// active roster has data) reads exactly 100 -- i.e.
// value(D) = 100 * rawMeanRatio(D) / rawMeanRatio(anchorDay).
//
// Why this shape, not a simpler "average benchmark price across routes":
//  - Using each route's OWN trailing median as its reference (rather than a
//    single global reference price) keeps a $900 long-haul route from
//    dominating a $200 domestic route in the average -- both contribute a
//    comparably-scaled ratio instead of a raw dollar figure.
//  - Rebasing to 100 at the anchor day, rather than emitting the raw ratio
//    mean directly, gives the index the familiar "100 = baseline, above/
//    below is % away from baseline" reading real-world price indices use,
//    and absorbs any small structural bias in the ratio itself (e.g. if the
//    trailing-median construction tends to sit a few points off of 1.0 on
//    average across the roster) into the baseline rather than the trend.
//  - The whole thing is intentionally simple and explainable in one
//    sentence for the UI: "how today's fares compare to their own recent
//    normal, averaged across the tracked roster, indexed to 100 at launch."
//
// Idempotent: re-running upserts (onConflictDoUpdate) each day's row keyed
// on index_date, so a re-run after new snapshots land recomputes cleanly.

import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { indexValues, marketSnapshots, searchDefinitions } from '@/db/schema';
import { config } from '@/domain/config';
import { median } from '@/domain/history/stats';

import { isMainModule, runCli } from './_shared';

const DAY_MS = 86_400_000;

export const INDEX_METHODOLOGY_NOTE =
  `Fare Terminal Index (${config.index.methodologyVersion}): for each actively tracked route, each day we take its most recently observed benchmark price and divide it by that route's own trailing ${config.index.trailingMedianDays}-day median benchmark price -- a "how does today compare to this route's own recent normal" ratio. The index value is the average of that ratio across every route with data that day, rebased to 100 on the day at least ${config.index.minRosterCoveragePct}% of the tracked roster first had data. Above 100 means fares are, on average, running above their own recent norms across the tracked roster; below 100 means they're running below. Using each route's own trailing median (rather than one global reference price) keeps routes at very different price levels (e.g. a $200 domestic hop vs. a $900 long-haul) from distorting the average.`;

function toUtcDateKey(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function dateKeyToEpochStart(dateKey: string): number {
  return Date.parse(`${dateKey}T00:00:00.000Z`);
}

function dateKeyToEpochEnd(dateKey: string): number {
  return dateKeyToEpochStart(dateKey) + DAY_MS - 1;
}

interface RouteSnapshot {
  snapshotAt: number;
  benchmarkPriceMinor: number;
}

export interface IndexSeriesSummary {
  routesConsidered: number;
  anchorDate: string | null;
  daysComputed: number;
  daysUpserted: number;
}

/** Loads, per active search_definitions id, its market_snapshots rows
 * (compatible methodology version only, matching how the rest of the app
 * gates on config.benchmark.methodologyVersion), sorted ascending by
 * snapshotAt. */
function loadRouteSnapshots(): Map<number, RouteSnapshot[]> {
  const activeDefIds = db
    .select({ id: searchDefinitions.id })
    .from(searchDefinitions)
    .where(eq(searchDefinitions.active, true))
    .all()
    .map((r) => r.id);

  const byRoute = new Map<number, RouteSnapshot[]>();
  for (const defId of activeDefIds) {
    const rows = db
      .select({ snapshotAt: marketSnapshots.snapshotAt, benchmarkPriceMinor: marketSnapshots.benchmarkPriceMinor })
      .from(marketSnapshots)
      .where(
        and(
          eq(marketSnapshots.searchDefinitionId, defId),
          eq(marketSnapshots.methodologyVersion, config.benchmark.methodologyVersion)
        )
      )
      .all()
      .sort((a, b) => a.snapshotAt - b.snapshotAt);
    if (rows.length > 0) {
      byRoute.set(defId, rows);
    }
  }
  return byRoute;
}

/** Per-route running state while scanning days in ascending order: both
 * pointers only ever move forward, since both "most recent snapshot at or
 * before dayEnd" and "trailing-window start" are monotonic in D. */
interface RouteScanState {
  snapshots: RouteSnapshot[];
  currentIdx: number; // index of the most recent snapshot at or before the day being evaluated, or -1 if none yet.
  windowStartIdx: number; // index of the first snapshot within the trailing window.
}

function advanceRouteState(state: RouteScanState, dayEnd: number, windowStart: number): void {
  while (
    state.currentIdx + 1 < state.snapshots.length &&
    state.snapshots[state.currentIdx + 1].snapshotAt <= dayEnd
  ) {
    state.currentIdx += 1;
  }
  while (
    state.windowStartIdx <= state.currentIdx &&
    state.snapshots[state.windowStartIdx].snapshotAt < windowStart
  ) {
    state.windowStartIdx += 1;
  }
}

export function deriveIndexSeries(): IndexSeriesSummary {
  const byRoute = loadRouteSnapshots();
  const routeIds = Array.from(byRoute.keys());

  const summary: IndexSeriesSummary = {
    routesConsidered: routeIds.length,
    anchorDate: null,
    daysComputed: 0,
    daysUpserted: 0,
  };

  if (routeIds.length === 0) {
    return summary;
  }

  let earliest = Infinity;
  let latest = -Infinity;
  for (const rows of byRoute.values()) {
    earliest = Math.min(earliest, rows[0].snapshotAt);
    latest = Math.max(latest, rows[rows.length - 1].snapshotAt);
  }

  const firstDateKey = toUtcDateKey(earliest);
  const lastDateKey = toUtcDateKey(latest);

  const states = new Map<number, RouteScanState>();
  for (const [defId, snapshots] of byRoute) {
    states.set(defId, { snapshots, currentIdx: -1, windowStartIdx: 0 });
  }

  const trailingWindowMs = config.index.trailingMedianDays * DAY_MS;
  const minCoverageFraction = config.index.minRosterCoveragePct / 100;

  let anchorRawMean: number | null = null;
  let dateKey = firstDateKey;
  const rowsToUpsert: { indexDate: string; value: number; routeCount: number }[] = [];

  // Loop over calendar days from the roster's earliest snapshot to its
  // latest. Bounded by real data on both ends, so this never runs away —
  // at most ~one iteration per day the DB has ever seen data for this
  // roster, which for a background sweep job is a small number.
  while (true) {
    const dayEnd = dateKeyToEpochEnd(dateKey);
    const windowStart = dayEnd - trailingWindowMs;

    const ratios: number[] = [];
    for (const defId of routeIds) {
      const state = states.get(defId);
      if (!state) continue;
      advanceRouteState(state, dayEnd, windowStart);
      if (state.currentIdx < 0) continue; // route has no data yet as of this day.

      const current = state.snapshots[state.currentIdx].benchmarkPriceMinor;
      const windowSnapshots = state.snapshots.slice(state.windowStartIdx, state.currentIdx + 1);
      const trailingMedian = median(windowSnapshots.map((s) => s.benchmarkPriceMinor));
      if (trailingMedian > 0) {
        ratios.push(current / trailingMedian);
      }
    }

    summary.daysComputed += 1;
    const coverageFraction = ratios.length / routeIds.length;

    if (anchorRawMean === null) {
      if (coverageFraction >= minCoverageFraction && ratios.length > 0) {
        anchorRawMean = ratios.reduce((sum, r) => sum + r, 0) / ratios.length;
        summary.anchorDate = dateKey;
        rowsToUpsert.push({ indexDate: dateKey, value: 100, routeCount: ratios.length });
      }
      // Before the anchor day, no index value is emitted at all (the index
      // "doesn't exist yet" — see module doc comment).
    } else if (ratios.length > 0) {
      const rawMean = ratios.reduce((sum, r) => sum + r, 0) / ratios.length;
      const value = 100 * (rawMean / anchorRawMean);
      rowsToUpsert.push({ indexDate: dateKey, value, routeCount: ratios.length });
    }

    if (dateKey === lastDateKey) break;
    dateKey = toUtcDateKey(dateKeyToEpochStart(dateKey) + DAY_MS);
  }

  for (const row of rowsToUpsert) {
    db.insert(indexValues)
      .values({
        indexDate: row.indexDate,
        value: row.value,
        routeCount: row.routeCount,
        methodologyVersion: config.index.methodologyVersion,
      })
      .onConflictDoUpdate({
        target: indexValues.indexDate,
        set: { value: row.value, routeCount: row.routeCount, methodologyVersion: config.index.methodologyVersion },
      })
      .run();
    summary.daysUpserted += 1;
  }

  return summary;
}

if (isMainModule(import.meta.url)) {
  void runCli(() => deriveIndexSeries());
}
