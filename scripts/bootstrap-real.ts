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
import { isMainModule } from '../jobs/_shared';

const DEFAULT_REAL_DB_PATH = 'data/real.db';
const FORBIDDEN_PATH_MARKERS = ['fare-terminal.db'];

/** Real-mode tracked markets. WP-P1 REFOCUS (2026-08-13): the site is being
 * repurposed as the owner's personal fare terminal (home airport SEA), so
 * the roster is deliberately shrunk and re-centered from WP-F2's 26 generic
 * trunk-route markets down to 18 — the routes he actually cares about
 * ("PERSONAL") plus a small kept set for index/movers stability
 * ("BENCHMARK"). Everything from the old 26-route roster not listed below
 * is deactivated by this file's existing idempotent deactivation pass
 * (history is preserved, just stops consuming ingest budget).
 *
 * PERSONAL coverage was measured via a single live /v1/city-directions
 * probe against origin=SEA on 2026-08-02 (see the WP-P1 brief's measured
 * facts) — that endpoint returned 30 destinations from ONE request,
 * including MSP $284, PHX $290, HNL $405, LIH $456, SFO $200, SJC $246; it
 * is the only free source with any coverage for most of these personal
 * routes. Per-route prices_for_dates/calendar OFFER counts (the deeper,
 * per-itinerary data these search_definitions rows actually track) were
 * separately probed the same session: SFO 8, SJC 2, OAK 1, VCE 2, MXP 1,
 * MKE 1, MCO 1, KOA 1, HNL 1 (all thin but non-zero — kept because they're
 * personally relevant, not because the offer coverage is dense); FCO is
 * kept from the original roster (2 offers, 2026-07-24) both for its
 * existing history and because Italy is a market he cares about. MSP, PHX,
 * TUS, FCO's Italy siblings (MXP/VCE, already listed), CDG, NCE, OGG, LIH,
 * SBA, STS measured 0 prices_for_dates/calendar offers this session — those
 * are NOT in REAL_MARKETS (no full-tracking search_definitions row would
 * ever get real observations), but their airports/market_scopes ARE
 * pre-created below so P3's SerpApi definitions (sea-cdg, sea-ogg, sea-lih,
 * sea-phx, sea-msp, sea-tus) and the "From Seattle" home board (which reads
 * city-directions, not prices_for_dates, and DOES have coverage for these)
 * have scopes to attach to.
 *
 * BENCHMARK routes are unchanged from WP-F2's roster, kept purely to give
 * the Fare Terminal Index (jobs/index-series.ts) and any cross-route movers
 * view a stable, internationally-diverse comparison set independent of the
 * personal roster's volatility. */
interface RealMarket {
  id: string;
  origin: string;
  destination: string;
}

const REAL_MARKETS: readonly RealMarket[] = [
  // --- PERSONAL: full-tracking routes from SEA, the owner's home airport.
  // Offer counts are prices_for_dates/calendar counts probed 2026-08-02
  // (round-trip, departure_at=2026-09) unless noted otherwise. ---
  { id: 'sea-sfo', origin: 'SEA', destination: 'SFO' }, // 8
  { id: 'sea-sjc', origin: 'SEA', destination: 'SJC' }, // 2
  { id: 'sea-oak', origin: 'SEA', destination: 'OAK' }, // 1
  { id: 'sea-vce', origin: 'SEA', destination: 'VCE' }, // 2
  { id: 'sea-mxp', origin: 'SEA', destination: 'MXP' }, // 1
  { id: 'sea-mke', origin: 'SEA', destination: 'MKE' }, // 1
  { id: 'sea-mco', origin: 'SEA', destination: 'MCO' }, // 1
  { id: 'sea-koa', origin: 'SEA', destination: 'KOA' }, // 1
  { id: 'sea-hnl', origin: 'SEA', destination: 'HNL' }, // 1
  { id: 'sea-fco', origin: 'SEA', destination: 'FCO' }, // 2 (2026-07-24; kept — existing history + Italy)
  { id: 'sea-iah', origin: 'SEA', destination: 'IAH' }, // 1 (2026-08-13)

  // --- BENCHMARK: kept for Fare Terminal Index / movers stability, unchanged
  // from the WP-F2 roster (probed offer counts in comments below). ---
  { id: 'jfk-lhr', origin: 'JFK', destination: 'LHR' }, // 14 (2026-07-24) / 9 RT, 22 one-way (2026-08-02)
  { id: 'lax-hnd', origin: 'LAX', destination: 'HND' }, // 24 (2026-07-24) / 12 (2026-08-02)
  { id: 'jfk-cdg', origin: 'JFK', destination: 'CDG' }, // 14 (2026-07-24)
  { id: 'lax-nrt', origin: 'LAX', destination: 'NRT' }, // 8 (2026-07-24)
  { id: 'ord-cdg', origin: 'ORD', destination: 'CDG' }, // 8 (2026-07-24) / 1 RT, 2 one-way (2026-08-02)
  { id: 'sfo-bcn', origin: 'SFO', destination: 'BCN' }, // 8 (2026-07-24)
  { id: 'mia-mad', origin: 'MIA', destination: 'MAD' }, // 4 (2026-07-24)
  { id: 'ewr-bcn', origin: 'EWR', destination: 'BCN' }, // 4 (2026-07-24)
];

// Budget check (per sweep, TP_MAX_REQUESTS_PER_HOUR ceiling ~150-200/h in
// production — see .github/workflows/real-data-refresh.yml): 19 active
// routes (18 + sea-iah, added 2026-08-13) x <=3 requests/route (ingest's
// prices_for_dates fan-out) + heatmap <=24 (config.heatmap.monthsAhead x
// the current stagger bucket's share of 19 routes, worst case +3 vs. the
// 18-route figure) + related <=3 (one city-directions call per distinct
// roster origin's stagger bucket) + deals 1 (unfiltered /v2/prices/latest)
// + home-board 1 (WP-P1's unconditional single city-directions call
// against SEA) ~= <=83/sweep. Comfortably under budget with no
// TP_MAX_REQUESTS_PER_HOUR change needed.

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
  // Added by WP-F2 for the 16-route roster expansion (kept even though
  // WP-P1 dropped the routes that referenced them, so any pre-existing
  // history rows for those routes keep a resolvable airport/scope):
  { iataCode: 'GRU', name: 'Sao Paulo-Guarulhos International', cityName: 'Sao Paulo', countryCode: 'BR', latitude: -23.4356, longitude: -46.4731, timezone: 'America/Sao_Paulo' },
  { iataCode: 'LIM', name: 'Jorge Chavez International', cityName: 'Lima', countryCode: 'PE', latitude: -12.0219, longitude: -77.1143, timezone: 'America/Lima' },
  { iataCode: 'DFW', name: 'Dallas/Fort Worth International', cityName: 'Dallas', countryCode: 'US', latitude: 32.8998, longitude: -97.0403, timezone: 'America/Chicago' },
  { iataCode: 'AMS', name: 'Amsterdam Airport Schiphol', cityName: 'Amsterdam', countryCode: 'NL', latitude: 52.3105, longitude: 4.7683, timezone: 'Europe/Amsterdam' },

  // Added by WP-P1 for the "From Seattle" personal roster + home-board
  // groups (domain/config.ts#homeBoard). Every code referenced by
  // REAL_MARKETS' PERSONAL routes AND every homeBoard group code gets an
  // airport + AIRPORT market_scope here, even the ones with zero
  // prices_for_dates/calendar offer coverage (PHX/MSP/TUS/OGG/LIH/SBA/STS/
  // NCE — see the REAL_MARKETS doc comment) — those still need scopes for
  // P3's future SerpApi definitions and so the home board (a
  // city-directions read, which HAS coverage for them) can resolve a
  // cityName and a potential trackedRouteSlug lookup without throwing.
  { iataCode: 'SJC', name: 'Norman Y. Mineta San Jose International', cityName: 'San Jose', countryCode: 'US', latitude: 37.3639, longitude: -121.9289, timezone: 'America/Los_Angeles' },
  { iataCode: 'OAK', name: 'Oakland International', cityName: 'Oakland', countryCode: 'US', latitude: 37.7126, longitude: -122.2197, timezone: 'America/Los_Angeles' },
  { iataCode: 'MKE', name: 'Milwaukee Mitchell International', cityName: 'Milwaukee', countryCode: 'US', latitude: 42.9472, longitude: -87.8966, timezone: 'America/Chicago' },
  { iataCode: 'KOA', name: 'Ellison Onizuka Kona International', cityName: 'Kailua-Kona', countryCode: 'US', latitude: 19.7388, longitude: -156.0456, timezone: 'Pacific/Honolulu' },
  { iataCode: 'OGG', name: 'Kahului Airport', cityName: 'Kahului', countryCode: 'US', latitude: 20.8986, longitude: -156.4305, timezone: 'Pacific/Honolulu' },
  { iataCode: 'LIH', name: 'Lihue Airport', cityName: 'Lihue', countryCode: 'US', latitude: 21.976, longitude: -159.339, timezone: 'Pacific/Honolulu' },
  { iataCode: 'TUS', name: 'Tucson International', cityName: 'Tucson', countryCode: 'US', latitude: 32.1161, longitude: -110.941, timezone: 'America/Phoenix' },
  { iataCode: 'SBA', name: 'Santa Barbara Municipal', cityName: 'Santa Barbara', countryCode: 'US', latitude: 34.4262, longitude: -119.8415, timezone: 'America/Los_Angeles' },
  { iataCode: 'STS', name: 'Charles M. Schulz Sonoma County', cityName: 'Santa Rosa', countryCode: 'US', latitude: 38.5091, longitude: -122.8134, timezone: 'America/Los_Angeles' },
  { iataCode: 'SAN', name: 'San Diego International', cityName: 'San Diego', countryCode: 'US', latitude: 32.7338, longitude: -117.1933, timezone: 'America/Los_Angeles' },
  { iataCode: 'NCE', name: "Nice Cote d'Azur", cityName: 'Nice', countryCode: 'FR', latitude: 43.6584, longitude: 7.2159, timezone: 'Europe/Paris' },
  { iataCode: 'PHX', name: 'Phoenix Sky Harbor International', cityName: 'Phoenix', countryCode: 'US', latitude: 33.4373, longitude: -112.0078, timezone: 'America/Phoenix' },
  { iataCode: 'VCE', name: 'Venice Marco Polo', cityName: 'Venice', countryCode: 'IT', latitude: 45.5053, longitude: 12.3519, timezone: 'Europe/Rome' },
  { iataCode: 'MXP', name: 'Milan Malpensa', cityName: 'Milan', countryCode: 'IT', latitude: 45.6306, longitude: 8.7281, timezone: 'Europe/Rome' },
  { iataCode: 'MCO', name: 'Orlando International', cityName: 'Orlando', countryCode: 'US', latitude: 28.4312, longitude: -81.3081, timezone: 'America/New_York' },
  { iataCode: 'HNL', name: 'Daniel K. Inouye International', cityName: 'Honolulu', countryCode: 'US', latitude: 21.3245, longitude: -157.9251, timezone: 'Pacific/Honolulu' },

  // Added 2026-08-13 for the homeBoard.groups 'texas' group + sea-iah
  // (PERSONAL, 1 offer probed 2026-08-13). DFW already exists above (added
  // by WP-F2); HOU is watch-level only (no REAL_MARKETS row) but still
  // needs an airport/scope so the home board can resolve it.
  { iataCode: 'IAH', name: 'George Bush Intercontinental', cityName: 'Houston', countryCode: 'US', latitude: 29.9902, longitude: -95.3368, timezone: 'America/Chicago' },
  { iataCode: 'HOU', name: 'William P. Hobby', cityName: 'Houston', countryCode: 'US', latitude: 29.6454, longitude: -95.2789, timezone: 'America/Chicago' },
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

// Exported (only for tests — see tests/integration/wp-p1.test.ts) so the
// roster-deactivation behavior can be exercised directly against a temp DB
// via the real REAL_MARKETS roster, without going through main()'s
// CLI-only env/argv plumbing.
export function runBootstrap(db: DbClient, resolveDatabasePath: () => string, sqlite: { close: () => void }) {
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
  //
  // IMPORTANT: this must also spare config.serpapi.routes — WP-P3's
  // SerpApi-only personal routes (sea-cdg, sea-ogg, sea-lih, sea-phx,
  // sea-msp, sea-nce, ...) are tracked via a completely separate mechanism
  // (bootstrap-serpapi.ts creates their search_definitions rows; jobs/
  // ingest.ts routes them to serpapiProvider per-definition, NOT via
  // REAL_MARKETS/DATA_PROVIDER — see domain/config.ts#serpapi's doc
  // comment). Those routes are deliberately absent from REAL_MARKETS
  // (travelpayouts has ~0 coverage for them), so without this exclusion
  // every re-run of bootstrap:real would deactivate P3's routes out from
  // under it. A route's "${id}" is its slug with the trailing
  // "-flex-v1"/"-exact-v1" suffix stripped (bootstrap-serpapi.ts's slug
  // convention, matching REAL_MARKETS' own `${id}-flex-v1` convention here).
  const rosterSlugs = new Set(definitions.map((d) => d.slug));
  const serpapiRouteIds = new Set<string>(config.serpapi.routes);
  function isSerpapiRouteSlug(slug: string): boolean {
    const routeId = slug.replace(/-(flex|exact)-v\d+$/, '');
    return serpapiRouteIds.has(routeId);
  }
  const allDefs = db.select().from(searchDefinitions).all();
  let deactivated = 0;
  for (const def of allDefs) {
    if (!rosterSlugs.has(def.slug) && def.active && !isSerpapiRouteSlug(def.slug)) {
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

// Guarded like every jobs/*.ts CLI entry (isMainModule/runCli convention,
// see jobs/_shared.ts) so this module can be safely imported for its
// `runBootstrap` export (see tests/integration/wp-p1.test.ts's
// roster-deactivation coverage) WITHOUT firing the real CLI flow --
// unguarded, an import alone used to run main() as a side effect, which
// would also close() the shared sqlite handle any other already-imported
// module holds a reference to.
if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error('[bootstrap-real] Failed:', err);
    process.exit(1);
  });
}
