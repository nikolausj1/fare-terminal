// runFullPipeline: backfill -> snapshots -> events -> recommendations ->
// analyst-notes -> [heatmap -> deals -> related, WP-F2, gated] ->
// index-series, in order, with per-stage timing + row-count logging. This
// is what `npm run pipeline` and the build-time seed hook invoke.
//
// WP-F2 gating: heatmap/deals/related each make live Travelpayouts API
// calls (via lib/providers/travelpayouts/extras.ts), so they run ONLY when
// DATA_PROVIDER=travelpayouts AND TRAVELPAYOUTS_TOKEN is set — the same
// condition the core provider registry (lib/providers/index.ts) uses to
// activate the real provider instead of falling back to demo. This keeps
// demo builds (`npm run build`, `npm run seed`, local dev with no .env)
// making zero network calls, exactly like before WP-F2. index-series is
// pure DB compute (no API calls) and runs unconditionally — it works fine
// against demo data too, since it only reads market_snapshots.

import { deriveAnalystNotes, type DeriveAnalystNotesSummary } from './analyst-notes';
import { runBackfill, type BackfillSummary } from './backfill';
import { runDealsSweep, type DealsSummary } from './deals';
import { deriveEvents, type DeriveEventsSummary } from './events';
import { runHeatmapSweep, type HeatmapSummary } from './heatmap';
import { deriveIndexSeries, type IndexSeriesSummary } from './index-series';
import { deriveRecommendations, type DeriveRecommendationsSummary } from './recommendations';
import { runRelatedSweep, type RelatedSummary } from './related';
import { deriveSnapshots, type DeriveSnapshotsSummary } from './snapshots';
import { isMainModule, runCli } from './_shared';

export interface PipelineStageResult<T> {
  stage: string;
  durationMs: number;
  summary: T;
}

/** True exactly when the live Travelpayouts extras jobs are allowed to make
 * network calls this run — mirrors lib/providers/index.ts#getActiveProvider's
 * fallback condition so the extras jobs never fire in a demo build/deploy. */
function extrasEnabled(): boolean {
  return process.env.DATA_PROVIDER === 'travelpayouts' && Boolean(process.env.TRAVELPAYOUTS_TOKEN);
}

export interface PipelineSummary {
  stages: [
    PipelineStageResult<BackfillSummary>,
    PipelineStageResult<DeriveSnapshotsSummary>,
    PipelineStageResult<DeriveEventsSummary>,
    PipelineStageResult<DeriveRecommendationsSummary>,
    PipelineStageResult<DeriveAnalystNotesSummary>,
  ];
  /** WP-F2 extras stages — undefined (not run) whenever extrasEnabled() is
   * false, e.g. every demo build/deploy. */
  extrasStages:
    | [PipelineStageResult<HeatmapSummary>, PipelineStageResult<DealsSummary>, PipelineStageResult<RelatedSummary>]
    | undefined;
  indexSeriesStage: PipelineStageResult<IndexSeriesSummary>;
  /** Combined live-API request count across the extras stages this run —
   * logged explicitly so a sweep's budget consumption is visible without
   * digging through each stage's own summary. 0 when extras were skipped. */
  extrasRequestsMade: number;
  totalDurationMs: number;
}

async function timeStage<T>(stage: string, fn: () => T | Promise<T>): Promise<PipelineStageResult<T>> {
  const start = Date.now();
  const summary = await fn();
  const durationMs = Date.now() - start;
  console.log(`[pipeline] ${stage}: ${durationMs}ms`, summary);
  return { stage, durationMs, summary };
}

export async function runFullPipeline(): Promise<PipelineSummary> {
  const start = Date.now();

  const backfill = await timeStage('backfill', () => runBackfill());
  const snapshots = await timeStage('snapshots', () => deriveSnapshots());
  const events = await timeStage('events', () => deriveEvents());
  const recs = await timeStage('recommendations', () => deriveRecommendations());
  const notes = await timeStage('analyst-notes', () => deriveAnalystNotes());

  let extrasStages: PipelineSummary['extrasStages'];
  let extrasRequestsMade = 0;

  if (extrasEnabled()) {
    const heatmap = await timeStage('heatmap', () => runHeatmapSweep());
    const deals = await timeStage('deals', () => runDealsSweep());
    const related = await timeStage('related', () => runRelatedSweep());
    extrasStages = [heatmap, deals, related];
    extrasRequestsMade = heatmap.summary.requestsMade + deals.summary.requestsMade + related.summary.requestsMade;
    console.log(
      `[pipeline] WP-F2 extras budget this sweep: ${extrasRequestsMade} live request(s) ` +
        `(heatmap ${heatmap.summary.requestsMade}, deals ${deals.summary.requestsMade}, related ${related.summary.requestsMade}) ` +
        `across ${heatmap.summary.routesRefreshedThisSweep}/${heatmap.summary.routesInRoster} heatmap route(s) ` +
        `and ${related.summary.originsRefreshedThisSweep}/${related.summary.originsInRoster} related-market origin(s).`
    );
  } else {
    console.log('[pipeline] WP-F2 extras (heatmap/deals/related) skipped: not running with a live travelpayouts provider.');
  }

  const indexSeriesStage = await timeStage('index-series', () => deriveIndexSeries());

  return {
    stages: [backfill, snapshots, events, recs, notes],
    extrasStages,
    indexSeriesStage,
    extrasRequestsMade,
    totalDurationMs: Date.now() - start,
  };
}

if (isMainModule(import.meta.url)) {
  void runCli(runFullPipeline);
}
