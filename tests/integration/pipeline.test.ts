// Integration coverage for WP4 (PRD §34.2): seed -> ingest -> snapshots ->
// events -> recommendations -> analyst-notes -> read layer -> API routes,
// against a real (temp file) SQLite DB migrated with the actual Drizzle
// migrations.
//
// DATABASE_PATH must be set BEFORE db/index.ts is first imported anywhere
// in this file's module graph (it opens the DB connection at module load
// time), so every module that transitively touches the DB is imported
// dynamically inside beforeAll, after the env var is set — never via a
// static top-level `import`.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const NOW = Date.parse('2026-07-17T12:00:00.000Z');
// jfk-lhr: SHARP_DROP_SURGE, lax-hnd: CARRIER_MATCH, bos-dub: SHORT_HISTORY
// — the three scenarios PRD §34.2 calls out by name for the events/
// recommendations assertions below.
const MARKET_IDS = ['jfk-lhr', 'lax-hnd', 'bos-dub'];

let dbPath: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let dbMod: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let schema: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ingestMod: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let backfillMod: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let snapshotsMod: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let eventsMod: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let recsMod: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let notesMod: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let queriesMod: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let normalizationMod: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let drizzleOrm: any;

function findDefIdBySlug(slug: string): number {
  const row = dbMod.db
    .select()
    .from(schema.searchDefinitions)
    .where(drizzleOrm.eq(schema.searchDefinitions.slug, slug))
    .get();
  if (!row) throw new Error(`fixture setup error: no search_definitions row for slug ${slug}`);
  return row.id;
}

function countSearchRuns(searchDefinitionId: number): number {
  return dbMod.db
    .select()
    .from(schema.searchRuns)
    .where(drizzleOrm.eq(schema.searchRuns.searchDefinitionId, searchDefinitionId))
    .all().length;
}

beforeAll(async () => {
  dbPath = path.join(os.tmpdir(), `fare-terminal-wp4-${process.pid}-${Date.now()}.db`);
  process.env.DATABASE_PATH = dbPath;
  process.env.DEMO_NOW = new Date(NOW).toISOString();
  delete process.env.VERCEL;
  delete process.env.DB_READONLY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANALYST_LLM;

  drizzleOrm = await import('drizzle-orm');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  dbMod = await import('@/db');
  migrate(dbMod.db, { migrationsFolder: './db/migrations' });

  schema = await import('@/db/schema');
  const seedMod = await import('@/db/seed');
  seedMod.seedMarkets(MARKET_IDS, NOW);

  normalizationMod = await import('@/domain/normalization');
  ingestMod = await import('@/jobs/ingest');
  backfillMod = await import('@/jobs/backfill');
  snapshotsMod = await import('@/jobs/snapshots');
  eventsMod = await import('@/jobs/events');
  recsMod = await import('@/jobs/recommendations');
  notesMod = await import('@/jobs/analyst-notes');
  queriesMod = await import('@/lib/markets/queries');
}, 60_000);

afterAll(() => {
  dbMod.sqlite.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
});

describe('seed -> ingest', () => {
  it('creates a new search_run + offer_observations for the targeted definition', async () => {
    const defId = findDefIdBySlug('jfk-lhr-flex-v1');
    const before = countSearchRuns(defId);

    const summary = await ingestMod.runIngestion([defId]);

    expect(summary.definitionsProcessed).toBe(1);
    expect(summary.searchRunsCreated).toBe(1);
    expect(summary.offersInserted).toBeGreaterThan(0);
    expect(summary.errors).toEqual([]);
    expect(countSearchRuns(defId)).toBe(before + 1);
  });

  it('stores itinerary_fingerprint using ONLY the canonical domain function', () => {
    const defId = findDefIdBySlug('jfk-lhr-flex-v1');
    const latestRun = dbMod.db
      .select()
      .from(schema.searchRuns)
      .where(drizzleOrm.eq(schema.searchRuns.searchDefinitionId, defId))
      .orderBy(drizzleOrm.desc(schema.searchRuns.id))
      .limit(1)
      .get();

    const rows = dbMod.db
      .select()
      .from(schema.offerObservations)
      .where(drizzleOrm.eq(schema.offerObservations.searchRunId, latestRun.id))
      .all();

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const expected = normalizationMod.itineraryFingerprint(row.segmentsJson);
      expect(row.itineraryFingerprint).toBe(expected);
    }
  });
});

describe('backfill + snapshots', () => {
  it('derives one market_snapshots row per search_run and is idempotent', () => {
    const first = backfillMod.runBackfill();
    expect(first.snapshotsCreated).toBeGreaterThan(0);

    // Second call (jobs/pipeline.ts's explicit "snapshots" stage after
    // "backfill") should be a no-op except for the one extra run the
    // ingest test above added.
    const second = snapshotsMod.deriveSnapshots();
    expect(second.snapshotsCreated).toBeLessThanOrEqual(1);

    const third = snapshotsMod.deriveSnapshots();
    expect(third.snapshotsCreated).toBe(0);
  });

  it('derives the correct benchmark for a known fixture (median of the 5 cheapest valid offers)', () => {
    const defId = findDefIdBySlug('bos-dub-flex-v1');
    const oldestRun = dbMod.db
      .select()
      .from(schema.searchRuns)
      .where(drizzleOrm.eq(schema.searchRuns.searchDefinitionId, defId))
      .orderBy(drizzleOrm.asc(schema.searchRuns.completedAt))
      .limit(1)
      .get();

    const offerRows = dbMod.db
      .select()
      .from(schema.offerObservations)
      .where(drizzleOrm.eq(schema.offerObservations.searchRunId, oldestRun.id))
      .all();
    const prices = offerRows
      .filter((r: { qualityFlags: string[] }) => !r.qualityFlags.includes('SUSPECTED_ANOMALY'))
      .map((r: { totalPriceMinor: number }) => r.totalPriceMinor)
      .sort((a: number, b: number) => a - b);
    const lowSet = prices.slice(0, 5);
    const mid = Math.floor(lowSet.length / 2);
    const expectedBenchmark =
      lowSet.length % 2 === 0 ? Math.round((lowSet[mid - 1] + lowSet[mid]) / 2) : lowSet[mid];

    const snapshotRow = dbMod.db
      .select()
      .from(schema.marketSnapshots)
      .where(
        drizzleOrm.and(
          drizzleOrm.eq(schema.marketSnapshots.searchDefinitionId, defId),
          drizzleOrm.eq(schema.marketSnapshots.snapshotAt, oldestRun.completedAt)
        )
      )
      .get();

    expect(snapshotRow).toBeDefined();
    expect(snapshotRow.benchmarkPriceMinor).toBe(expectedBenchmark);
    expect(snapshotRow.validOfferCount).toBe(prices.length);
    expect(snapshotRow.methodologyVersion).toBe('benchmark-v1');
  });
});

describe('events', () => {
  it('produces the expected event types for jfk-lhr (SHARP_DROP_SURGE) and lax-hnd (CARRIER_MATCH)', () => {
    const summary = eventsMod.deriveEvents();
    expect(summary.eventsCreated).toBeGreaterThan(0);

    const jfkEvents = queriesMod.getMarketEvents('jfk-lhr-flex-v1');
    const jfkTypes = new Set(jfkEvents.map((e: { eventType: string }) => e.eventType));
    expect(
      jfkTypes.has('PRICE_DROP') || jfkTypes.has('OFFER_COUNT_SURGE') || jfkTypes.has('NEW_HISTORICAL_LOW')
    ).toBe(true);

    const laxEvents = queriesMod.getMarketEvents('lax-hnd-flex-v1');
    const carrierMatch = laxEvents.find((e: { eventType: string }) => e.eventType === 'POSSIBLE_CARRIER_MATCH');
    expect(carrierMatch).toBeDefined();
    expect(carrierMatch.inference?.text.toLowerCase()).toContain('consistent with');
  });
});

describe('recommendations', () => {
  it('produces a label + confidence for jfk-lhr and INSUFFICIENT_DATA for bos-dub (short history)', () => {
    const summary = recsMod.deriveRecommendations();
    expect(summary.recommendationsCreated).toBe(MARKET_IDS.length);

    const jfkSummary = queriesMod.getMarketSummary('JFK', 'LHR');
    expect(jfkSummary).not.toBeNull();
    expect(jfkSummary.recommendation).not.toBeNull();
    expect(jfkSummary.recommendation.label).not.toBe('INSUFFICIENT_DATA');
    expect(['LOW', 'MODERATE', 'HIGH']).toContain(jfkSummary.recommendation.confidence);

    const bosSummary = queriesMod.getMarketSummary('BOS', 'DUB');
    expect(bosSummary).not.toBeNull();
    expect(bosSummary.recommendation.label).toBe('INSUFFICIENT_DATA');
  });
});

describe('analyst notes', () => {
  it('falls back to a validating template note (no ANTHROPIC_API_KEY/ANALYST_LLM in test env)', async () => {
    const summary = await notesMod.deriveAnalystNotes();
    expect(summary.notesCreated).toBe(MARKET_IDS.length);
    expect(summary.llmUsed).toBe(0);
    expect(summary.templateUsed).toBe(MARKET_IDS.length);

    const defId = findDefIdBySlug('jfk-lhr-flex-v1');
    const noteRow = dbMod.db
      .select()
      .from(schema.analystNotes)
      .where(drizzleOrm.eq(schema.analystNotes.searchDefinitionId, defId))
      .get();
    expect(noteRow.generationMode).toBe('TEMPLATE');
    expect(noteRow.validationStatus).toBe('valid');

    const wordCount = noteRow.noteText.trim().split(/\s+/).length;
    expect(wordCount).toBeGreaterThanOrEqual(60);
    expect(wordCount).toBeLessThanOrEqual(140);
  });
});

describe('read layer', () => {
  it('getMarketHistory returns only compatible, chronologically sorted snapshots', () => {
    const points = queriesMod.getMarketHistory('jfk-lhr-flex-v1', 'all');
    expect(points.length).toBeGreaterThan(0);
    for (let i = 1; i < points.length; i++) {
      expect(points[i].snapshotAt).toBeGreaterThan(points[i - 1].snapshotAt);
    }
  });

  it('getMarketPulse returns a deterministic brief and demoMode: true', () => {
    const pulse = queriesMod.getMarketPulse();
    expect(pulse.demoMode).toBe(true);
    expect(pulse.brief.mode).toBe('TEMPLATE');
    expect(typeof pulse.brief.text).toBe('string');
    expect(pulse.brief.text.length).toBeGreaterThan(0);
  });

  it('searchLocations matches on IATA code, name, and city name', () => {
    const byCode = queriesMod.searchLocations('lhr');
    expect(byCode.some((r: { iataCode: string }) => r.iataCode === 'LHR')).toBe(true);

    const byCity = queriesMod.searchLocations('london');
    expect(byCity.some((r: { iataCode: string }) => r.iataCode === 'LHR')).toBe(true);
  });
});

describe('refresh API route', () => {
  it('rate-limits repeated refreshes within 60s', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const routeMod: any = await import('@/app/api/markets/[origin]/[destination]/refresh/route');
    const params = Promise.resolve({ origin: 'jfk', destination: 'lhr' });

    const res1 = await routeMod.POST(undefined, { params });
    const body1 = await res1.json();
    expect(res1.status).toBe(200);
    expect(body1.refreshed).toBe(true);
    expect(body1.summary).toBeDefined();

    const res2 = await routeMod.POST(undefined, { params });
    const body2 = await res2.json();
    expect(res2.status).toBe(200);
    expect(body2.refreshed).toBe(false);
    expect(body2.reason).toBe('rate-limited');
  });

  it('returns 404 for an untracked route', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const routeMod: any = await import('@/app/api/markets/[origin]/[destination]/refresh/route');
    const res = await routeMod.POST(undefined, { params: Promise.resolve({ origin: 'aaa', destination: 'bbb' }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
