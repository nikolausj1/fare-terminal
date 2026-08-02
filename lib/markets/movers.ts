// Read layer for the home page's "Top movers (24h)" section (WP-F3). The
// existing getMarketPulse() (lib/markets/queries.ts) only returns already
// GATED subsets — biggestDrops requires |pct24h| >= config.pulse.minMoveAbsPct
// (5%) and newlyFavorable requires a percentile threshold — which on real
// data can both come back thin or empty at once (the WP-F3 audit's "no
// qualifying drops" finding: 0 drops + 2 favorable out of 9 fresh, reliable
// routes on data/real.db). This file independently derives the FULL
// fresh+reliable candidate pool using the same eligibility rules
// getMarketPulse applies (fresh per config.freshness.staleAfterMinutes,
// quality >= config.pulse.minDataQualityScore, price reliable per
// config.display.minQualityForPrice) so the home page can rank every
// eligible route by |pct24h| and cap at N, instead of gating section
// visibility on a move-size threshold. The old gate is kept as an extra
// `qualifiesAsDrop` badge on top of the ranking, not a filter.
//
// This intentionally mirrors (rather than imports) the candidate-building
// loop in lib/markets/queries.ts#getMarketPulse — see that function's own
// comments for the rationale behind each check. If that logic changes, keep
// this file's copy in sync.
//
// NEW FILE for WP-F3 — additions only, no changes to lib/markets/queries.ts
// or view-models.ts (shared infrastructure other concurrent work packages
// also touch this wave).

import { asc, desc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { marketScopes, marketSnapshots, recommendations as recommendationsTable, searchDefinitions } from '@/db/schema';
import { config } from '@/domain/config';
import { filterCompatibleSnapshots, historicalPercentile } from '@/domain/history';

import { getDatasetAnchor } from './queries';
import { nearestByTime, pctChange } from './snapshotUtils';
import type { MarketCardVM } from './view-models';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

type SearchDefinitionRow = typeof searchDefinitions.$inferSelect;

/** Same eligibility rule as lib/markets/queries.ts's private isPriceReliable
 * (WP-F1 fix 1). Duplicated (not imported) — see module doc comment. */
function isPriceReliable(s: { benchmarkPriceMinor: number; dataQualityScore: number }): boolean {
  return s.benchmarkPriceMinor > 0 && s.dataQualityScore >= config.display.minQualityForPrice;
}

/** Duplicate of queries.ts's private dataQualityLabel — same
 * config.recommendationScoring.confidenceBands thresholds. */
function dataQualityLabel(score: number): 'HIGH' | 'MEDIUM' | 'LOW' {
  const bands = config.recommendationScoring.confidenceBands;
  if (score >= bands.highMinQuality) return 'HIGH';
  if (score >= bands.moderateMinQuality) return 'MEDIUM';
  return 'LOW';
}

/** Duplicate of queries.ts's private windowDescription. */
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
    def.stayMinNights && def.stayMaxNights ? `, ${def.stayMinNights}-${def.stayMaxNights} night stay` : '';
  return `Anytime in ${minDays}-${maxDays} days${nights}`;
}

export interface MoverVM extends MarketCardVM {
  /** True when this route also clears the pre-existing "qualifying drop"
   * gate (config.pulse.minMoveAbsPct) — surfaced as an extra badge in the
   * UI, not a section-visibility gate (that gate is what made "Biggest
   * drops" empty far too often on real data — see module doc comment). */
  qualifiesAsDrop: boolean;
}

interface MoverCandidate {
  slug: string;
  changePct: number | null;
}

/** Pure ranking step: sorts candidates by |changePct| descending (routes
 * with no computable 24h change sort last, not first — a missing delta
 * isn't "no movement"), caps at `limit`, and flags qualifiesAsDrop. Kept
 * separate from the DB-fetching loop in getTopMovers so it's unit-testable
 * without a database. */
export function rankMoversByAbsChange<T extends MoverCandidate>(
  candidates: T[],
  limit: number
): (T & { qualifiesAsDrop: boolean })[] {
  return [...candidates]
    .sort((a, b) => {
      const av = a.changePct === null ? -1 : Math.abs(a.changePct);
      const bv = b.changePct === null ? -1 : Math.abs(b.changePct);
      return bv - av;
    })
    .slice(0, Math.max(0, limit))
    .map((c) => ({
      ...c,
      qualifiesAsDrop: c.changePct !== null && c.changePct <= -config.pulse.minMoveAbsPct,
    }));
}

/** Every active definition's latest snapshot, filtered to the same
 * fresh + quality + price-reliable eligibility getMarketPulse uses, ranked
 * by |pct24h| and capped at `limit`. Never gated on move size — see module
 * doc comment. */
export function getTopMovers(limit = 6): MoverVM[] {
  const anchor = getDatasetAnchor();
  const defs = db.select().from(searchDefinitions).where(eq(searchDefinitions.active, true)).all();

  const candidates: (MarketCardVM & { changePct: number | null })[] = [];

  for (const def of defs) {
    const rows = db
      .select()
      .from(marketSnapshots)
      .where(eq(marketSnapshots.searchDefinitionId, def.id))
      .orderBy(asc(marketSnapshots.snapshotAt))
      .all();
    const compatible = filterCompatibleSnapshots(rows, config.benchmark.methodologyVersion);
    if (compatible.length === 0) continue;

    const current = compatible[compatible.length - 1];
    const ageSeconds = Math.max(0, Math.round((anchor - current.snapshotAt) / 1000));
    if (ageSeconds > config.freshness.staleAfterMinutes * 60) continue;
    if (current.dataQualityScore < config.pulse.minDataQualityScore) continue;
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
    const destScope = db.select().from(marketScopes).where(eq(marketScopes.id, def.destinationScopeId)).get();
    if (!originScope || !destScope) continue;

    candidates.push({
      origin: originScope.code,
      destination: destScope.code,
      slug: def.slug,
      benchmarkPriceMinor: current.benchmarkPriceMinor,
      changePct,
      changeAbsMinor,
      windowLabel: windowDescription(def),
      percentile,
      confidence: recRow?.confidence ?? null,
      dataQualityLabel: dataQualityLabel(current.dataQualityScore),
      note: changePct !== null ? `Benchmark moved ${changePct.toFixed(1)}% in the last 24h.` : null,
    });
  }

  return rankMoversByAbsChange(candidates, limit);
}
