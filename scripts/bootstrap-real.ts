// Idempotent bootstrap for the REAL-DATA database (WP-B). Run via:
//
//   DATABASE_PATH=data/real.db npm run bootstrap:real
//
// Creates/migrates the DB at $DATABASE_PATH (default data/real.db) and
// inserts airports, market_scopes, and ACTIVE search_definitions for the
// same 12 markets db/seed/markets.ts defines for the synthetic demo — but
// NEVER inserts search_runs / offer_observations or anything else
// synthetic. Real offer data only ever enters this database later, via
// `npm run ingest` hitting the live travelpayouts provider.
//
// Safe to re-run: every insert is select-then-skip-if-exists, never a wipe.
//
// This is a companion to db/seed/index.ts (`npm run seed`), which does the
// analogous thing for the SYNTHETIC demo DB (data/fare-terminal.db) — that
// script additionally wipes and fabricates full offer history. This script
// deliberately does neither: real observations must accumulate one honest
// `npm run ingest` sweep at a time, never be backfilled or fabricated.
//
// IMPORTANT implementation note — DATABASE_PATH must be resolved and
// validated BEFORE `../db` (db/index.ts) is ever evaluated, because that
// module opens its sqlite connection as an import-time side effect using
// process.env.DATABASE_PATH. Under ESM, a *static* `import ... from '../db'`
// is hoisted and evaluated before this file's own top-level statements run —
// regardless of where the import line sits textually — so setting the env
// var "before" a static import of '../db' does NOT reliably run first. This
// file therefore keeps '../db' as a *dynamic* `import()` performed inside
// main(), after the env/safety-check logic, so ordering is actually
// guaranteed. (Everything else imported here — schema, config, seed data —
// has no import-time side effects tied to DATABASE_PATH, so those stay
// static imports.)

import fs from 'node:fs';
import path from 'node:path';

import { eq, and } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import { config } from '../domain/config';
import { resolveFlexibleQuery } from '../db/seed/generate';
import { AIRPORTS } from '../db/seed/markets';
import { airports, marketScopes, searchDefinitions } from '../db/schema';
import type { DbClient } from '../db';

const DEFAULT_REAL_DB_PATH = 'data/real.db';
const FORBIDDEN_PATH_MARKERS = ['fare-terminal.db'];

/** Real-mode tracked markets, chosen by MEASURED Aviasales cache coverage
 * (probed 2026-07-24), not by the demo's scenario needs. The cached Data
 * API is driven by real Aviasales user searches, so coverage is dense on
 * international trunk routes and near-zero on US domestic/secondary
 * leisure routes (ATL-LIS, MSP-CUN, PDX-YVR etc. returned 0-1 offers).
 * Flexible-window definitions only in real mode v1. */
interface RealMarket {
  id: string;
  origin: string;
  destination: string;
}

const REAL_MARKETS: readonly RealMarket[] = [
  // Kept from the demo roster (probed offer counts in comments):
  { id: 'jfk-lhr', origin: 'JFK', destination: 'LHR' }, // 14
  { id: 'lax-hnd', origin: 'LAX', destination: 'HND' }, // 24
  { id: 'ord-cdg', origin: 'ORD', destination: 'CDG' }, // 8
  { id: 'sfo-bcn', origin: 'SFO', destination: 'BCN' }, // 8
  { id: 'sea-fco', origin: 'SEA', destination: 'FCO' }, // 2 (thin; kept as flagship example)
  // Added for coverage:
  { id: 'jfk-cdg', origin: 'JFK', destination: 'CDG' }, // 14
  { id: 'lax-nrt', origin: 'LAX', destination: 'NRT' }, // 8
  { id: 'mia-mad', origin: 'MIA', destination: 'MAD' }, // 4
  { id: 'ewr-bcn', origin: 'EWR', destination: 'BCN' }, // 4
  { id: 'iad-lis', origin: 'IAD', destination: 'LIS' }, // 2
];

/** Airports referenced by REAL_MARKETS but absent from the demo AIRPORTS list. */
const EXTRA_AIRPORTS: readonly {
  iataCode: string;
  icaoCode?: string;
  name: string;
  cityName: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  timezone: string;
}[] = [
  { iataCode: 'MIA', name: 'Miami International', cityName: 'Miami', countryCode: 'US', latitude: 25.7959, longitude: -80.287, timezone: 'America/New_York' },
  { iataCode: 'EWR', name: 'Newark Liberty International', cityName: 'Newark', countryCode: 'US', latitude: 40.6895, longitude: -74.1745, timezone: 'America/New_York' },
  { iataCode: 'IAD', name: 'Washington Dulles International', cityName: 'Washington', countryCode: 'US', latitude: 38.9531, longitude: -77.4565, timezone: 'America/New_York' },
  { iataCode: 'MAD', name: 'Adolfo Suarez Madrid-Barajas', cityName: 'Madrid', countryCode: 'ES', latitude: 40.4839, longitude: -3.568, timezone: 'Europe/Madrid' },
  { iataCode: 'NRT', name: 'Narita International', cityName: 'Tokyo', countryCode: 'JP', latitude: 35.7719, longitude: 140.3929, timezone: 'Asia/Tokyo' },
];

const ALL_AIRPORTS = [
  ...AIRPORTS,
  ...EXTRA_AIRPORTS.filter((e) => !AIRPORTS.some((a) => a.iataCode === e.iataCode)),
];

// How long to wait, after creating a brand-new (previously nonexistent)
// database file, before opening a sqlite connection to it. This repo lives
// inside a Dropbox-synced folder; Dropbox's client briefly holds the file
// open/locked while it hashes and syncs a just-created or just-modified
// file, and better-sqlite3's blocking OS-level file lock acquisition has no
// timeout — it can hang indefinitely rather than fail fast if it races that
// window. Confirmed empirically: `touch`ing the file and waiting ~8s before
// `new Database(path)` avoids the hang every time; opening a file that has
// existed (and settled) for a while never hangs. See docs/PROVIDERS.md
// "Real-world response notes" for the full writeup — this is a DIFFERENT
// Dropbox gotcha than the documented node_modules dehydration issue.
const CLOUD_SYNC_SETTLE_MS = 8000;

interface Counts {
  inserted: number;
  skipped: number;
}

async function main() {
  // --- Resolve + validate DATABASE_PATH first --------------------------
  if (!process.env.DATABASE_PATH) {
    process.env.DATABASE_PATH = DEFAULT_REAL_DB_PATH;
  }
  const dbPath = process.env.DATABASE_PATH;

  if (FORBIDDEN_PATH_MARKERS.some((marker) => dbPath.includes(marker))) {
    console.error(
      `[bootstrap-real] Refusing to run: DATABASE_PATH="${dbPath}" looks like the synthetic demo ` +
        `database. This script must only ever touch a real-data database (default ` +
        `"${DEFAULT_REAL_DB_PATH}"). Synthetic and real observations must never share a database. ` +
        'Aborting without touching anything.'
    );
    process.exit(1);
  }

  // Local bootstrapping should always be writable; this only matters if
  // VERCEL=1 happens to be set in the invoking shell (see db/index.ts).
  process.env.DB_FORCE_WRITABLE = '1';

  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  if (!fs.existsSync(dbPath)) {
    console.log(`[bootstrap-real] No file at ${dbPath} yet — creating it.`);
    fs.writeFileSync(dbPath, Buffer.alloc(0));
    console.log(
      `[bootstrap-real] Waiting ${CLOUD_SYNC_SETTLE_MS}ms for the cloud-sync client to settle before opening a sqlite connection (see comment above)...`
    );
    await new Promise((resolve) => setTimeout(resolve, CLOUD_SYNC_SETTLE_MS));
  }

  // Dynamic import: see the file-level comment for why this can't be a
  // static import.
  const { db, resolveDatabasePath, sqlite } = (await import('../db')) as {
    db: DbClient;
    resolveDatabasePath: () => string;
    sqlite: { close: () => void };
  };

  runBootstrap(db, resolveDatabasePath, sqlite);
}

function insertAirportsIdempotent(db: DbClient): { ids: Map<string, number>; counts: Counts } {
  const ids = new Map<string, number>();
  const counts: Counts = { inserted: 0, skipped: 0 };

  for (const a of ALL_AIRPORTS) {
    const existing = db.select().from(airports).where(eq(airports.iataCode, a.iataCode)).get();
    if (existing) {
      ids.set(a.iataCode, existing.id);
      counts.skipped += 1;
      continue;
    }

    const [row] = db
      .insert(airports)
      .values({
        iataCode: a.iataCode,
        icaoCode: a.icaoCode ?? null,
        name: a.name,
        cityName: a.cityName,
        countryCode: a.countryCode,
        latitude: a.latitude,
        longitude: a.longitude,
        timezone: a.timezone,
        active: true,
      })
      .returning({ id: airports.id })
      .all();
    ids.set(a.iataCode, row.id);
    counts.inserted += 1;
  }

  return { ids, counts };
}

function insertScopesIdempotent(
  db: DbClient,
  airportIds: Map<string, number>
): { ids: Map<string, number>; counts: Counts } {
  const ids = new Map<string, number>();
  const counts: Counts = { inserted: 0, skipped: 0 };

  for (const a of ALL_AIRPORTS) {
    const existing = db
      .select()
      .from(marketScopes)
      .where(and(eq(marketScopes.scopeType, 'AIRPORT'), eq(marketScopes.code, a.iataCode)))
      .get();
    if (existing) {
      ids.set(a.iataCode, existing.id);
      counts.skipped += 1;
      continue;
    }

    const airportId = airportIds.get(a.iataCode);
    if (!airportId) {
      throw new Error(`bootstrap-real: missing airport id for ${a.iataCode} while inserting market_scopes`);
    }

    const [row] = db
      .insert(marketScopes)
      .values({
        scopeType: 'AIRPORT' as const,
        code: a.iataCode,
        displayName: `${a.cityName} (${a.iataCode})`,
        airportIds: [airportId],
      })
      .returning({ id: marketScopes.id })
      .all();
    ids.set(a.iataCode, row.id);
    counts.inserted += 1;
  }

  return { ids, counts };
}

interface DefinitionRecord {
  id: number;
  market: RealMarket;
  mode: 'FLEXIBLE' | 'EXACT';
  slug: string;
  wasInserted: boolean;
}

function insertDefinitionsIdempotent(
  db: DbClient,
  scopeIds: Map<string, number>,
  now: number
): DefinitionRecord[] {
  const definitions: DefinitionRecord[] = [];

  for (const market of REAL_MARKETS) {
    const originScopeId = scopeIds.get(market.origin);
    const destScopeId = scopeIds.get(market.destination);
    if (!originScopeId || !destScopeId) {
      throw new Error(`bootstrap-real: missing market_scopes for market ${market.id}`);
    }

    const flexSlug = `${market.id}-flex-v1`;
    const existingFlex = db.select().from(searchDefinitions).where(eq(searchDefinitions.slug, flexSlug)).get();
    if (existingFlex) {
      definitions.push({ id: existingFlex.id, market, mode: 'FLEXIBLE', slug: flexSlug, wasInserted: false });
    } else {
      const flexQuery = resolveFlexibleQuery(market, now);
      const windowStartRule = `now+${config.demoDefaults.flexibleWindowMinDays}d`;
      const windowEndRule = `now+${config.demoDefaults.flexibleWindowMaxDays}d`;
      const [row] = db
        .insert(searchDefinitions)
        .values({
          slug: flexSlug,
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
      definitions.push({ id: row.id, market, mode: 'FLEXIBLE', slug: flexSlug, wasInserted: true });
    }

  }

  return definitions;
}

function runBootstrap(db: DbClient, resolveDatabasePath: () => string, sqlite: { close: () => void }) {
  const start = Date.now();
  const dbPath = resolveDatabasePath();
  console.log(`[bootstrap-real] Target database: ${dbPath}`);

  console.log('[bootstrap-real] Running migrations...');
  migrate(db, { migrationsFolder: './db/migrations' });
  console.log('[bootstrap-real] Migrations complete.');

  const now = Date.now();

  const { ids: airportIds, counts: airportCounts } = insertAirportsIdempotent(db);
  console.log(
    `[bootstrap-real] airports: ${airportCounts.inserted} inserted, ${airportCounts.skipped} already present (${airportIds.size} total).`
  );

  const { ids: scopeIds, counts: scopeCounts } = insertScopesIdempotent(db, airportIds);
  console.log(
    `[bootstrap-real] market_scopes: ${scopeCounts.inserted} inserted, ${scopeCounts.skipped} already present (${scopeIds.size} total).`
  );

  const definitions = insertDefinitionsIdempotent(db, scopeIds, now);
  const defInserted = definitions.filter((d) => d.wasInserted).length;
  const defSkipped = definitions.length - defInserted;
  console.log(
    `[bootstrap-real] search_definitions: ${defInserted} inserted, ${defSkipped} already present (${definitions.length} total, covering ${REAL_MARKETS.length} markets).`
  );
  for (const def of definitions) {
    console.log(`  [${def.wasInserted ? 'new' : 'existing'}] ${def.slug} (id=${def.id}, mode=${def.mode})`);
  }

  // Deactivate any definition not in the current roster (e.g. demo-roster
  // routes with no Aviasales coverage, or retired exact-date definitions):
  // ingest only sweeps active definitions, so this is what actually stops
  // wasting API budget on dead routes. History rows are preserved.
  const rosterSlugs = new Set(definitions.map((d) => d.slug));
  const allDefs = db.select().from(searchDefinitions).all();
  let deactivated = 0;
  for (const def of allDefs) {
    if (!rosterSlugs.has(def.slug) && def.active) {
      db.update(searchDefinitions).set({ active: false }).where(eq(searchDefinitions.id, def.id)).run();
      deactivated += 1;
      console.log(`  [deactivated] ${def.slug} (not in real roster)`);
    }
  }
  if (deactivated > 0) {
    console.log(`[bootstrap-real] Deactivated ${deactivated} non-roster definition(s).`);
  }

  console.log(
    '\n[bootstrap-real] Deliberately did NOT insert search_runs or offer_observations — those only come from `npm run ingest` against the live travelpayouts provider.'
  );
  console.log(`[bootstrap-real] Done in ${Date.now() - start}ms.`);
  console.log(`\nNext: DATABASE_PATH=${dbPath} DATA_PROVIDER=travelpayouts npm run ingest`);

  sqlite.close();
}

main().catch((err) => {
  console.error('[bootstrap-real] Failed:', err);
  process.exit(1);
});
