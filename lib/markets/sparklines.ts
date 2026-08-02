// Batched sparkline read layer for home-page route cards (WP-F3). One SELECT
// across every requested route's search_definitions.slug, downsampled per
// route to at most `MAX_POINTS` values -- avoids an N+1 query per card (the
// naive approach of calling getMarketHistory() once per card). Unreliable
// snapshot points (see isPriceReliable below) are excluded before
// downsampling, mirroring the rule lib/markets/queries.ts applies to
// history/pulse: a snapshot derived from zero valid offers is not a real
// price and would corrupt the trend line.
//
// NEW FILE for WP-F3 — additions only, no changes to lib/markets/queries.ts
// or view-models.ts (those are shared infrastructure other concurrent work
// packages also touch this wave).

import { asc, inArray } from 'drizzle-orm';

import { db } from '@/db';
import { marketSnapshots, searchDefinitions } from '@/db/schema';
import { config } from '@/domain/config';
import { filterCompatibleSnapshots } from '@/domain/history';

const DAY_MS = 86_400_000;
const MAX_POINTS = 20;

type MarketSnapshotRow = typeof marketSnapshots.$inferSelect;

/** Same eligibility rule as lib/markets/queries.ts's private isPriceReliable
 * (WP-F1 fix 1): a snapshot with benchmarkPriceMinor <= 0 or a data-quality
 * score below config.display.minQualityForPrice is not a trustworthy price
 * point. Duplicated here rather than imported to keep this read-only file
 * decoupled from the concurrently-owned queries.ts module. */
function isPriceReliable(s: { benchmarkPriceMinor: number; dataQualityScore: number }): boolean {
  return s.benchmarkPriceMinor > 0 && s.dataQualityScore >= config.display.minQualityForPrice;
}

/** Evenly samples `points` down to at most `max` values, always keeping the
 * first and last point so the visible trend's start/end never gets
 * dropped. No-op when `points.length <= max`. Pure + exported for unit
 * testing (see tests/unit/sparklines.test.ts). */
export function downsampleSeries(points: number[], max: number): number[] {
  if (max <= 0) return [];
  if (points.length <= max) return points;
  if (max === 1) return [points[points.length - 1]];

  const step = (points.length - 1) / (max - 1);
  const result: number[] = [];
  for (let i = 0; i < max; i++) {
    result.push(points[Math.round(i * step)]);
  }
  return result;
}

/**
 * Batched trailing benchmark-price series for a set of routes, keyed by
 * search_definitions.slug. Fetches every requested route's market_snapshots
 * in ONE query (not one query per route), groups + filters + downsamples in
 * memory. A route with fewer than 2 reliable, in-window points is simply
 * absent from the returned Map — callers should treat a missing key the
 * same as an explicit null (components/charts/Sparkline.tsx already renders
 * nothing for < 2 points, so `sparklines.get(slug) ?? null` is always safe).
 */
export function getSparklines(slugs: string[], days = 30): Map<string, number[]> {
  const result = new Map<string, number[]>();
  if (slugs.length === 0) return result;

  const defs = db
    .select({ id: searchDefinitions.id, slug: searchDefinitions.slug })
    .from(searchDefinitions)
    .where(inArray(searchDefinitions.slug, slugs))
    .all();
  if (defs.length === 0) return result;

  const slugByDefId = new Map(defs.map((d) => [d.id, d.slug]));
  const defIds = defs.map((d) => d.id);

  // ONE query for every requested route's snapshots.
  const rows = db
    .select()
    .from(marketSnapshots)
    .where(inArray(marketSnapshots.searchDefinitionId, defIds))
    .orderBy(asc(marketSnapshots.snapshotAt))
    .all();

  const byDefId = new Map<number, MarketSnapshotRow[]>();
  for (const row of rows) {
    const list = byDefId.get(row.searchDefinitionId);
    if (list) list.push(row);
    else byDefId.set(row.searchDefinitionId, [row]);
  }

  for (const [defId, defRows] of byDefId) {
    const slug = slugByDefId.get(defId);
    if (!slug) continue;

    const compatible = filterCompatibleSnapshots(defRows, config.benchmark.methodologyVersion);
    const reliable = compatible.filter(isPriceReliable);
    if (reliable.length < 2) continue;

    // Window relative to this route's own latest reliable point (mirrors
    // getMarketHistory's per-definition anchor) rather than a single global
    // anchor, so a route whose data lags the others still gets its own
    // last-`days`-of-data trend instead of an empty one.
    const routeAnchor = reliable[reliable.length - 1].snapshotAt;
    const windowed = reliable.filter((s) => s.snapshotAt >= routeAnchor - days * DAY_MS);
    if (windowed.length < 2) continue;

    result.set(
      slug,
      downsampleSeries(
        windowed.map((s) => s.benchmarkPriceMinor),
        MAX_POINTS
      )
    );
  }

  return result;
}
