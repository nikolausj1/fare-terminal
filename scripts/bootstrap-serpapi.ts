// Idempotent bootstrap for the serpapi-routed personal roster (WP-P3). Run
// via:
//
//   DATABASE_PATH=data/real.db npm run bootstrap:serpapi
//
// Creates FLEXIBLE search_definitions rows for the 8 routes in
// domain/config.ts#serpapi.routes, in the SAME real-data database
// scripts/bootstrap-real.ts targets (default data/real.db) — these
// definitions are provider-agnostic rows; jobs/ingest.ts is what decides,
// per run, whether a given definition is searched via serpapi or
// travelpayouts (see that file's isSerpApiRouteSlug()). This script never
// inserts search_runs/offer_observations — real observations only ever
// enter via `npm run ingest`.
//
// Deliberately does NOT create airports or market_scopes — WP-P1
// (scripts/bootstrap-real.ts) owns that, since the same SEA-area airports
// feed both the travelpayouts real-market roster and the "From Seattle"
// home board. Run `npm run bootstrap:real` first (or after) to ensure every
// route's origin/destination scope actually exists; a route whose scope is
// still missing is skipped here with a clear message rather than failing
// the whole run, so this script can be re-run safely as P1's airport
// roster grows incrementally.
//
// Safe to re-run: every insert is select-then-skip-if-exists, never a wipe,
// and nothing here ever deactivates a definition (unlike bootstrap-real.ts's
// non-roster deactivation step — this script only ever ADDS to the 8-route
// roster, it never touches anything outside it).

import fs from 'node:fs';
import path from 'node:path';

import { and, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import { config } from '../domain/config';
import { resolveFlexibleQuery } from '../db/seed/generate';
import { marketScopes, searchDefinitions } from '../db/schema';
import type { DbClient } from '../db';

const DEFAULT_REAL_DB_PATH = 'data/real.db';
const FORBIDDEN_PATH_MARKERS = ['fare-terminal.db'];

// Same Dropbox brand-new-file gotcha bootstrap-real.ts works around — see
// that file's CLOUD_SYNC_SETTLE_MS comment for the full explanation. Kept
// in sync deliberately; this script is small enough that duplicating the
// ~10 lines is clearer than adding a shared-file dependency between two
// independently-owned bootstrap scripts.
const CLOUD_SYNC_SETTLE_MS = 8000;

interface SerpApiRoute {
  /** Bare route id, e.g. "sea-fco" — matches domain/config.ts#serpapi.routes
   * and lib/providers/serpapi/index.ts#routeIdFromSlug's expected shape. */
  id: string;
  origin: string;
  destination: string;
}

/** SEA is always the origin for this personal roster (see
 * domain/config.ts#homeBoard, WP-P1) — parsed straight from the configured
 * route ids rather than hand-duplicated, so this list can never drift from
 * domain/config.ts#serpapi.routes. */
function parseRoutes(): SerpApiRoute[] {
  return config.serpapi.routes.map((id) => {
    const [origin, destination] = id.split('-');
    if (!origin || !destination) {
      throw new Error(`bootstrap-serpapi: unparseable route id "${id}" in domain/config.ts#serpapi.routes`);
    }
    return { id, origin: origin.toUpperCase(), destination: destination.toUpperCase() };
  });
}

async function main() {
  if (!process.env.DATABASE_PATH) {
    process.env.DATABASE_PATH = DEFAULT_REAL_DB_PATH;
  }
  const dbPath = process.env.DATABASE_PATH;

  if (FORBIDDEN_PATH_MARKERS.some((marker) => dbPath.includes(marker))) {
    console.error(
      `[bootstrap-serpapi] Refusing to run: DATABASE_PATH="${dbPath}" looks like the synthetic demo ` +
        `database. This script must only ever touch a real-data database (default ` +
        `"${DEFAULT_REAL_DB_PATH}"). Synthetic and real observations must never share a database. ` +
        'Aborting without touching anything.'
    );
    process.exit(1);
  }

  process.env.DB_FORCE_WRITABLE = '1';

  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  if (!fs.existsSync(dbPath)) {
    console.log(`[bootstrap-serpapi] No file at ${dbPath} yet — creating it.`);
    fs.writeFileSync(dbPath, Buffer.alloc(0));
    console.log(
      `[bootstrap-serpapi] Waiting ${CLOUD_SYNC_SETTLE_MS}ms for the cloud-sync client to settle before opening a sqlite connection...`
    );
    await new Promise((resolve) => setTimeout(resolve, CLOUD_SYNC_SETTLE_MS));
  }

  // Dynamic import: DATABASE_PATH must be resolved/validated above before
  // '../db' is ever evaluated — see scripts/bootstrap-real.ts's file-level
  // comment for why this can't be a static import.
  const { db, resolveDatabasePath, sqlite } = (await import('../db')) as {
    db: DbClient;
    resolveDatabasePath: () => string;
    sqlite: { close: () => void };
  };

  runBootstrap(db, resolveDatabasePath, sqlite);
}

function findScopeId(db: DbClient, code: string): number | undefined {
  const row = db
    .select()
    .from(marketScopes)
    .where(and(eq(marketScopes.scopeType, 'AIRPORT'), eq(marketScopes.code, code)))
    .get();
  return row?.id;
}

interface DefinitionResult {
  route: SerpApiRoute;
  status: 'created' | 'existing' | 'skipped-missing-scope';
  slug?: string;
  id?: number;
  missingCode?: string;
}

function insertDefinitionsIdempotent(db: DbClient, routes: SerpApiRoute[], now: number): DefinitionResult[] {
  return routes.map((route) => {
    const originScopeId = findScopeId(db, route.origin);
    const destScopeId = findScopeId(db, route.destination);

    if (!originScopeId || !destScopeId) {
      return {
        route,
        status: 'skipped-missing-scope',
        missingCode: !originScopeId ? route.origin : route.destination,
      };
    }

    const slug = `${route.id}-flex-v1`;
    const existing = db.select().from(searchDefinitions).where(eq(searchDefinitions.slug, slug)).get();
    if (existing) {
      return { route, status: 'existing', slug, id: existing.id };
    }

    const flexQuery = resolveFlexibleQuery(route, now);
    const windowStartRule = `now+${config.demoDefaults.flexibleWindowMinDays}d`;
    const windowEndRule = `now+${config.demoDefaults.flexibleWindowMaxDays}d`;
    const [row] = db
      .insert(searchDefinitions)
      .values({
        slug,
        originScopeId,
        destinationScopeId: destScopeId,
        mode: 'FLEXIBLE',
        tripType: flexQuery.tripType,
        departureWindowStartRule: windowStartRule,
        departureWindowEndRule: windowEndRule,
        stayMinNights: flexQuery.stayMinNights,
        stayMaxNights: flexQuery.stayMaxNights,
        cabin: flexQuery.cabin,
        adults: flexQuery.adults,
        maxStops: flexQuery.maxStops,
        currency: flexQuery.currency,
        benchmarkMethodologyVersion: config.benchmark.methodologyVersion,
        createdAt: now,
        active: true,
      })
      .returning({ id: searchDefinitions.id })
      .all();

    return { route, status: 'created', slug, id: row.id };
  });
}

function runBootstrap(db: DbClient, resolveDatabasePath: () => string, sqlite: { close: () => void }) {
  const start = Date.now();
  const dbPath = resolveDatabasePath();
  console.log(`[bootstrap-serpapi] Target database: ${dbPath}`);

  console.log('[bootstrap-serpapi] Running migrations...');
  migrate(db, { migrationsFolder: './db/migrations' });
  console.log('[bootstrap-serpapi] Migrations complete.');

  const now = Date.now();
  const routes = parseRoutes();
  const results = insertDefinitionsIdempotent(db, routes, now);

  let created = 0;
  let existing = 0;
  let skipped = 0;
  for (const result of results) {
    if (result.status === 'created') {
      created += 1;
      console.log(`  [new] ${result.slug} (id=${result.id}) — will be searched via serpapi once SERPAPI_KEY is set.`);
    } else if (result.status === 'existing') {
      existing += 1;
      console.log(
        `  [existing] ${result.slug} (id=${result.id}) — already present (possibly created by bootstrap-real.ts); ` +
          'jobs/ingest.ts will now route it to serpapi based on domain/config.ts#serpapi.routes, not whoever created it.'
      );
    } else {
      skipped += 1;
      console.warn(
        `  [skipped] ${result.route.id} (${result.route.origin}-${result.route.destination}) — no market_scopes row for ` +
          `"${result.missingCode}" yet. Run \`npm run bootstrap:real\` (WP-P1) first to create SEA-area airports/scopes, ` +
          'then re-run this script — it is safe to re-run at any time.'
      );
    }
  }

  console.log(
    `[bootstrap-serpapi] search_definitions: ${created} created, ${existing} already present, ${skipped} skipped ` +
      `(missing scope) — ${routes.length} routes total.`
  );
  if (skipped > 0) {
    console.log(
      `[bootstrap-serpapi] ${skipped} route(s) not yet bootstrapped; re-run this script after bootstrap:real adds the missing airport(s).`
    );
  }

  console.log(
    '\n[bootstrap-serpapi] Deliberately did NOT insert search_runs or offer_observations — those only come from ' +
      '`npm run ingest` once SERPAPI_KEY is set (see .env.example / docs/PROVIDERS.md).'
  );
  console.log(`[bootstrap-serpapi] Done in ${Date.now() - start}ms.`);

  sqlite.close();
}

main().catch((err) => {
  console.error('[bootstrap-serpapi] Failed:', err);
  process.exit(1);
});
