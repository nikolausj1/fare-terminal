// WP-F1 coverage: price-reliability gating (fix 1) and mode-fallback
// resolution (fix 2). Same "real (temp file) SQLite DB, dynamic imports
// after DATABASE_PATH is set" pattern as tests/integration/pipeline.test.ts
// — see that file's header comment for why the imports must be dynamic.
//
// Fix 3 (listTrackedMarkets) and fix 4 (formatRelativeTime) are covered
// elsewhere: listTrackedMarkets is exercised via the same DB fixtures below
// (read layer, no DB required for format.ts) and formatRelativeTime's
// boundary cases live in tests/unit/format.test.ts (pure function, no DB).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const NOW = Date.parse('2026-07-17T12:00:00.000Z');
const MARKET_IDS = ['jfk-lhr', 'lax-hnd'];

let dbPath: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let dbMod: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let schema: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let queriesMod: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let configMod: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let drizzleOrm: any;

function findDefBySlug(slug: string) {
  const row = dbMod.db
    .select()
    .from(schema.searchDefinitions)
    .where(drizzleOrm.eq(schema.searchDefinitions.slug, slug))
    .get();
  if (!row) throw new Error(`fixture setup error: no search_definitions row for slug ${slug}`);
  return row;
}

beforeAll(async () => {
  dbPath = path.join(os.tmpdir(), `fare-terminal-wp-f1-${process.pid}-${Date.now()}.db`);
  process.env.DATABASE_PATH = dbPath;
  process.env.DEMO_NOW = new Date(NOW).toISOString();
  delete process.env.VERCEL;
  delete process.env.DB_READONLY;

  drizzleOrm = await import('drizzle-orm');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  dbMod = await import('@/db');
  migrate(dbMod.db, { migrationsFolder: './db/migrations' });

  schema = await import('@/db/schema');
  configMod = await import('@/domain/config');
  const seedMod = await import('@/db/seed');
  seedMod.seedMarkets(MARKET_IDS, NOW);

  const backfillMod = await import('@/jobs/backfill');
  backfillMod.runBackfill();

  queriesMod = await import('@/lib/markets/queries');
}, 60_000);

afterAll(() => {
  dbMod.sqlite.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
});

describe('WP-F1 fix 1: price-reliability gating', () => {
  it('a normal, well-populated snapshot is priceReliable: true', () => {
    const summary = queriesMod.getMarketSummary('JFK', 'LHR');
    expect(summary).not.toBeNull();
    expect(summary.priceReliable).toBe(true);
    expect(summary.snapshot.benchmarkPriceMinor).toBeGreaterThan(0);
  });

  it('a snapshot derived from zero valid offers (benchmarkPriceMinor 0, dataQualityScore 0) is flagged priceReliable: false, and change/percentile/fairValue are suppressed', () => {
    const def = findDefBySlug('jfk-lhr-flex-v1');
    const priorSnapshot = dbMod.db
      .select()
      .from(schema.marketSnapshots)
      .where(drizzleOrm.eq(schema.marketSnapshots.searchDefinitionId, def.id))
      .orderBy(drizzleOrm.desc(schema.marketSnapshots.snapshotAt))
      .limit(1)
      .get();
    expect(priorSnapshot).toBeDefined();

    // Mirrors exactly what domain/snapshots/computeSnapshotMetrics.ts
    // returns for a search_run with zero valid offers (e.g. the provider
    // returned nothing that run) — see that module's "if (validOffers.length
    // === 0)" branch. This is the real shape observed in production
    // (data/real.db search_definition 10, snapshots from run 170 onward).
    dbMod.db
      .insert(schema.marketSnapshots)
      .values({
        searchDefinitionId: def.id,
        snapshotAt: priorSnapshot.snapshotAt + 60_000,
        benchmarkPriceMinor: 0,
        fromPriceMinor: 0,
        medianPriceMinor: 0,
        p25PriceMinor: 0,
        validOfferCount: 0,
        uniqueItineraryCount: 0,
        carrierCount: 0,
        nonstopOfferCount: 0,
        oneStopOfferCount: 0,
        freshnessSeconds: 0,
        dataQualityScore: 0,
        methodologyVersion: configMod.config.benchmark.methodologyVersion,
        sourceSearchRunIds: [],
      })
      .run();

    const summary = queriesMod.getMarketSummary('JFK', 'LHR');
    expect(summary).not.toBeNull();
    expect(summary.snapshot.benchmarkPriceMinor).toBe(0);
    expect(summary.priceReliable).toBe(false);
    // The whole point of the fix: no misleading "-100%, great deal" delta,
    // no percentile claim built off a $0 "current" price.
    expect(summary.change).toBeNull();
    expect(summary.percentile).toBeNull();
  });

  it('getMarketHistory excludes the unreliable point entirely rather than rendering a literal $0', () => {
    const points = queriesMod.getMarketHistory('jfk-lhr-flex-v1', 'all');
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      expect(p.benchmarkPriceMinor).toBeGreaterThan(0);
    }
  });

  it('getMarketPulse never surfaces the unreliable snapshot as a market card', () => {
    const pulse = queriesMod.getMarketPulse();
    const allCards = [...pulse.biggestDrops, ...pulse.newlyFavorable];
    for (const card of allCards) {
      expect(card.benchmarkPriceMinor).toBeGreaterThan(0);
    }
  });
});

describe('WP-F1 fix 2: mode-fallback resolution', () => {
  it('resolveDefinitionDetailed reports the fallback when EXACT is requested but no EXACT definition exists', () => {
    const { definition, modeFallback } = queriesMod.resolveDefinitionDetailed('JFK', 'LHR', {
      mode: 'EXACT',
      depart: '2026-09-15',
    });
    expect(definition).not.toBeNull();
    expect(definition.mode).toBe('FLEXIBLE');
    expect(modeFallback).toEqual({ requested: 'EXACT', served: 'FLEXIBLE' });
  });

  it('resolveDefinitionDetailed reports no fallback for a plain FLEXIBLE lookup', () => {
    const { definition, modeFallback } = queriesMod.resolveDefinitionDetailed('JFK', 'LHR');
    expect(definition).not.toBeNull();
    expect(modeFallback).toBeNull();
  });

  it('getMarketSummary surfaces modeFallback on the VM, with the definition still describing the served (FLEXIBLE) window', () => {
    const summary = queriesMod.getMarketSummary('JFK', 'LHR', { mode: 'EXACT', depart: '2026-09-15' });
    expect(summary).not.toBeNull();
    expect(summary.modeFallback).toEqual({ requested: 'EXACT', served: 'FLEXIBLE' });
    expect(summary.definition.mode).toBe('FLEXIBLE');

    const noFallback = queriesMod.getMarketSummary('JFK', 'LHR');
    expect(noFallback.modeFallback).toBeNull();
  });

  it('resolveDefinition (definition-only wrapper) is unaffected — same definition either way', () => {
    const def = queriesMod.resolveDefinition('JFK', 'LHR', { mode: 'EXACT', depart: '2026-09-15' });
    expect(def).not.toBeNull();
    expect(def.mode).toBe('FLEXIBLE');
  });
});

describe('WP-F1 fix 3: listTrackedMarkets', () => {
  it('returns active FLEXIBLE markets sorted alphabetically by origin+destination, capped at the given limit', () => {
    const markets = queriesMod.listTrackedMarkets(1);
    expect(markets.length).toBe(1);
    expect(markets[0]).toHaveProperty('slug');
    expect(markets[0]).toHaveProperty('originCity');
    expect(markets[0]).toHaveProperty('destinationCity');

    const all = queriesMod.listTrackedMarkets(50);
    expect(all.length).toBeGreaterThanOrEqual(MARKET_IDS.length);
    const keys = all.map((m: { origin: string; destination: string }) => `${m.origin}${m.destination}`);
    const sorted = [...keys].sort((a, b) => a.localeCompare(b));
    expect(keys).toEqual(sorted);
    // Every entry must be a FLEXIBLE definition's route.
    for (const m of all) {
      expect(m.slug).toMatch(/-flex-/);
    }
  });
});
