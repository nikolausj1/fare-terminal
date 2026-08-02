// Integration coverage for WP-F3's two new read-layer files
// (lib/markets/movers.ts, lib/markets/sparklines.ts): a real (temp file)
// SQLite DB migrated with the actual Drizzle migrations, hand-crafted
// market_scopes/search_definitions/market_snapshots fixtures for precise
// control over 24h deltas and reliability, one anchor-pinning
// offer_observations row (getDatasetAnchor() reads max(observed_at)).
// Same pattern as tests/integration/wp-f1.test.ts / wp-f2.test.ts.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DAY_MS = 86_400_000;
const ANCHOR = Date.parse('2026-08-02T12:00:00.000Z');

let dbPath: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let dbMod: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let schema: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let moversMod: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sparklinesMod: any;

let scopeId = 1;
let defId = 1;
let runId = 1;

function insertScope(code: string) {
  const id = scopeId++;
  dbMod.db
    .insert(schema.marketScopes)
    .values({ id, scopeType: 'AIRPORT', code, displayName: code, airportIds: [] })
    .run();
  return id;
}

function insertDefinition(slug: string, originScopeId: number, destinationScopeId: number) {
  const id = defId++;
  dbMod.db
    .insert(schema.searchDefinitions)
    .values({
      id,
      slug,
      originScopeId,
      destinationScopeId,
      mode: 'FLEXIBLE',
      tripType: 'ROUND_TRIP',
      stayMinNights: 5,
      stayMaxNights: 9,
      cabin: 'ECONOMY',
      adults: 1,
      maxStops: 1,
      currency: 'USD',
      benchmarkMethodologyVersion: 'benchmark-v1',
      createdAt: ANCHOR,
      active: true,
    })
    .run();
  return id;
}

function insertSnapshot(searchDefinitionId: number, snapshotAt: number, benchmarkPriceMinor: number, dataQualityScore = 1) {
  dbMod.db
    .insert(schema.marketSnapshots)
    .values({
      searchDefinitionId,
      snapshotAt,
      benchmarkPriceMinor,
      fromPriceMinor: benchmarkPriceMinor,
      medianPriceMinor: benchmarkPriceMinor,
      p25PriceMinor: benchmarkPriceMinor,
      validOfferCount: 10,
      uniqueItineraryCount: 8,
      carrierCount: 3,
      nonstopOfferCount: 4,
      oneStopOfferCount: 6,
      freshnessSeconds: 0,
      dataQualityScore,
      methodologyVersion: 'benchmark-v1',
      sourceSearchRunIds: [],
    })
    .run();
}

/** Pins getDatasetAnchor() (max(offer_observations.observed_at)) to ANCHOR,
 * independent of the hand-crafted market_snapshots rows above. */
function insertAnchorObservation(searchDefinitionId: number) {
  const id = runId++;
  dbMod.db
    .insert(schema.searchRuns)
    .values({
      id,
      searchDefinitionId,
      providerId: 'demo',
      startedAt: ANCHOR,
      completedAt: ANCHOR,
      status: 'SUCCESS',
      offerCountRaw: 1,
      offerCountNormalized: 1,
    })
    .run();
  dbMod.db
    .insert(schema.offerObservations)
    .values({
      searchRunId: id,
      searchDefinitionId,
      providerId: 'demo',
      providerOfferId: `anchor-${id}`,
      itineraryFingerprint: `anchor-${id}`,
      observedAt: ANCHOR,
      currency: 'USD',
      totalPriceMinor: 10000,
      optionalFeesKnown: true,
      validatingCarrier: 'AA',
      marketingCarriers: ['AA'],
      operatingCarriers: ['AA'],
      segmentsJson: [],
      durationMinutes: 500,
      stopCount: 0,
      cabin: 'ECONOMY',
      qualityFlags: [],
    })
    .run();
}

beforeAll(async () => {
  dbPath = path.join(os.tmpdir(), `fare-terminal-wp-f3-${process.pid}-${Date.now()}.db`);
  process.env.DATABASE_PATH = dbPath;
  delete process.env.VERCEL;
  delete process.env.DB_READONLY;

  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  dbMod = await import('@/db');
  migrate(dbMod.db, { migrationsFolder: './db/migrations' });

  schema = await import('@/db/schema');
  moversMod = await import('@/lib/markets/movers');
  sparklinesMod = await import('@/lib/markets/sparklines');

  // --- Fixture roster -----------------------------------------------------
  const jfk = insertScope('JFK');
  const lhr = insertScope('LHR');
  const cdg = insertScope('CDG');
  const bcn = insertScope('BCN');
  const nrt = insertScope('NRT');
  const mad = insertScope('MAD');

  // big-drop: -20% in 24h -> clears the qualifying-drop gate (>=5%).
  const bigDrop = insertDefinition('jfk-lhr-flex-v1', jfk, lhr);
  insertSnapshot(bigDrop, ANCHOR - DAY_MS, 10000);
  insertSnapshot(bigDrop, ANCHOR, 8000);
  insertAnchorObservation(bigDrop);

  // small-move: +2% in 24h -> fresh/reliable, but the smallest |pct24h|.
  const smallMove = insertDefinition('jfk-cdg-flex-v1', jfk, cdg);
  insertSnapshot(smallMove, ANCHOR - DAY_MS, 10000);
  insertSnapshot(smallMove, ANCHOR, 10200);

  // medium-rise: +8% in 24h -> a rise, not a drop, so NOT qualifiesAsDrop
  // despite clearing the 5% move-size bar (only *decreases* qualify).
  const mediumRise = insertDefinition('jfk-bcn-flex-v1', jfk, bcn);
  insertSnapshot(mediumRise, ANCHOR - DAY_MS, 10000);
  insertSnapshot(mediumRise, ANCHOR, 10800);

  // stale-route: last snapshot far older than config.freshness.staleAfterMinutes
  // (360min/6h) before the anchor -> excluded from the candidate pool
  // entirely, never appears in getTopMovers no matter the limit.
  const staleRoute = insertDefinition('jfk-nrt-flex-v1', jfk, nrt);
  insertSnapshot(staleRoute, ANCHOR - 10 * DAY_MS - DAY_MS, 9000);
  insertSnapshot(staleRoute, ANCHOR - 10 * DAY_MS, 9000);

  // unreliable-route: latest snapshot has benchmarkPriceMinor 0 (the
  // zero-valid-offers case — WP-F1 fix 1) -> excluded via isPriceReliable,
  // even though it's otherwise fresh.
  const unreliableRoute = insertDefinition('jfk-mad-flex-v1', jfk, mad);
  insertSnapshot(unreliableRoute, ANCHOR - DAY_MS, 9500);
  insertSnapshot(unreliableRoute, ANCHOR, 0, 0);
}, 60_000);

afterAll(() => {
  dbMod.sqlite.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
});

describe('lib/markets/movers.ts', () => {
  it('rankMoversByAbsChange sorts by |changePct| desc, treats null as lowest, and flags qualifiesAsDrop', () => {
    const ranked = moversMod.rankMoversByAbsChange(
      [
        { slug: 'flat', changePct: 0 },
        { slug: 'big-rise', changePct: 12 },
        { slug: 'unknown', changePct: null },
        { slug: 'big-drop', changePct: -20 },
        { slug: 'small-drop', changePct: -2 },
      ],
      10
    );
    expect(ranked.map((c: { slug: string }) => c.slug)).toEqual(['big-drop', 'big-rise', 'small-drop', 'flat', 'unknown']);

    const bigDrop = ranked.find((c: { slug: string }) => c.slug === 'big-drop');
    expect(bigDrop.qualifiesAsDrop).toBe(true); // -20% <= -5% gate

    const bigRise = ranked.find((c: { slug: string }) => c.slug === 'big-rise');
    expect(bigRise.qualifiesAsDrop).toBe(false); // a rise never qualifies as a drop, even a large one

    const smallDrop = ranked.find((c: { slug: string }) => c.slug === 'small-drop');
    expect(smallDrop.qualifiesAsDrop).toBe(false); // -2% doesn't clear the 5% gate
  });

  it('rankMoversByAbsChange caps at `limit`, keeping only the largest-|change| entries', () => {
    const ranked = moversMod.rankMoversByAbsChange(
      [
        { slug: 'a', changePct: -1 },
        { slug: 'b', changePct: 9 },
        { slug: 'c', changePct: -5 },
      ],
      2
    );
    expect(ranked.map((c: { slug: string }) => c.slug)).toEqual(['b', 'c']);
  });

  it('getTopMovers excludes stale and unreliable routes, ranks the rest by |pct24h|, and flags qualifiesAsDrop', () => {
    const movers = moversMod.getTopMovers(6);
    const slugs = movers.map((m: { slug: string }) => m.slug);

    expect(slugs).not.toContain('jfk-nrt-flex-v1'); // stale -> excluded
    expect(slugs).not.toContain('jfk-mad-flex-v1'); // unreliable (price 0) -> excluded

    // Ranked strictly by |pct24h| descending: -20% > +8% > +2%.
    expect(slugs).toEqual(['jfk-lhr-flex-v1', 'jfk-bcn-flex-v1', 'jfk-cdg-flex-v1']);

    const bigDropCard = movers.find((m: { slug: string }) => m.slug === 'jfk-lhr-flex-v1');
    expect(bigDropCard.changePct).toBeCloseTo(-20, 5);
    expect(bigDropCard.qualifiesAsDrop).toBe(true);
    expect(bigDropCard.benchmarkPriceMinor).toBe(8000);

    const riseCard = movers.find((m: { slug: string }) => m.slug === 'jfk-bcn-flex-v1');
    expect(riseCard.changePct).toBeCloseTo(8, 5);
    expect(riseCard.qualifiesAsDrop).toBe(false);
  });

  it('getTopMovers respects `limit`', () => {
    const movers = moversMod.getTopMovers(1);
    expect(movers).toHaveLength(1);
    expect(movers[0].slug).toBe('jfk-lhr-flex-v1'); // the largest |pct24h|
  });
});

describe('lib/markets/sparklines.ts', () => {
  it('downsampleSeries is a no-op under the cap, and keeps the first/last point when downsampling', () => {
    expect(sparklinesMod.downsampleSeries([1, 2, 3], 20)).toEqual([1, 2, 3]);

    const points = Array.from({ length: 25 }, (_, i) => i);
    const sampled = sparklinesMod.downsampleSeries(points, 5);
    expect(sampled).toHaveLength(5);
    expect(sampled[0]).toBe(0);
    expect(sampled[sampled.length - 1]).toBe(24);
  });

  it('downsampleSeries handles max <= 1 without throwing', () => {
    expect(sparklinesMod.downsampleSeries([1, 2, 3], 0)).toEqual([]);
    expect(sparklinesMod.downsampleSeries([1, 2, 3], 1)).toEqual([3]);
  });

  it('getSparklines batches every requested slug in one pass, excludes unreliable points, and downsamples long series', () => {
    // A route with a long, mostly-reliable history plus one unreliable point
    // that must be excluded rather than distorting the trend.
    const longHistory = insertDefinition('jfk-fra-flex-v1', 1, 2);
    for (let i = 0; i < 25; i++) {
      insertSnapshot(longHistory, ANCHOR - (25 - i) * DAY_MS, 10000 + i * 10);
    }
    insertSnapshot(longHistory, ANCHOR - DAY_MS / 2, 0, 0); // unreliable — must be excluded

    const result = sparklinesMod.getSparklines(['jfk-lhr-flex-v1', 'jfk-fra-flex-v1', 'no-such-slug'], 30);

    // Only 2 reliable points -> present but short.
    expect(result.get('jfk-lhr-flex-v1')).toEqual([10000, 8000]);

    // Long history downsampled to <= 20 points, unreliable point excluded
    // (no 0 in the series), first/last preserved.
    const fraSeries = result.get('jfk-fra-flex-v1');
    expect(fraSeries.length).toBeLessThanOrEqual(20);
    expect(fraSeries).not.toContain(0);
    expect(fraSeries[0]).toBe(10000);
    expect(fraSeries[fraSeries.length - 1]).toBe(10240);

    // A slug with no matching search_definitions row is just absent.
    expect(result.has('no-such-slug')).toBe(false);
  });

  it('getSparklines returns an empty Map for an empty slug list without querying', () => {
    expect(sparklinesMod.getSparklines([], 30)).toEqual(new Map());
  });
});
