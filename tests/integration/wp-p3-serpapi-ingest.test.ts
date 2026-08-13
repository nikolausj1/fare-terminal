// Integration coverage for WP-P3's per-definition provider routing in
// jobs/ingest.ts: a real (temp file) SQLite DB, migrated with the actual
// Drizzle migrations — same pattern as tests/integration/pipeline.test.ts
// and wp-f1/wp-f2. Deliberately never lets a real serpapi search actually
// fire (no fetch is ever injected for the serpapi singleton provider — see
// lib/providers/serpapi/index.ts's `serpapiProvider` module-level
// singleton, which always uses the real global fetch) — every scenario here
// is constructed so the ingest-level skip gate (missing key, or the
// daily/monthly budget) rejects the definition BEFORE jobs/ingest.ts would
// ever call serpapiProvider.search(). That is itself the thing under test:
// that the gate is wired correctly end to end (DB counts -> pure budget
// function -> skip), not that a live search succeeds (unit-tested instead,
// with an injected fetchImpl, in tests/unit/serpapi.test.ts).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const NOW = Date.parse('2026-08-15T12:00:00.000Z');

let dbPath: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let dbMod: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let schema: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let drizzleOrm: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ingestMod: any;

let serpapiDefId: number;
let otherDefId: number;

function countSearchRuns(searchDefinitionId: number, providerId?: string): number {
  const rows = dbMod.db.select().from(schema.searchRuns).where(drizzleOrm.eq(schema.searchRuns.searchDefinitionId, searchDefinitionId)).all();
  return providerId ? rows.filter((r: { providerId: string }) => r.providerId === providerId).length : rows.length;
}

beforeAll(async () => {
  dbPath = path.join(os.tmpdir(), `fare-terminal-wp-p3-${process.pid}-${Date.now()}.db`);
  process.env.DATABASE_PATH = dbPath;
  process.env.DEMO_NOW = new Date(NOW).toISOString();
  delete process.env.VERCEL;
  delete process.env.DB_READONLY;
  delete process.env.DATA_PROVIDER;
  delete process.env.SERPAPI_KEY;

  drizzleOrm = await import('drizzle-orm');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  dbMod = await import('@/db');
  migrate(dbMod.db, { migrationsFolder: './db/migrations' });

  schema = await import('@/db/schema');
  ingestMod = await import('@/jobs/ingest');

  // Minimal scopes — search_definitions only FKs to market_scopes, not
  // airports, so no airports rows are needed for this test (same shorthand
  // tests/integration/wp-f2.test.ts uses).
  const [seaScope] = dbMod.db
    .insert(schema.marketScopes)
    .values({ scopeType: 'AIRPORT', code: 'SEA', displayName: 'Seattle (SEA)', airportIds: [] })
    .returning({ id: schema.marketScopes.id })
    .all();
  const [fcoScope] = dbMod.db
    .insert(schema.marketScopes)
    .values({ scopeType: 'AIRPORT', code: 'FCO', displayName: 'Rome (FCO)', airportIds: [] })
    .returning({ id: schema.marketScopes.id })
    .all();
  const [jfkScope] = dbMod.db
    .insert(schema.marketScopes)
    .values({ scopeType: 'AIRPORT', code: 'JFK', displayName: 'New York (JFK)', airportIds: [] })
    .returning({ id: schema.marketScopes.id })
    .all();
  const [lhrScope] = dbMod.db
    .insert(schema.marketScopes)
    .values({ scopeType: 'AIRPORT', code: 'LHR', displayName: 'London (LHR)', airportIds: [] })
    .returning({ id: schema.marketScopes.id })
    .all();

  const baseDef = {
    mode: 'FLEXIBLE' as const,
    tripType: 'ROUND_TRIP' as const,
    stayMinNights: 5,
    stayMaxNights: 9,
    cabin: 'ECONOMY',
    adults: 1,
    maxStops: 1,
    currency: 'USD',
    benchmarkMethodologyVersion: 'benchmark-v1',
    createdAt: NOW,
    active: true,
  };

  const [serpapiDef] = dbMod.db
    .insert(schema.searchDefinitions)
    .values({ ...baseDef, slug: 'sea-fco-flex-v1', originScopeId: seaScope.id, destinationScopeId: fcoScope.id })
    .returning({ id: schema.searchDefinitions.id })
    .all();
  serpapiDefId = serpapiDef.id;

  const [otherDef] = dbMod.db
    .insert(schema.searchDefinitions)
    .values({ ...baseDef, slug: 'jfk-lhr-flex-v1', originScopeId: jfkScope.id, destinationScopeId: lhrScope.id })
    .returning({ id: schema.searchDefinitions.id })
    .all();
  otherDefId = otherDef.id;
}, 60_000);

afterAll(() => {
  dbMod.sqlite.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
  delete process.env.DEMO_NOW;
  delete process.env.SERPAPI_KEY;
});

afterEach(() => {
  delete process.env.SERPAPI_KEY;
});

describe('jobs/ingest.ts — per-definition serpapi routing', () => {
  it('skips the serpapi-routed definition (logged, no error) when SERPAPI_KEY is unset, leaving the other definition untouched', async () => {
    delete process.env.SERPAPI_KEY;

    const summary = await ingestMod.runIngestion([serpapiDefId, otherDefId]);

    expect(summary.serpapiSkippedNoKey).toBe(1);
    expect(summary.serpapiSkippedBudget).toEqual([]);
    expect(summary.errors).toEqual([]);
    // Only the non-serpapi definition was actually processed.
    expect(summary.definitionsProcessed).toBe(1);
    expect(summary.searchRunsCreated).toBe(1);

    // The demo provider (getActiveProvider() default, DATA_PROVIDER unset)
    // handled the untouched definition — existing travelpayouts/demo
    // selection behavior is provably unaffected by the serpapi routing.
    expect(countSearchRuns(otherDefId, 'demo')).toBe(1);
    // No search_runs row at all for the skipped serpapi definition — it was
    // never searched, successfully or otherwise.
    expect(countSearchRuns(serpapiDefId)).toBe(0);
  });

  it('skips a key-present serpapi definition via the daily budget gate, without ever attempting a search', async () => {
    // Simulate "already swept today (UTC)": one prior serpapi search_runs
    // row for this definition, started earlier the same DEMO_NOW day.
    dbMod.db
      .insert(schema.searchRuns)
      .values({
        searchDefinitionId: serpapiDefId,
        providerId: 'serpapi',
        startedAt: NOW - 3_600_000,
        completedAt: NOW - 3_600_000 + 500,
        status: 'SUCCESS',
        offerCountRaw: 3,
        offerCountNormalized: 3,
      })
      .run();
    expect(countSearchRuns(serpapiDefId, 'serpapi')).toBe(1);

    // A key IS present now — proves the daily gate (not the missing-key
    // check) is what's blocking this. The key is intentionally not a real
    // one: if the gate failed to block and jobs/ingest.ts fell through to
    // an actual serpapiProvider.search() call, this test would attempt a
    // real network request and either hang or fail loudly rather than
    // silently pass — there is no injected fetchImpl for the module-level
    // serpapiProvider singleton.
    process.env.SERPAPI_KEY = 'fake-test-key-not-a-real-key';

    const summary = await ingestMod.runIngestion([serpapiDefId]);

    expect(summary.serpapiSkippedNoKey).toBe(0);
    expect(summary.serpapiSkippedBudget).toHaveLength(1);
    expect(summary.serpapiSkippedBudget[0]).toMatchObject({ searchDefinitionId: serpapiDefId });
    expect(summary.serpapiSkippedBudget[0].reason).toContain('already swept');
    expect(summary.definitionsProcessed).toBe(0);
    expect(summary.searchRunsCreated).toBe(0);
    expect(summary.errors).toEqual([]);

    // Still exactly the one pre-seeded row — nothing new was written.
    expect(countSearchRuns(serpapiDefId, 'serpapi')).toBe(1);
  });
});
