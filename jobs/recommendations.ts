// deriveRecommendations: for the LATEST market_snapshots row of each
// search_definitions row, assembles a ComputeRecommendationInput (percentile
// + fair value + volatility from domain/history over the compatible
// methodology cohort; momentum7dPct from the snapshot series;
// daysToDeparture only for EXACT definitions; freshness vs getNow()) and
// stores a recommendations row via domain/recommendations#computeRecommendation.

import { asc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { marketSnapshots, recommendations, searchDefinitions } from '@/db/schema';
import { config } from '@/domain/config';
import { fairValueRange, filterCompatibleSnapshots, historicalPercentile, volatility } from '@/domain/history';
import { computeRecommendation, type ComputeRecommendationInput } from '@/domain/recommendations';
import { getNow } from '@/lib/demo-time';
import { nearestByTime, pctChange } from '@/lib/markets/snapshotUtils';

import { isMainModule, parseDefinitionIdsArg, runCli } from './_shared';

const DAY_MS = 86_400_000;

export interface DeriveRecommendationsSummary {
  definitionsProcessed: number;
  recommendationsCreated: number;
  insufficientData: number;
  skippedNoSnapshot: number;
}

function dayBucket(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function deriveRecommendations(searchDefinitionId?: number): DeriveRecommendationsSummary {
  const defs =
    searchDefinitionId !== undefined
      ? db.select().from(searchDefinitions).where(eq(searchDefinitions.id, searchDefinitionId)).all()
      : db.select().from(searchDefinitions).all();

  const summary: DeriveRecommendationsSummary = {
    definitionsProcessed: 0,
    recommendationsCreated: 0,
    insufficientData: 0,
    skippedNoSnapshot: 0,
  };

  const now = getNow();

  for (const def of defs) {
    summary.definitionsProcessed += 1;

    const snapshotRows = db
      .select()
      .from(marketSnapshots)
      .where(eq(marketSnapshots.searchDefinitionId, def.id))
      .orderBy(asc(marketSnapshots.snapshotAt))
      .all();

    const compatible = filterCompatibleSnapshots(snapshotRows, config.benchmark.methodologyVersion);
    if (compatible.length === 0) {
      summary.skippedNoSnapshot += 1;
      continue;
    }

    const current = compatible[compatible.length - 1];
    const history = compatible.slice(0, -1);
    const historyPrices = history.map((s) => s.benchmarkPriceMinor);

    // "Enough history" is measured in distinct calendar days rather than raw
    // snapshot rows: scenarios with dense intraday polling (an event window
    // sampled every few hours) would otherwise inflate the row count without
    // covering more calendar time, defeating the intent of
    // minHistoryForRecommendation — has this route actually been watched for
    // long enough to trust a recommendation? A market with 6 days of history
    // sampled every 3 hours has ~30 snapshot rows but still only 6 days of
    // real coverage.
    const historyLength = new Set(history.map((s) => dayBucket(s.snapshotAt))).size;

    const percentile = history.length > 0 ? historicalPercentile(current.benchmarkPriceMinor, historyPrices) : null;
    const fairValue = fairValueRange(historyPrices);
    const volatilityPct = volatility([...historyPrices, current.benchmarkPriceMinor]);

    // 7-day momentum: compare against the compatible snapshot closest to
    // (current - 7 days), within a 2-day tolerance (otherwise there isn't
    // really a "7 days ago" data point to compare against).
    const sevenDaysAgo = nearestByTime(history, current.snapshotAt - 7 * DAY_MS, 2 * DAY_MS);
    const momentum7dPct = sevenDaysAgo
      ? pctChange(sevenDaysAgo.benchmarkPriceMinor, current.benchmarkPriceMinor)
      : null;

    const previous = history.length > 0 ? history[history.length - 1] : null;
    const offerCountChangePct = previous
      ? pctChange(previous.validOfferCount, current.validOfferCount)
      : null;

    let daysToDeparture: number | null = null;
    if (def.mode === 'EXACT' && def.departureDate) {
      const depMs = Date.parse(`${def.departureDate}T00:00:00.000Z`);
      if (!Number.isNaN(depMs)) {
        daysToDeparture = Math.ceil((depMs - now) / DAY_MS);
      }
    }

    const freshnessSeconds = Math.max(0, Math.round((now - current.snapshotAt) / 1000));

    const input: ComputeRecommendationInput = {
      percentile,
      fairValue,
      currentBenchmark: current.benchmarkPriceMinor,
      momentum7dPct,
      volatilityPct,
      daysToDeparture,
      offerCount: current.validOfferCount,
      offerCountChangePct,
      dataQualityScore: current.dataQualityScore,
      historyLength,
      freshnessSeconds,
    };

    const output = computeRecommendation(input);

    db.insert(recommendations)
      .values({
        searchDefinitionId: def.id,
        marketSnapshotId: current.id,
        label: output.label,
        confidence: output.confidence,
        score: output.score,
        observedFactsJson: output.observedFacts,
        inferencesJson: output.inferences,
        counterevidenceJson: output.counterEvidence,
        limitationsJson: output.limitations,
        methodologyVersion: output.methodologyVersion,
        createdAt: now,
      })
      .run();

    summary.recommendationsCreated += 1;
    if (output.label === 'INSUFFICIENT_DATA') summary.insufficientData += 1;
  }

  return summary;
}

if (isMainModule(import.meta.url)) {
  const ids = parseDefinitionIdsArg(process.argv);
  void runCli(() => deriveRecommendations(ids?.[0]));
}
