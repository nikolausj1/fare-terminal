// Pure derivation of DataSourceMode from a set of provider_id values. Split
// out from queries.ts (which opens a real DB connection at import time via
// db/index.ts) so this logic can be unit-tested with plain fixture data,
// with no DB/temp-file setup required — see tests/unit/dataSourceMode.test.ts.
//
// The mode must be derived from what's actually IN the database
// (search_runs.provider_id), never from process.env.DATA_PROVIDER: the env
// var only describes how the ingestion pipeline was configured to run, and
// can drift from what a given DB file was actually seeded/ingested with
// (e.g. a demo DB copied around, or DATA_PROVIDER flipped without
// re-seeding). Trusting the data itself is the only way the "Synthetic demo
// data" / "cached market observations" labeling stays honest.

import type { DataSourceMode } from './view-models';

const DEMO_PROVIDER_ID = 'demo';

/**
 * Derives the DB's DataSourceMode from the distinct provider_id values seen
 * across search_runs.
 *
 * - No rows (fresh/empty DB) or only 'demo' -> 'DEMO'.
 * - Only non-demo provider(s) (e.g. 'travelpayouts') -> 'AGGREGATED_CACHED'.
 * - Both 'demo' and a non-demo provider present -> 'MIXED' (tripwire; see
 *   DataSourceMode doc comment in view-models.ts — this should never happen
 *   by design since demo and real deployments use separate DB files).
 */
export function deriveDataSourceMode(distinctProviderIds: readonly string[]): DataSourceMode {
  const hasDemo = distinctProviderIds.includes(DEMO_PROVIDER_ID);
  const hasReal = distinctProviderIds.some((id) => id !== DEMO_PROVIDER_ID);

  if (hasDemo && hasReal) return 'MIXED';
  if (hasReal) return 'AGGREGATED_CACHED';
  return 'DEMO';
}
