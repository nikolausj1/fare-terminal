// Read layer for the Fare Terminal Index (index_values, computed by
// jobs/index-series.ts — see that file's module doc comment for the full
// methodology derivation). This file only reads; the methodology note
// string below is a display-layer copy of the same explanation embedded in
// jobs/index-series.ts's INDEX_METHODOLOGY_NOTE, kept independent here
// (rather than importing across the jobs/ -> lib/markets boundary) so the
// read layer doesn't depend on a write-side job module — if the formula
// ever changes, update both jobs/index-series.ts's doc comment/constant AND
// this file's note together.
//
// NEW FILE per WP-F2 scope — additions only, no changes to
// lib/markets/queries.ts or view-models.ts (a different WP is concurrently
// fixing bugs there). This is the Wave-2 UI contract for the index.

import { desc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { indexValues } from '@/db/schema';
import { config } from '@/domain/config';

export interface IndexPointVM {
  date: string; // YYYY-MM-DD
  value: number;
  routeCount: number;
}

export interface IndexTodayVM {
  value: number;
  /** Percent change vs. the prior calendar day's index value; null if that
   * day has no index_values row (e.g. right at the anchor day). */
  changePct1d: number | null;
  /** Percent change vs. the index value 7 calendar days prior; null if that
   * day has no index_values row. */
  changePct7d: number | null;
  methodologyNote: string;
}

export const INDEX_METHODOLOGY_NOTE =
  `Fare Terminal Index (${config.index.methodologyVersion}): for each actively tracked route, each day we take its most recently observed benchmark price and divide it by that route's own trailing ${config.index.trailingMedianDays}-day median benchmark price -- a "how does today compare to this route's own recent normal" ratio. The index value is the average of that ratio across every route with data that day, rebased to 100 on the day at least ${config.index.minRosterCoveragePct}% of the tracked roster first had data. Above 100 means fares are, on average, running above their own recent norms across the tracked roster; below 100 means they're running below. Using each route's own trailing median (rather than one global reference price) keeps routes at very different price levels (e.g. a $200 domestic hop vs. a $900 long-haul) from distorting the average.`;

const DAY_MS = 86_400_000;

function shiftDateKey(dateKey: string, deltaDays: number): string {
  const ms = Date.parse(`${dateKey}T00:00:00.000Z`) + deltaDays * DAY_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

function pctChange(from: number, to: number): number | null {
  if (from === 0) return null;
  return ((to - from) / from) * 100;
}

/** Returns up to the last `days` calendar days of index_values, oldest
 * first (chart-ready order). Fewer than `days` points are returned if the
 * index hasn't been running that long yet (it doesn't exist before the
 * anchor day — see jobs/index-series.ts). */
export function getIndexSeries(days = 90): IndexPointVM[] {
  const rows = db.select().from(indexValues).orderBy(desc(indexValues.indexDate)).limit(days).all();

  return rows
    .map((row) => ({ date: row.indexDate, value: row.value, routeCount: row.routeCount }))
    .reverse();
}

/** The latest available index value plus 1d/7d percent change, or null if
 * the index has no data at all yet (e.g. real-data mode before the first
 * pipeline run with a travelpayouts-backed roster reaches the anchor-day
 * coverage threshold). */
export function getIndexToday(): IndexTodayVM | null {
  const latest = db.select().from(indexValues).orderBy(desc(indexValues.indexDate)).limit(1).get();
  if (!latest) return null;

  const prior1d = db
    .select()
    .from(indexValues)
    .where(eq(indexValues.indexDate, shiftDateKey(latest.indexDate, -1)))
    .get();
  const prior7d = db
    .select()
    .from(indexValues)
    .where(eq(indexValues.indexDate, shiftDateKey(latest.indexDate, -7)))
    .get();

  return {
    value: latest.value,
    changePct1d: prior1d ? pctChange(prior1d.value, latest.value) : null,
    changePct7d: prior7d ? pctChange(prior7d.value, latest.value) : null,
    methodologyNote: INDEX_METHODOLOGY_NOTE,
  };
}
