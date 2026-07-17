// Shared glue for the derivation jobs: CLI plumbing (so every job file is
// runnable directly via `tsx jobs/<name>.ts [ids]`) and DB-row -> query
// helpers that are specific to how jobs walk search_definitions (as opposed
// to lib/markets/offers.ts, which is the read-layer's row conversion).

import { fileURLToPath } from 'node:url';

import { eq } from 'drizzle-orm';

import { db, sqlite } from '@/db';
import { marketScopes, searchDefinitions } from '@/db/schema';
import { config } from '@/domain/config';
import type { Cabin, NormalizedSearchQuery } from '@/domain/types';

const DAY_MS = 86_400_000;

/** True when this module is being executed directly (`tsx jobs/foo.ts`)
 * rather than imported by another module (e.g. jobs/pipeline.ts, or a
 * test). */
export function isMainModule(importMetaUrl: string): boolean {
  try {
    return process.argv[1] === fileURLToPath(importMetaUrl);
  } catch {
    return false;
  }
}

/** Parses an optional comma-separated list of search_definition ids from
 * `tsx jobs/foo.ts 1,2,3`. Returns undefined (meaning "all") when no arg is
 * given. */
export function parseDefinitionIdsArg(argv: string[]): number[] | undefined {
  const raw = argv[2];
  if (!raw) return undefined;
  const ids = raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
  return ids.length > 0 ? ids : undefined;
}

/** Runs a job's entry point when invoked as a CLI: logs the returned
 * summary as JSON, closes the sqlite handle, and exits non-zero on error. */
export async function runCli<T>(fn: () => T | Promise<T>): Promise<void> {
  try {
    const summary = await fn();
    console.log(JSON.stringify(summary, null, 2));
    sqlite.close();
  } catch (err) {
    console.error(err);
    sqlite.close();
    process.exit(1);
  }
}

export type SearchDefinitionRow = typeof searchDefinitions.$inferSelect;

/** Resolves a search_definitions row's origin/destination IATA codes via its
 * AIRPORT market_scopes (search_definitions stores scope ids, not codes
 * directly). */
export function resolveDefinitionRoute(def: SearchDefinitionRow): {
  origin: string;
  destination: string;
} {
  const originScope = db
    .select()
    .from(marketScopes)
    .where(eq(marketScopes.id, def.originScopeId))
    .get();
  const destScope = db
    .select()
    .from(marketScopes)
    .where(eq(marketScopes.id, def.destinationScopeId))
    .get();
  if (!originScope || !destScope) {
    throw new Error(`search_definitions ${def.id}: missing origin/destination market_scopes`);
  }
  return { origin: originScope.code, destination: destScope.code };
}

/**
 * Builds a NormalizedSearchQuery for a search_definitions row, read from the
 * definition's own persisted fields (cabin/tripType/adults/maxStops/
 * currency/stay nights) rather than re-deriving them from a db/seed/markets
 * MarketSpec — ingest.ts only has an origin/destination pair, not a market
 * spec, and should respect whatever the definition actually says regardless
 * of whether the route happens to match one of the curated demo markets.
 *
 * FLEXIBLE windows are relative to `now` (matching how a real flexible
 * search's window drifts forward day over day — see
 * db/seed/generate.ts#resolveFlexibleQuery, which this mirrors using
 * config.demoDefaults rather than importing the seed/provider-layer
 * function directly).
 */
export function buildQueryFromDefinition(
  def: SearchDefinitionRow,
  origin: string,
  destination: string,
  now: number
): NormalizedSearchQuery {
  const cabin = def.cabin as Cabin;

  if (def.mode === 'EXACT') {
    if (!def.departureDate) {
      throw new Error(`EXACT search_definitions ${def.id} is missing departureDate`);
    }
    return {
      origin,
      destination,
      mode: 'EXACT',
      departureDate: def.departureDate,
      returnDate: def.returnDate ?? undefined,
      tripType: def.tripType,
      cabin,
      adults: def.adults,
      maxStops: def.maxStops,
      currency: def.currency,
    };
  }

  const start = now + config.demoDefaults.flexibleWindowMinDays * DAY_MS;
  const end = now + config.demoDefaults.flexibleWindowMaxDays * DAY_MS;
  return {
    origin,
    destination,
    mode: 'FLEXIBLE',
    departureWindowStart: new Date(start).toISOString().slice(0, 10),
    departureWindowEnd: new Date(end).toISOString().slice(0, 10),
    stayMinNights: def.stayMinNights ?? config.demoDefaults.stayMinNights,
    stayMaxNights: def.stayMaxNights ?? config.demoDefaults.stayMaxNights,
    tripType: def.tripType,
    cabin,
    adults: def.adults,
    maxStops: def.maxStops,
    currency: def.currency,
  };
}
