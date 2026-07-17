// runBackfill: derives market_snapshots from the historical search_runs /
// offer_observations that already exist in the DB after `npm run seed`.
//
// For the demo provider, `npm run seed` (db/seed/index.ts) writes fully
// normalized historical search_runs/offer_observations directly — it does
// NOT go through jobs/ingest.ts's live provider.search() call, because
// ingest always asks the provider for "now"'s offers, and history has to be
// generated for many past instants instead. So there is no "bulk historical
// import" left for a backfill job to replay through the normalization
// pipeline; that step already happened at seed time. What backfill DOES
// still need to do is turn each of those already-stored search_runs into a
// market_snapshots row — exactly what jobs/snapshots.ts#deriveSnapshots
// does — so this file delegates to it rather than duplicating the
// "offer_observations -> SnapshotMetrics -> market_snapshots row" logic.
//
// jobs/pipeline.ts still runs the "snapshots" stage after "backfill": since
// deriveSnapshots is idempotent (skips runs that already have a snapshot),
// the second call is a fast no-op for anything backfill already covered,
// and only does real work for runs added afterward (e.g. a concurrent
// jobs/ingest.ts call).

import { deriveSnapshots, type DeriveSnapshotsSummary } from './snapshots';
import { isMainModule, parseDefinitionIdsArg, runCli } from './_shared';

export type BackfillSummary = DeriveSnapshotsSummary;

export function runBackfill(searchDefinitionId?: number): BackfillSummary {
  return deriveSnapshots(searchDefinitionId);
}

if (isMainModule(import.meta.url)) {
  const ids = parseDefinitionIdsArg(process.argv);
  void runCli(() => runBackfill(ids?.[0]));
}
