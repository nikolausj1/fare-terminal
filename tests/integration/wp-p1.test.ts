// Integration coverage for WP-P1 (the "From Seattle" personal home board):
// the city_direction_history migration, jobs/home-board.ts against an
// injected fake TravelpayoutsExtras (no network) covering append-vs-upsert
// semantics, lib/markets/home-board.ts's group/extras assembly and DB-backed
// lookups (cityName, trackedRouteSlug), and scripts/bootstrap-real.ts's
// roster-deactivation behavior run against the REAL REAL_MARKETS roster.
// Same pattern as tests/integration/wp-f2.test.ts — a real (temp file)
// SQLite DB migrated with the actual Drizzle migrations, with
// DATABASE_PATH set before any module that transitively opens db/index.ts
// is imported. Pure percentile/sparkline/changePct7d math is covered
// separately, without a DB, in tests/unit/homeBoardMetrics.test.ts.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type {
  CityDirectionsResult,
  LatestDealsResult,
  MonthMatrixResult,
  TravelpayoutsExtras,
} from '@/lib/providers/travelpayouts/extras';

let dbPath: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let dbMod: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let schema: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let drizzleOrm: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let homeBoardJob: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let homeBoardRead: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let bootstrapReal: any;

const DAY_MS = 86_400_000;
const NOW = Date.parse('2026-08-13T12:00:00.000Z');

beforeAll(async () => {
  dbPath = path.join(os.tmpdir(), `fare-terminal-wp-p1-${process.pid}-${Date.now()}.db`);
  process.env.DATABASE_PATH = dbPath;
  delete process.env.VERCEL;
  delete process.env.DB_READONLY;

  drizzleOrm = await import('drizzle-orm');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  dbMod = await import('@/db');
  migrate(dbMod.db, { migrationsFolder: './db/migrations' });

  schema = await import('@/db/schema');
  homeBoardJob = await import('@/jobs/home-board');
  homeBoardRead = await import('@/lib/markets/home-board');
  bootstrapReal = await import('../../scripts/bootstrap-real');
}, 60_000);

afterAll(() => {
  dbMod.sqlite.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
});

// ---------------------------------------------------------------------------
// jobs/home-board.ts: append-only history vs. upsert-replace related_fares
// ---------------------------------------------------------------------------

describe('jobs/home-board.ts (refreshHomeBoard)', () => {
  function fakeExtras(fares: CityDirectionsResult['fares']): TravelpayoutsExtras {
    return {
      async fetchMonthMatrix(): Promise<MonthMatrixResult> {
        throw new Error('not used in this test');
      },
      async fetchCityDirections(origin): Promise<CityDirectionsResult> {
        return { origin, fares, warnings: [] };
      },
      async fetchLatestDeals(): Promise<LatestDealsResult> {
        throw new Error('not used in this test');
      },
    };
  }

  it('is unconditional (always 1 request), appends city_direction_history, and upserts related_fares', async () => {
    const summary = await homeBoardJob.refreshHomeBoard(
      NOW,
      fakeExtras([
        { destination: 'SFO', priceMajor: 200, airline: 'AS', departureAt: undefined, returnAt: undefined, distanceKm: 1093 },
        { destination: 'HNL', priceMajor: 405, airline: 'AS', departureAt: undefined, returnAt: undefined, distanceKm: 4364 },
      ])
    );

    expect(summary.origin).toBe('SEA');
    expect(summary.requestsMade).toBe(1);
    expect(summary.destinationsObserved).toBe(2);
    expect(summary.historyRowsAppended).toBe(2);
    expect(summary.relatedFaresUpserted).toBe(2);
    expect(summary.errors).toEqual([]);

    const historyRows = dbMod.db
      .select()
      .from(schema.cityDirectionHistory)
      .where(drizzleOrm.eq(schema.cityDirectionHistory.origin, 'SEA'))
      .all();
    expect(historyRows).toHaveLength(2);
    expect(historyRows.find((r: { destination: string }) => r.destination === 'SFO').priceMinor).toBe(20000);

    const relatedRows = dbMod.db
      .select()
      .from(schema.relatedFares)
      .where(drizzleOrm.eq(schema.relatedFares.origin, 'SEA'))
      .all();
    expect(relatedRows).toHaveLength(2);
  });

  it('a second sweep APPENDS to city_direction_history (never replacing) but REPLACES related_fares in place', async () => {
    const laterNow = NOW + DAY_MS;
    const summary = await homeBoardJob.refreshHomeBoard(
      laterNow,
      fakeExtras([
        { destination: 'SFO', priceMajor: 180, airline: 'AS', departureAt: undefined, returnAt: undefined, distanceKm: 1093 }, // cheaper this sweep
        { destination: 'HNL', priceMajor: 420, airline: 'AS', departureAt: undefined, returnAt: undefined, distanceKm: 4364 },
      ])
    );
    expect(summary.historyRowsAppended).toBe(2);
    expect(summary.relatedFaresUpserted).toBe(2);

    const historyRows = dbMod.db
      .select()
      .from(schema.cityDirectionHistory)
      .where(drizzleOrm.eq(schema.cityDirectionHistory.origin, 'SEA'))
      .all();
    expect(historyRows).toHaveLength(4); // 2 + 2, both sweeps preserved

    const sfoHistory = historyRows.filter((r: { destination: string }) => r.destination === 'SFO');
    expect(sfoHistory).toHaveLength(2);
    expect(sfoHistory.map((r: { priceMinor: number }) => r.priceMinor).sort((a: number, b: number) => a - b)).toEqual([18000, 20000]);

    const relatedRows = dbMod.db
      .select()
      .from(schema.relatedFares)
      .where(drizzleOrm.eq(schema.relatedFares.origin, 'SEA'))
      .all();
    expect(relatedRows).toHaveLength(2); // still 2, replaced not duplicated
    const sfoRelated = relatedRows.find((r: { destination: string }) => r.destination === 'SFO');
    expect(sfoRelated.priceMinor).toBe(18000); // latest price won
  });

  it('reports an error and appends nothing when the provider call throws', async () => {
    const failingExtras: TravelpayoutsExtras = {
      async fetchMonthMatrix(): Promise<MonthMatrixResult> {
        throw new Error('not used');
      },
      async fetchCityDirections(): Promise<CityDirectionsResult> {
        throw new Error('simulated provider failure');
      },
      async fetchLatestDeals(): Promise<LatestDealsResult> {
        throw new Error('not used');
      },
    };

    const before = dbMod.db.select().from(schema.cityDirectionHistory).all().length;
    const summary = await homeBoardJob.refreshHomeBoard(NOW + 2 * DAY_MS, failingExtras);

    expect(summary.requestsMade).toBe(0);
    expect(summary.historyRowsAppended).toBe(0);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0].message).toContain('simulated provider failure');

    const after = dbMod.db.select().from(schema.cityDirectionHistory).all().length;
    expect(after).toBe(before); // nothing appended on failure
  });
});

// ---------------------------------------------------------------------------
// lib/markets/home-board.ts: getHomeBoard() grouping / extras / DB lookups
// ---------------------------------------------------------------------------

describe('lib/markets/home-board.ts (getHomeBoard)', () => {
  beforeAll(() => {
    // A city-directions-style airport row for OAK (bay-area group -- SFO
    // and HNL are deliberately avoided here since the jobs/home-board.ts
    // describe block above already wrote SEA history rows for those two)
    // and a tracked FLEXIBLE search_definition for SEA-OAK, so
    // trackedRouteSlug resolves. STS (california group) deliberately gets
    // NO rows at all, to exercise the "never observed" honesty path.
    // MEX/DEN are extras (not in any homeBoard group).
    dbMod.db
      .insert(schema.airports)
      .values([
        { iataCode: 'OAK', name: 'Oakland Intl', cityName: 'Oakland', countryCode: 'US', latitude: 37.7126, longitude: -122.2197, timezone: 'America/Los_Angeles', active: true },
        { iataCode: 'MEX', name: 'Mexico City Intl', cityName: 'Mexico City', countryCode: 'MX', latitude: 19.4363, longitude: -99.0721, timezone: 'America/Mexico_City', active: true },
        // Deliberately no airports row for DEN -- exercises cityName: null.
      ])
      .run();

    const [seaScope] = dbMod.db
      .insert(schema.marketScopes)
      .values({ scopeType: 'AIRPORT', code: 'SEA', displayName: 'Seattle (SEA)', airportIds: [] })
      .returning({ id: schema.marketScopes.id })
      .all();
    const [oakScope] = dbMod.db
      .insert(schema.marketScopes)
      .values({ scopeType: 'AIRPORT', code: 'OAK', displayName: 'Oakland (OAK)', airportIds: [] })
      .returning({ id: schema.marketScopes.id })
      .all();

    dbMod.db
      .insert(schema.searchDefinitions)
      .values({
        slug: 'sea-oak-flex-v1',
        originScopeId: seaScope.id,
        destinationScopeId: oakScope.id,
        mode: 'FLEXIBLE',
        tripType: 'ROUND_TRIP',
        cabin: 'ECONOMY',
        adults: 1,
        maxStops: 1,
        currency: 'USD',
        benchmarkMethodologyVersion: 'benchmark-v1',
        createdAt: NOW,
        active: true,
      })
      .run();

    // OAK: 3 observations (rich enough for a non-empty sparkline, thin
    // enough to stay below minObservationsForPercentile so this suite
    // doesn't duplicate the percentile-threshold math already covered in
    // tests/unit/homeBoardMetrics.test.ts).
    const oakRows = [220, 210, 200].map((price, i) => ({
      origin: 'SEA',
      destination: 'OAK',
      priceMinor: price * 100,
      observedAt: NOW - (2 - i) * DAY_MS,
      foundAt: null,
    }));
    dbMod.db.insert(schema.cityDirectionHistory).values(oakRows).run();

    // Extras: DEN and MEX, not in any homeBoard group.
    dbMod.db
      .insert(schema.cityDirectionHistory)
      .values([
        { origin: 'SEA', destination: 'DEN', priceMinor: 15000, observedAt: NOW, foundAt: null },
        { origin: 'SEA', destination: 'MEX', priceMinor: 9500, observedAt: NOW, foundAt: null },
      ])
      .run();
  });

  it('every configured group code is present, with null price for a never-observed destination', () => {
    const board = homeBoardRead.getHomeBoard(NOW);

    expect(board.origin).toBe('SEA');
    expect(board.originCity).toBe('Seattle');

    const bayArea = board.groups.find((g: { id: string }) => g.id === 'bay-area');
    expect(bayArea).toBeDefined();
    expect(bayArea.destinations.map((d: { code: string }) => d.code)).toEqual(['SFO', 'SJC', 'OAK']);

    const sjc = bayArea.destinations.find((d: { code: string }) => d.code === 'SJC');
    expect(sjc.currentPriceMinor).toBeNull();
    expect(sjc.observationCount).toBe(0);
    expect(sjc.sparkline).toEqual([]);

    const california = board.groups.find((g: { id: string }) => g.id === 'california');
    const sts = california.destinations.find((d: { code: string }) => d.code === 'STS');
    expect(sts).toBeDefined(); // present even though it has zero coverage -- the "honesty" requirement
    expect(sts.currentPriceMinor).toBeNull();

    const texas = board.groups.find((g: { id: string }) => g.id === 'texas');
    expect(texas).toBeDefined();
    expect(texas.destinations.map((d: { code: string }) => d.code)).toEqual(['IAH', 'HOU', 'DFW']);
    expect(texas.destinations.every((d: { currentPriceMinor: number | null }) => d.currentPriceMinor === null)).toBe(true);
  });

  it('resolves cityName from the airports table and trackedRouteSlug from an active FLEXIBLE definition', () => {
    const board = homeBoardRead.getHomeBoard(NOW);
    const bayArea = board.groups.find((g: { id: string }) => g.id === 'bay-area');
    const oak = bayArea.destinations.find((d: { code: string }) => d.code === 'OAK');

    expect(oak.cityName).toBe('Oakland');
    expect(oak.trackedRouteSlug).toBe('sea-oak-flex-v1');
    expect(oak.currentPriceMinor).toBe(20000); // most recent of the 3 seeded rows
    expect(oak.observationCount).toBe(3);

    const sjc = bayArea.destinations.find((d: { code: string }) => d.code === 'SJC');
    expect(sjc.trackedRouteSlug).toBeNull(); // no search_definitions row for SEA-SJC in this test DB
  });

  it('extras lists destinations outside every group, cheapest-first, with a resolvable and an unresolvable cityName', () => {
    const board = homeBoardRead.getHomeBoard(NOW);
    expect(board.extras.map((d: { code: string }) => d.code)).toEqual(['MEX', 'DEN']); // 9500 < 15000

    const mex = board.extras.find((d: { code: string }) => d.code === 'MEX');
    expect(mex.cityName).toBe('Mexico City');

    const den = board.extras.find((d: { code: string }) => d.code === 'DEN');
    expect(den.cityName).toBeNull(); // no airports row seeded for DEN
  });

  it('extras caps at 12, dropping the most expensive entries', () => {
    // 13 more unlisted destinations, priced 1000..13000 -- combined with
    // the existing MEX(9500)/DEN(15000) that's 15 extras total; only the
    // cheapest 12 should come back.
    const extraRows = Array.from({ length: 13 }, (_, i) => ({
      origin: 'SEA',
      destination: `Z${i.toString().padStart(2, '0')}`,
      priceMinor: (i + 1) * 1000,
      observedAt: NOW,
      foundAt: null,
    }));
    dbMod.db.insert(schema.cityDirectionHistory).values(extraRows).run();

    const board = homeBoardRead.getHomeBoard(NOW);
    expect(board.extras).toHaveLength(12);
    // Strictly non-decreasing price order.
    for (let i = 1; i < board.extras.length; i++) {
      expect(board.extras[i].currentPriceMinor).toBeGreaterThanOrEqual(board.extras[i - 1].currentPriceMinor);
    }
    // The most expensive extras (15000 = DEN, 13000 = Z12) should have been dropped.
    expect(board.extras.some((d: { code: string }) => d.code === 'DEN')).toBe(false);
  });

  it('updatedAt is the newest observed_at across all history for the origin', () => {
    const board = homeBoardRead.getHomeBoard(NOW);
    const maxObservedAt = dbMod.db
      .select()
      .from(schema.cityDirectionHistory)
      .where(drizzleOrm.eq(schema.cityDirectionHistory.origin, 'SEA'))
      .all()
      .reduce((max: number, r: { observedAt: number }) => Math.max(max, r.observedAt), 0);
    expect(board.updatedAt).toBe(maxObservedAt);
  });
});

// ---------------------------------------------------------------------------
// scripts/bootstrap-real.ts: roster deactivation against the REAL roster
// ---------------------------------------------------------------------------

describe('scripts/bootstrap-real.ts (roster deactivation)', () => {
  it('deactivates a pre-existing definition not in REAL_MARKETS, while the real personal + benchmark roster stays active', () => {
    // A decoy definition from some prior/old roster, referencing its own
    // scopes so it satisfies the FK constraints.
    const [zzz1] = dbMod.db
      .insert(schema.marketScopes)
      .values({ scopeType: 'AIRPORT', code: 'ZZ1', displayName: 'Decoy 1', airportIds: [] })
      .returning({ id: schema.marketScopes.id })
      .all();
    const [zzz2] = dbMod.db
      .insert(schema.marketScopes)
      .values({ scopeType: 'AIRPORT', code: 'ZZ2', displayName: 'Decoy 2', airportIds: [] })
      .returning({ id: schema.marketScopes.id })
      .all();
    dbMod.db
      .insert(schema.searchDefinitions)
      .values({
        slug: 'zzz-legacy-flex-v1',
        originScopeId: zzz1.id,
        destinationScopeId: zzz2.id,
        mode: 'FLEXIBLE',
        tripType: 'ROUND_TRIP',
        cabin: 'ECONOMY',
        adults: 1,
        maxStops: 1,
        currency: 'USD',
        benchmarkMethodologyVersion: 'benchmark-v1',
        createdAt: NOW,
        active: true,
      })
      .run();

    // runBootstrap closes its `sqlite` argument when done -- pass a no-op
    // stand-in so this test's live connection survives for later
    // assertions/tests, per this file's afterAll teardown.
    bootstrapReal.runBootstrap(dbMod.db, () => dbPath, { close: () => {} });

    const decoy = dbMod.db
      .select()
      .from(schema.searchDefinitions)
      .where(drizzleOrm.eq(schema.searchDefinitions.slug, 'zzz-legacy-flex-v1'))
      .get();
    expect(decoy.active).toBe(false); // deactivated -- not in REAL_MARKETS

    // A personal route and a benchmark route from the real WP-P1 roster
    // should be present and active.
    const personal = dbMod.db
      .select()
      .from(schema.searchDefinitions)
      .where(drizzleOrm.eq(schema.searchDefinitions.slug, 'sea-hnl-flex-v1'))
      .get();
    expect(personal).toBeDefined();
    expect(personal.active).toBe(true);

    const benchmark = dbMod.db
      .select()
      .from(schema.searchDefinitions)
      .where(drizzleOrm.eq(schema.searchDefinitions.slug, 'jfk-lhr-flex-v1'))
      .get();
    expect(benchmark).toBeDefined();
    expect(benchmark.active).toBe(true);

    // A route dropped by the WP-P1 refocus (was in the old 26-route
    // roster, is not in the new one) should not exist as active either --
    // it was inserted earlier in this same suite's beforeAll runs only if
    // referenced; here we just confirm the roster-size invariant: exactly
    // the PERSONAL (11, incl. sea-iah added 2026-08-13) + BENCHMARK (8)
    // routes are active.
    const activeDefs = dbMod.db
      .select()
      .from(schema.searchDefinitions)
      .where(drizzleOrm.eq(schema.searchDefinitions.active, true))
      .all();
    expect(activeDefs).toHaveLength(19);

    const iah = dbMod.db
      .select()
      .from(schema.searchDefinitions)
      .where(drizzleOrm.eq(schema.searchDefinitions.slug, 'sea-iah-flex-v1'))
      .get();
    expect(iah).toBeDefined();
    expect(iah.active).toBe(true);

    // Airports/scopes for a homeBoard-only code (e.g. TUS, referenced by
    // no active route but needed for the home board + future P3
    // definitions) should exist too.
    const tusAirport = dbMod.db.select().from(schema.airports).where(drizzleOrm.eq(schema.airports.iataCode, 'TUS')).get();
    expect(tusAirport).toBeDefined();
  });

  it('never deactivates a config.serpapi.routes definition, even though it is absent from REAL_MARKETS', async () => {
    const { config } = await import('@/domain/config');

    // sea-cdg is in config.serpapi.routes (P3's SerpApi-only roster) but
    // deliberately NOT in REAL_MARKETS (travelpayouts has ~0 coverage for
    // it) -- exactly the shape of route this test guards. By this point in
    // the suite, an earlier runBootstrap call has already populated
    // market_scopes for every ALL_AIRPORTS entry (including CDG, which is
    // in the demo AIRPORTS list) and SEA -- select rather than insert.
    expect(config.serpapi.routes).toContain('sea-cdg');

    function getScope(code: string) {
      const scope = dbMod.db.select().from(schema.marketScopes).where(drizzleOrm.eq(schema.marketScopes.code, code)).get();
      if (!scope) throw new Error(`test setup: expected a market_scopes row for ${code} to already exist`);
      return scope;
    }
    const seaScope = getScope('SEA');
    const cdgScope = getScope('CDG');

    // bootstrap-serpapi.ts (P3, not this file) is what would normally
    // create this row in production; simulate its effect directly since
    // this test only needs to prove bootstrap-real.ts leaves it alone.
    const existing = dbMod.db
      .select()
      .from(schema.searchDefinitions)
      .where(drizzleOrm.eq(schema.searchDefinitions.slug, 'sea-cdg-flex-v1'))
      .get();
    if (!existing) {
      dbMod.db
        .insert(schema.searchDefinitions)
        .values({
          slug: 'sea-cdg-flex-v1',
          originScopeId: seaScope.id,
          destinationScopeId: cdgScope.id,
          mode: 'FLEXIBLE',
          tripType: 'ROUND_TRIP',
          cabin: 'ECONOMY',
          adults: 1,
          maxStops: 1,
          currency: 'USD',
          benchmarkMethodologyVersion: 'benchmark-v1',
          createdAt: NOW,
          active: true,
        })
        .run();
    } else if (!existing.active) {
      dbMod.db.update(schema.searchDefinitions).set({ active: true }).where(drizzleOrm.eq(schema.searchDefinitions.id, existing.id)).run();
    }

    bootstrapReal.runBootstrap(dbMod.db, () => dbPath, { close: () => {} });

    const seaCdg = dbMod.db
      .select()
      .from(schema.searchDefinitions)
      .where(drizzleOrm.eq(schema.searchDefinitions.slug, 'sea-cdg-flex-v1'))
      .get();
    expect(seaCdg).toBeDefined();
    expect(seaCdg.active).toBe(true); // NOT deactivated, despite being absent from REAL_MARKETS
  });
});
