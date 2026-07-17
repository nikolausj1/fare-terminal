// Idempotent demo-data seed script. Invoked via `npm run seed`.
//
// Wipes every table this work package owns (in FK-safe order) and
// re-inserts: airports, one AIRPORT market_scope per airport, one FLEXIBLE
// search_definitions row per market (plus an EXACT one for two markets),
// search_runs, and offer_observations built from db/seed/generate.ts.
//
// Does NOT populate market_snapshots / market_events / recommendations /
// analyst_notes — those are derived by a later pipeline job (WP3+), but
// their tables are still cleared here for idempotency since they carry FKs
// into the tables this script rebuilds.

import { config } from '@/domain/config';
import { getNow } from '@/lib/demo-time';

import { db, resolveDatabasePath, sqlite } from '../index';
import {
  airports,
  analystNotes,
  marketEvents,
  marketScopes,
  marketSnapshots,
  offerObservations,
  providerHealth,
  recommendations,
  searchDefinitions,
  searchRuns,
} from '../schema';
import {
  generateMarketHistory,
  itineraryFingerprint,
  resolveExactQuery,
  resolveFlexibleQuery,
} from './generate';
import { AIRPORTS, MARKETS, type MarketSpec } from './markets';

const CHUNK_SIZE = 500;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function wipe() {
  // Reverse FK order: leaves before roots.
  db.delete(analystNotes).run();
  db.delete(recommendations).run();
  db.delete(marketEvents).run();
  db.delete(marketSnapshots).run();
  db.delete(offerObservations).run();
  db.delete(searchRuns).run();
  db.delete(searchDefinitions).run();
  db.delete(marketScopes).run();
  db.delete(providerHealth).run();
  db.delete(airports).run();
}

function insertAirports(): Map<string, number> {
  const ids = new Map<string, number>();
  const rows = AIRPORTS.map((a) => ({
    iataCode: a.iataCode,
    icaoCode: a.icaoCode ?? null,
    name: a.name,
    cityName: a.cityName,
    countryCode: a.countryCode,
    latitude: a.latitude,
    longitude: a.longitude,
    timezone: a.timezone,
    active: true,
  }));
  const inserted = db.insert(airports).values(rows).returning({
    id: airports.id,
    iataCode: airports.iataCode,
  }).all();
  for (const row of inserted) ids.set(row.iataCode, row.id);
  return ids;
}

function insertScopes(airportIds: Map<string, number>): Map<string, number> {
  const scopeIds = new Map<string, number>();
  const rows = AIRPORTS.map((a) => ({
    scopeType: 'AIRPORT' as const,
    code: a.iataCode,
    displayName: `${a.cityName} (${a.iataCode})`,
    airportIds: [airportIds.get(a.iataCode)!],
  }));
  const inserted = db.insert(marketScopes).values(rows).returning({
    id: marketScopes.id,
    code: marketScopes.code,
  }).all();
  for (const row of inserted) scopeIds.set(row.code, row.id);
  return scopeIds;
}

interface DefinitionRecord {
  id: number;
  market: MarketSpec;
  mode: 'FLEXIBLE' | 'EXACT';
  slug: string;
}

function insertDefinitions(scopeIds: Map<string, number>, now: number): DefinitionRecord[] {
  const definitions: DefinitionRecord[] = [];
  const createdAt = now;

  for (const market of MARKETS) {
    const originScopeId = scopeIds.get(market.origin);
    const destScopeId = scopeIds.get(market.destination);
    if (!originScopeId || !destScopeId) {
      throw new Error(`Missing market scope for market ${market.id}`);
    }

    const flexQuery = resolveFlexibleQuery(market, now);
    const flexSlug = `${market.id}-flex-v1`;
    // The window itself is resolved fresh per search run (see
    // resolveFlexibleQuery), so the definition only stores the *rule*
    // (relative offsets from config.demoDefaults) rather than concrete
    // dates.
    const windowStartRule = `now+${config.demoDefaults.flexibleWindowMinDays}d`;
    const windowEndRule = `now+${config.demoDefaults.flexibleWindowMaxDays}d`;
    const [flexRow] = db
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
        benchmarkMethodologyVersion: 'benchmark-v1',
        createdAt,
        active: true,
      })
      .returning({ id: searchDefinitions.id })
      .all();
    definitions.push({ id: flexRow.id, market, mode: 'FLEXIBLE', slug: flexSlug });

    if (market.includeExactDefinition) {
      const exactQuery = resolveExactQuery(market, now);
      const exactSlug = `${market.id}-exact-v1`;
      const [exactRow] = db
        .insert(searchDefinitions)
        .values({
          slug: exactSlug,
          originScopeId,
          destinationScopeId: destScopeId,
          mode: 'EXACT',
          tripType: exactQuery.tripType,
          departureDate: exactQuery.departureDate,
          returnDate: exactQuery.returnDate,
          cabin: exactQuery.cabin,
          adults: exactQuery.adults,
          maxStops: exactQuery.maxStops,
          currency: exactQuery.currency,
          benchmarkMethodologyVersion: 'benchmark-v1',
          createdAt,
          active: true,
        })
        .returning({ id: searchDefinitions.id })
        .all();
      definitions.push({ id: exactRow.id, market, mode: 'EXACT', slug: exactSlug });
    }
  }

  return definitions;
}

interface SeedTotals {
  runs: number;
  observations: number;
  minObservedAt: number;
  maxObservedAt: number;
}

function insertHistoryForDefinition(def: DefinitionRecord, now: number): SeedTotals {
  const options =
    def.mode === 'EXACT' ? { exactQuery: resolveExactQuery(def.market, now) } : undefined;
  const history = generateMarketHistory(def.market, now, options);

  let observations = 0;
  let minObservedAt = Number.POSITIVE_INFINITY;
  let maxObservedAt = Number.NEGATIVE_INFINITY;

  db.transaction((tx) => {
    for (const run of history) {
      const [runRow] = tx
        .insert(searchRuns)
        .values({
          searchDefinitionId: def.id,
          providerId: 'demo',
          startedAt: run.runAt,
          completedAt: run.runAt,
          status: 'SUCCESS',
          offerCountRaw: run.offers.length,
          offerCountNormalized: run.offers.length,
        })
        .returning({ id: searchRuns.id })
        .all();

      const rows = run.offers.map((offer) => ({
        searchRunId: runRow.id,
        searchDefinitionId: def.id,
        providerId: offer.providerId,
        providerOfferId: offer.providerOfferId,
        itineraryFingerprint: itineraryFingerprint(offer),
        observedAt: offer.observedAt,
        expiresAt: offer.expiresAt ?? null,
        currency: offer.currency,
        totalPriceMinor: offer.totalPriceMinor,
        basePriceMinor: offer.basePriceMinor ?? null,
        taxesMinor: offer.taxesMinor ?? null,
        optionalFeesKnown: offer.optionalFeesKnown,
        validatingCarrier: offer.validatingCarrier,
        marketingCarriers: offer.marketingCarriers,
        operatingCarriers: offer.operatingCarriers,
        segmentsJson: offer.segments,
        durationMinutes: offer.durationMinutes,
        stopCount: offer.stopCount,
        cabin: offer.cabin,
        fareBrand: offer.fareBrand ?? null,
        bookingClassesJson: offer.bookingClasses ?? null,
        seatsRemaining: offer.seatsRemaining ?? null,
        outboundUrl: offer.outboundUrl ?? null,
        qualityFlags: offer.qualityFlags,
      }));

      for (const batch of chunk(rows, CHUNK_SIZE)) {
        tx.insert(offerObservations).values(batch).run();
      }

      observations += run.offers.length;
      minObservedAt = Math.min(minObservedAt, run.runAt);
      maxObservedAt = Math.max(maxObservedAt, run.runAt);
    }
  });

  return { runs: history.length, observations, minObservedAt, maxObservedAt };
}

function main() {
  const start = Date.now();
  const now = getNow();
  console.log(`Seeding database at ${resolveDatabasePath()}`);
  console.log(`Demo "now" anchor: ${new Date(now).toISOString()}`);

  wipe();
  console.log('Wiped existing rows (airports, market_scopes, search_definitions, search_runs, offer_observations, and downstream tables).');

  const airportIds = insertAirports();
  console.log(`Inserted ${airportIds.size} airports.`);

  const scopeIds = insertScopes(airportIds);
  console.log(`Inserted ${scopeIds.size} AIRPORT market_scopes.`);

  const definitions = insertDefinitions(scopeIds, now);
  console.log(`Inserted ${definitions.length} search_definitions (${MARKETS.length} markets).`);

  let totalRuns = 0;
  let totalObservations = 0;
  let overallMin = Number.POSITIVE_INFINITY;
  let overallMax = Number.NEGATIVE_INFINITY;

  console.log('\nMarket -> scenario:');
  for (const market of MARKETS) {
    console.log(`  ${market.id.padEnd(12)} ${market.scenario.padEnd(20)} ${market.scenarioLabel}`);
  }
  console.log('');

  for (const def of definitions) {
    const totals = insertHistoryForDefinition(def, now);
    totalRuns += totals.runs;
    totalObservations += totals.observations;
    if (totals.minObservedAt < overallMin) overallMin = totals.minObservedAt;
    if (totals.maxObservedAt > overallMax) overallMax = totals.maxObservedAt;
    console.log(
      `  [${def.slug}] ${totals.runs} runs, ${totals.observations} offer_observations`
    );
  }

  console.log('\nRow counts:');
  console.log(`  airports:            ${airportIds.size}`);
  console.log(`  market_scopes:       ${scopeIds.size}`);
  console.log(`  search_definitions:  ${definitions.length}`);
  console.log(`  search_runs:         ${totalRuns}`);
  console.log(`  offer_observations:  ${totalObservations}`);
  console.log(
    `\nDate range covered: ${new Date(overallMin).toISOString()} .. ${new Date(overallMax).toISOString()}`
  );

  const elapsedMs = Date.now() - start;
  console.log(`\nSeed complete in ${elapsedMs}ms.`);

  sqlite.close();
}

main();
