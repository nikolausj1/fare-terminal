#!/usr/bin/env node
// WP-F1 fix 1 data repair: deletes any offer_observations row with
// total_price_minor <= 0, then re-derives the market_snapshots rows that
// were computed from a search_run one of those rows belonged to (so a
// stale benchmarkPriceMinor/dataQualityScore computed while the bad row
// was still present doesn't linger).
//
// In the current codebase this should always find 0 rows: both
// domain/normalization/validate.ts (normalizeAndValidate, used by
// jobs/ingest.ts) and lib/providers/travelpayouts/mapping.ts (which skips
// price<=0 items before they're even turned into a NormalizedOffer) already
// reject a non-positive price before it can reach offer_observations. This
// script exists as a defensive repair pass — for a DB written before those
// guards existed, restored from a backup, or touched by some future
// provider adapter that doesn't route through the same validation — rather
// than as evidence a hole is currently open.
//
// The $0-benchmark display bug this work package fixes (WP-F1 fix 1) has a
// different, already-covered root cause: a search_run that legitimately
// returns zero valid offers (provider returned nothing that run) produces a
// structurally-valid market_snapshots row with benchmarkPriceMinor: 0 /
// dataQualityScore: 0 via domain/snapshots/computeSnapshotMetrics.ts's
// zero-valid-offers branch — there is no bad offer_observations row to
// purge in that case. That's handled by MarketSummaryVM.priceReliable /
// config.display.minQualityForPrice in lib/markets/queries.ts, not by this
// script.
//
// Usage:
//   node scripts/purge-invalid-observations.mjs <path-to-db>
//   DATABASE_PATH=<path-to-db> node scripts/purge-invalid-observations.mjs

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import Database from 'better-sqlite3';

const databasePath = process.argv[2] ?? process.env.DATABASE_PATH;

if (!databasePath) {
  console.error('Usage: node scripts/purge-invalid-observations.mjs <path-to-db>');
  process.exit(1);
}
if (!existsSync(databasePath)) {
  console.error(`[purge] no DB file at ${databasePath}`);
  process.exit(1);
}

const db = new Database(databasePath);

const beforeBadObsCount = db
  .prepare('SELECT COUNT(*) AS n FROM offer_observations WHERE total_price_minor <= 0')
  .get().n;
const beforeSnapshotCount = db.prepare('SELECT COUNT(*) AS n FROM market_snapshots').get().n;

console.log(
  `[purge] ${databasePath}: ${beforeBadObsCount} offer_observations row(s) with total_price_minor <= 0 (of ${
    db.prepare('SELECT COUNT(*) AS n FROM offer_observations').get().n
  } total).`
);

if (beforeBadObsCount === 0) {
  console.log('[purge] nothing to purge. Exiting without touching market_snapshots.');
  db.close();
  process.exit(0);
}

const badRows = db
  .prepare('SELECT DISTINCT search_run_id, search_definition_id FROM offer_observations WHERE total_price_minor <= 0')
  .all();
const affectedDefIds = [...new Set(badRows.map((r) => r.search_definition_id))];

let snapshotsDeleted = 0;
const txn = db.transaction(() => {
  const deleteInfo = db.prepare('DELETE FROM offer_observations WHERE total_price_minor <= 0').run();
  console.log(`[purge] deleted ${deleteInfo.changes} offer_observations row(s).`);

  const findRun = db.prepare('SELECT search_definition_id, completed_at FROM search_runs WHERE id = ?');
  const deleteSnapshot = db.prepare(
    'DELETE FROM market_snapshots WHERE search_definition_id = ? AND snapshot_at = ?'
  );
  for (const { search_run_id: runId } of badRows) {
    const run = findRun.get(runId);
    if (!run || run.completed_at === null) continue;
    const res = deleteSnapshot.run(run.search_definition_id, run.completed_at);
    snapshotsDeleted += res.changes;
  }
  console.log(`[purge] deleted ${snapshotsDeleted} now-stale market_snapshots row(s) for re-derivation.`);
});
txn();
db.close();

console.log(
  `[purge] re-deriving snapshots for ${affectedDefIds.length} affected search_definition id(s) via jobs/snapshots.ts: ${affectedDefIds.join(', ')}`
);
for (const defId of affectedDefIds) {
  const result = spawnSync('npx', ['tsx', 'jobs/snapshots.ts', String(defId)], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, DATABASE_PATH: databasePath, DB_FORCE_WRITABLE: '1' },
  });
  if (result.status !== 0) {
    console.error(`[purge] jobs/snapshots.ts failed for search_definition ${defId}`);
    process.exit(result.status ?? 1);
  }
}

const verifyDb = new Database(databasePath, { readonly: true });
const afterBadObsCount = verifyDb
  .prepare('SELECT COUNT(*) AS n FROM offer_observations WHERE total_price_minor <= 0')
  .get().n;
const afterSnapshotCount = verifyDb.prepare('SELECT COUNT(*) AS n FROM market_snapshots').get().n;
verifyDb.close();

console.log('[purge] done.');
console.log(`[purge]   offer_observations with price<=0: ${beforeBadObsCount} -> ${afterBadObsCount}`);
console.log(`[purge]   market_snapshots row count:        ${beforeSnapshotCount} -> ${afterSnapshotCount}`);
