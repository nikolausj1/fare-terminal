// runFullPipeline: backfill -> snapshots -> events -> recommendations ->
// analyst-notes, in order, with per-stage timing + row-count logging. This
// is what `npm run pipeline` and the build-time seed hook invoke.

import { deriveAnalystNotes, type DeriveAnalystNotesSummary } from './analyst-notes';
import { runBackfill, type BackfillSummary } from './backfill';
import { deriveEvents, type DeriveEventsSummary } from './events';
import { deriveRecommendations, type DeriveRecommendationsSummary } from './recommendations';
import { deriveSnapshots, type DeriveSnapshotsSummary } from './snapshots';
import { isMainModule, runCli } from './_shared';

export interface PipelineStageResult<T> {
  stage: string;
  durationMs: number;
  summary: T;
}

export interface PipelineSummary {
  stages: [
    PipelineStageResult<BackfillSummary>,
    PipelineStageResult<DeriveSnapshotsSummary>,
    PipelineStageResult<DeriveEventsSummary>,
    PipelineStageResult<DeriveRecommendationsSummary>,
    PipelineStageResult<DeriveAnalystNotesSummary>,
  ];
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

  return {
    stages: [backfill, snapshots, events, recs, notes],
    totalDurationMs: Date.now() - start,
  };
}

if (isMainModule(import.meta.url)) {
  void runCli(runFullPipeline);
}
