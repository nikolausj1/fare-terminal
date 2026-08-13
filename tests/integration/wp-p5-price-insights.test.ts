// WP-P5 integration coverage for jobs/ingest.ts#persistPriceInsights: real
// (temp file) SQLite DB, migrated with the actual Drizzle migrations — same
// pattern as tests/integration/wp-p3-serpapi-ingest.test.ts. Exercises the
// two persistence semantics scripts/backfill-price-insights.ts and the
// serpapi ingest path both depend on:
//   - google_price_history: per-day UPSERT, "keep latest capture"
//     (UNIQUE(search_definition_id, price_date)).
//   - route_price_insights: append-only, one new row per call.
// Deliberately calls persistPriceInsights directly rather than going
// through runIngestion/a live serpapi search — that routing is already
// covered by wp-p3-serpapi-ingest.test.ts, and there's no way to inject a
// fake response into the module-level `serpapiProvider` singleton (see that
// file's module comment). This test isolates exactly the piece WP-P5 added.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { NormalizedPriceInsights } from '@/domain/types';

const NOW = Date.parse('2026-08-13T12:00:00.000Z');
const DAY_MS = 86_400_000;

let dbPath: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let dbMod: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let schema: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ingestMod: any;

let defId: number;

beforeAll(async () => {
  dbPath = path.join(os.tmpdir(), `fare-terminal-wp-p5-${process.pid}-${Date.now()}.db`);
  process.env.DATABASE_PATH = dbPath;
  delete process.env.VERCEL;
  delete process.env.DB_READONLY;

  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  dbMod = await import('@/db');
  migrate(dbMod.db, { migrationsFolder: './db/migrations' });

  schema = await import('@/db/schema');
  ingestMod = await import('@/jobs/ingest');

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

  const [def] = dbMod.db
    .insert(schema.searchDefinitions)
    .values({
      slug: 'sea-fco-flex-v1',
      originScopeId: seaScope.id,
      destinationScopeId: fcoScope.id,
      mode: 'FLEXIBLE',
      tripType: 'ROUND_TRIP',
      stayMinNights: 5,
      stayMaxNights: 9,
      cabin: 'ECONOMY',
      adults: 1,
      maxStops: 1,
      currency: 'USD',
      benchmarkMethodologyVersion: 'benchmark-v1',
      createdAt: NOW,
      active: true,
    })
    .returning({ id: schema.searchDefinitions.id })
    .all();
  defId = def.id;
}, 60_000);

afterAll(() => {
  dbMod.sqlite.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
});

function insights(overrides: Partial<NormalizedPriceInsights> = {}): NormalizedPriceInsights {
  return {
    lowestPriceMinor: 69000,
    priceLevel: 'typical',
    typicalLowMinor: 57000,
    typicalHighMinor: 81000,
    history: [
      { date: '2026-06-14', priceMinor: 64000 },
      { date: '2026-06-15', priceMinor: 60000 },
    ],
    ...overrides,
  };
}

function historyRows() {
  return dbMod.db
    .select()
    .from(schema.googlePriceHistory)
    .where(eq(schema.googlePriceHistory.searchDefinitionId, defId))
    .orderBy(asc(schema.googlePriceHistory.priceDate))
    .all();
}

function insightsRows() {
  return dbMod.db
    .select()
    .from(schema.routePriceInsights)
    .where(eq(schema.routePriceInsights.searchDefinitionId, defId))
    .orderBy(asc(schema.routePriceInsights.capturedAt))
    .all();
}

describe('jobs/ingest.ts#persistPriceInsights', () => {
  it('inserts one google_price_history row per history point and one route_price_insights row', () => {
    const result = ingestMod.persistPriceInsights(defId, insights(), NOW);
    expect(result.historyPointsUpserted).toBe(2);

    const history = historyRows();
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ priceDate: '2026-06-14', priceMinor: 64000, capturedAt: NOW });
    expect(history[1]).toMatchObject({ priceDate: '2026-06-15', priceMinor: 60000, capturedAt: NOW });

    const insightRows = insightsRows();
    expect(insightRows).toHaveLength(1);
    expect(insightRows[0]).toMatchObject({
      priceLevel: 'typical',
      typicalLowMinor: 57000,
      typicalHighMinor: 81000,
      lowestPriceMinor: 69000,
      capturedAt: NOW,
    });
  });

  it('re-running with the same dates UPSERTs in place (keeps exactly one row per day, latest capture wins)', () => {
    const laterCapturedAt = NOW + DAY_MS;
    ingestMod.persistPriceInsights(
      defId,
      insights({
        history: [
          { date: '2026-06-14', priceMinor: 70000 }, // revised price for a day already seen
          { date: '2026-06-15', priceMinor: 61000 },
        ],
      }),
      laterCapturedAt
    );

    // Still exactly 2 google_price_history rows for these 2 dates — no
    // duplicates accumulated.
    const history = historyRows();
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ priceDate: '2026-06-14', priceMinor: 70000, capturedAt: laterCapturedAt });
    expect(history[1]).toMatchObject({ priceDate: '2026-06-15', priceMinor: 61000, capturedAt: laterCapturedAt });

    // route_price_insights is append-only: now 2 rows (one per call).
    expect(insightsRows()).toHaveLength(2);
  });

  it('a new date in a later call adds a new row without disturbing previously-captured days', () => {
    const thirdCapturedAt = NOW + 2 * DAY_MS;
    ingestMod.persistPriceInsights(
      defId,
      insights({
        history: [
          { date: '2026-06-14', priceMinor: 71000 },
          { date: '2026-06-16', priceMinor: 62000 }, // brand-new day
        ],
      }),
      thirdCapturedAt
    );

    const history = historyRows();
    expect(history).toHaveLength(3); // 06-14 (updated), 06-15 (untouched), 06-16 (new)
    expect(history.map((r: { priceDate: string }) => r.priceDate)).toEqual(['2026-06-14', '2026-06-15', '2026-06-16']);
    expect(history[0]).toMatchObject({ priceMinor: 71000, capturedAt: thirdCapturedAt });
    // 06-15 was not part of this call's history — its row must be
    // untouched from the previous capture.
    expect(history[1]).toMatchObject({ priceMinor: 61000, capturedAt: NOW + DAY_MS });
    expect(history[2]).toMatchObject({ priceMinor: 62000, capturedAt: thirdCapturedAt });

    expect(insightsRows()).toHaveLength(3);
  });
});
