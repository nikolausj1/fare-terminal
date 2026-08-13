// WP-P5 one-time backfill: gives the 8-route serpapi roster
// (domain/config.ts#serpapi.routes) a real ~61-day Google price-tracking
// baseline TODAY, instead of waiting for daily sweeps to accumulate one
// point at a time. Every SerpApi Google Flights response already carries a
// `price_insights` object with Google's own ~61-day daily price series for
// that route (see tests/unit/fixtures/serpapi-real-sea-fco-2026-08-02.json)
// — this script just runs one real search per roster route and lets the
// normal ingest machinery extract it.
//
// Run via:
//
//   DATABASE_PATH=data/real.db npm run backfill:insights -- --force
//
// (or `npm run backfill:insights -- --force` with DATABASE_PATH already
// exported — defaults to data/real.db either way, matching
// scripts/bootstrap-serpapi.ts's convention.)
//
// Deliberately reuses jobs/ingest.ts#runIngestion (not a hand-rolled call
// to serpapiProvider.search()) so a backfill run is byte-for-byte the same
// code path as a normal scheduled ingest: it stores TODAY's offer
// observations exactly as usual AND persists price_insights via
// jobs/ingest.ts#persistPriceInsights — no separate/duplicated
// extraction logic to drift out of sync with the real pipeline.
//
// --force is REQUIRED and does exactly one thing: it threads
// `bypassDailyGate: true` into runIngestion so all 8 routes can be searched
// in this one sitting rather than the normal "1 search per definition per
// UTC day" gate collapsing the run to a single route. It does NOT bypass
// the monthly search-budget gate (config.serpapi.monthlySearchBudget) —
// that is still evaluated and enforced normally on every single call below,
// so this script can never push total usage over budget regardless of how
// many times it's re-run. Costs exactly routes.length live SerpApi
// searches per run (8 today) — re-running it later in the same UTC day
// would cost another 8, so don't run it more than once per backfill.

import fs from 'node:fs';
import path from 'node:path';

import { desc, eq } from 'drizzle-orm';

import { config } from '../domain/config';
import { googlePriceHistory, routePriceInsights, searchDefinitions } from '../db/schema';
import type { DbClient } from '../db';
import type { IngestSummary } from '../jobs/ingest';

const DEFAULT_REAL_DB_PATH = 'data/real.db';
const FORBIDDEN_PATH_MARKERS = ['fare-terminal.db'];

function formatUsd(minor: number): string {
  return `$${(minor / 100).toFixed(0)}`;
}

async function main() {
  const force = process.argv.includes('--force');
  if (!force) {
    console.error(
      '[backfill-price-insights] Refusing to run without --force. This script spends ' +
        `${config.serpapi.routes.length} real SerpApi searches (one per roster route) and bypasses the daily ` +
        'per-definition gate (jobs/ingest.ts\'s evaluateSerpApiBudget daily check) — it is meant to be run ' +
        'deliberately, once, not accidentally from a script that re-runs jobs/ingest.ts style logic. ' +
        'The monthly search-budget gate is NEVER bypassed, --force or not. ' +
        'Re-run with: npm run backfill:insights -- --force'
    );
    process.exit(1);
  }

  if (!process.env.DATABASE_PATH) {
    process.env.DATABASE_PATH = DEFAULT_REAL_DB_PATH;
  }
  const dbPath = process.env.DATABASE_PATH;

  if (FORBIDDEN_PATH_MARKERS.some((marker) => dbPath.includes(marker))) {
    console.error(
      `[backfill-price-insights] Refusing to run: DATABASE_PATH="${dbPath}" looks like the synthetic demo ` +
        `database. This script must only ever touch a real-data database (default "${DEFAULT_REAL_DB_PATH}"). ` +
        'Aborting without spending any search budget.'
    );
    process.exit(1);
  }
  if (!process.env.SERPAPI_KEY) {
    console.error('[backfill-price-insights] SERPAPI_KEY is not set; cannot run live searches. Aborting.');
    process.exit(1);
  }

  process.env.DB_FORCE_WRITABLE = '1';

  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  // Dynamic import: DATABASE_PATH must be resolved/validated above before
  // '../db' (and anything that transitively imports it) is ever evaluated —
  // same reasoning as scripts/bootstrap-serpapi.ts.
  const { db, resolveDatabasePath, sqlite } = (await import('../db')) as {
    db: DbClient;
    resolveDatabasePath: () => string;
    sqlite: { close: () => void };
  };
  const { runIngestion } = await import('../jobs/ingest');

  console.log(`[backfill-price-insights] Target database: ${resolveDatabasePath()}`);
  console.log(`[backfill-price-insights] Roster: ${config.serpapi.routes.join(', ')} (${config.serpapi.routes.length} routes)`);

  const routeDefs = config.serpapi.routes.map((routeId) => {
    const slug = `${routeId}-flex-v1`;
    const row = db.select().from(searchDefinitions).where(eq(searchDefinitions.slug, slug)).get();
    return { routeId, slug, id: row?.id };
  });

  const missing = routeDefs.filter((r) => r.id === undefined);
  if (missing.length > 0) {
    console.error(
      `[backfill-price-insights] Missing search_definitions row(s) for: ${missing.map((m) => m.slug).join(', ')}. ` +
        'Run `npm run bootstrap:serpapi` first. Aborting without spending any search budget.'
    );
    sqlite.close();
    process.exit(1);
  }

  let searchesAttempted = 0;
  let searchesSucceeded = 0;
  let budgetStopped = false;

  for (const route of routeDefs) {
    const defId = route.id as number;
    console.log(`\n[backfill-price-insights] --- ${route.slug} (search_definitions ${defId}) ---`);

    searchesAttempted += 1;
    let summary: IngestSummary;
    try {
      summary = await runIngestion([defId], { bypassDailyGate: true });
    } catch (err) {
      console.error(`[backfill-price-insights] ${route.slug}: runIngestion threw:`, err);
      continue;
    }

    if (summary.serpapiSkippedNoKey > 0) {
      console.error(`[backfill-price-insights] ${route.slug}: skipped, SERPAPI_KEY not set (unexpected — checked above).`);
      continue;
    }
    if (summary.serpapiSkippedBudget.length > 0) {
      console.error(
        `[backfill-price-insights] ${route.slug}: skipped by the MONTHLY budget gate — ${summary.serpapiSkippedBudget[0].reason}. ` +
          'Stopping the backfill here; already-completed routes above are unaffected.'
      );
      budgetStopped = true;
      break;
    }
    if (summary.errors.length > 0) {
      console.error(`[backfill-price-insights] ${route.slug}: search FAILED — ${summary.errors[0].message}`);
      continue;
    }

    searchesSucceeded += 1;

    const historyRows = db
      .select()
      .from(googlePriceHistory)
      .where(eq(googlePriceHistory.searchDefinitionId, defId))
      .orderBy(googlePriceHistory.priceDate)
      .all();

    const latestInsights = db
      .select()
      .from(routePriceInsights)
      .where(eq(routePriceInsights.searchDefinitionId, defId))
      .orderBy(desc(routePriceInsights.capturedAt))
      .limit(1)
      .get();

    console.log(`[backfill-price-insights] ${route.slug}: offers ${summary.offersInserted} stored this run.`);
    if (historyRows.length === 0 || !latestInsights) {
      console.log(
        `[backfill-price-insights] ${route.slug}: no price_insights history captured this run (response may not have carried one).`
      );
      continue;
    }

    const span = `${historyRows[0].priceDate} .. ${historyRows[historyRows.length - 1].priceDate}`;
    const typicalRange =
      latestInsights.typicalLowMinor !== null && latestInsights.typicalHighMinor !== null
        ? `${formatUsd(latestInsights.typicalLowMinor)}-${formatUsd(latestInsights.typicalHighMinor)}`
        : 'n/a';
    console.log(
      `[backfill-price-insights] ${route.slug}: ${historyRows.length} Google price_history point(s) spanning ${span}; ` +
        `price_level=${latestInsights.priceLevel}, typical range ${typicalRange}, lowest ${formatUsd(latestInsights.lowestPriceMinor)}.`
    );
  }

  console.log(
    `\n[backfill-price-insights] Done. ${searchesSucceeded}/${searchesAttempted} route(s) succeeded` +
      `${budgetStopped ? ' (stopped early: monthly budget reached)' : ''}. Each attempted route consumed exactly one live SerpApi search.`
  );

  sqlite.close();
}

main().catch((err) => {
  console.error('[backfill-price-insights] Failed:', err);
  process.exit(1);
});
