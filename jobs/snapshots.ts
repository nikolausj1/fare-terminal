// deriveSnapshots: for each search_definitions row (optionally one, via
// searchDefinitionId), walks its search_runs chronologically and derives one
// market_snapshots row per run by loading that run's offer_observations,
// converting them to NormalizedOffer[], and calling
// domain/snapshots#computeSnapshotMetrics with now = the run's completedAt.
//
// Idempotent: a run is skipped if a market_snapshots row already exists for
// (search_definition_id, snapshot_at = run.completedAt) — pass
// { force: true } to recompute and insert anyway (still additive; callers
// that want a clean rebuild should delete existing rows first).

import { and, asc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { marketSnapshots, searchDefinitions, searchRuns } from '@/db/schema';
import { config } from '@/domain/config';
import { computeSnapshotMetrics } from '@/domain/snapshots';
import { loadOffersGroupedByRunId } from '@/lib/markets/offers';

import { isMainModule, parseDefinitionIdsArg, runCli } from './_shared';

export interface DeriveSnapshotsOptions {
  force?: boolean;
}

export interface DeriveSnapshotsSummary {
  definitionsProcessed: number;
  snapshotsCreated: number;
  snapshotsSkipped: number;
}

export function deriveSnapshots(
  searchDefinitionId?: number,
  opts: DeriveSnapshotsOptions = {}
): DeriveSnapshotsSummary {
  const defs =
    searchDefinitionId !== undefined
      ? db.select().from(searchDefinitions).where(eq(searchDefinitions.id, searchDefinitionId)).all()
      : db.select().from(searchDefinitions).all();

  const summary: DeriveSnapshotsSummary = {
    definitionsProcessed: 0,
    snapshotsCreated: 0,
    snapshotsSkipped: 0,
  };

  for (const def of defs) {
    summary.definitionsProcessed += 1;

    const runs = db
      .select()
      .from(searchRuns)
      .where(and(eq(searchRuns.searchDefinitionId, def.id), eq(searchRuns.status, 'SUCCESS')))
      .orderBy(asc(searchRuns.completedAt))
      .all();

    const existingSnapshotTimes = opts.force
      ? new Set<number>()
      : new Set(
          db
            .select({ snapshotAt: marketSnapshots.snapshotAt })
            .from(marketSnapshots)
            .where(eq(marketSnapshots.searchDefinitionId, def.id))
            .all()
            .map((r) => r.snapshotAt)
        );

    const offersByRun = loadOffersGroupedByRunId(def.id);

    for (const run of runs) {
      if (run.completedAt === null) continue;
      if (existingSnapshotTimes.has(run.completedAt)) {
        summary.snapshotsSkipped += 1;
        continue;
      }

      const offers = offersByRun.get(run.id) ?? [];
      const metrics = computeSnapshotMetrics(offers, run.completedAt);

      db.insert(marketSnapshots)
        .values({
          searchDefinitionId: def.id,
          snapshotAt: run.completedAt,
          benchmarkPriceMinor: metrics.benchmarkPriceMinor,
          fromPriceMinor: metrics.fromPriceMinor,
          medianPriceMinor: metrics.medianPriceMinor,
          p25PriceMinor: metrics.p25PriceMinor,
          validOfferCount: metrics.validOfferCount,
          uniqueItineraryCount: metrics.uniqueItineraryCount,
          carrierCount: metrics.carrierCount,
          nonstopOfferCount: metrics.nonstopOfferCount,
          oneStopOfferCount: metrics.oneStopOfferCount,
          freshnessSeconds: metrics.freshnessSeconds,
          dataQualityScore: metrics.dataQualityScore,
          methodologyVersion: config.benchmark.methodologyVersion,
          sourceSearchRunIds: [run.id],
        })
        .run();

      existingSnapshotTimes.add(run.completedAt);
      summary.snapshotsCreated += 1;
    }
  }

  return summary;
}

if (isMainModule(import.meta.url)) {
  const ids = parseDefinitionIdsArg(process.argv);
  void runCli(() => deriveSnapshots(ids?.[0]));
}
