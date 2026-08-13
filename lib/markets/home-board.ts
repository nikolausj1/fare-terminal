// Read layer for the "From Seattle" personal home board (WP-P1), built on
// top of city_direction_history (populated by jobs/home-board.ts from
// /v1/city-directions against config.homeBoard.origin — see that job's and
// db/schema.ts's doc comments for why this is an append-only time series,
// unlike related_fares' upsert-replace "current" semantics). The pure
// percentile/sparkline/changePct7d math lives in ./homeBoardMetrics (unit
// tested there with plain fixtures); this file adds the DB-backed lookups
// (cityName, trackedRouteSlug) and the group/extras assembly.
//
// EXACT contract file for the UI worker (see the WP-P1 brief) — the
// interfaces below are load-bearing; don't change their shape without
// coordinating with the UI side.

import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { airports, cityDirectionHistory } from '@/db/schema';
import { config } from '@/domain/config';

import { computeDestinationMetrics, type Observation } from './homeBoardMetrics';
import { resolveDefinition } from './queries';

export interface HomeBoardDestinationVM {
  code: string;
  cityName: string | null;
  currentPriceMinor: number | null;
  observedAt: number | null;
  sparkline: number[];
  changePct7d: number | null;
  percentile: number | null;
  observationCount: number;
  trackedRouteSlug: string | null;
}

export interface HomeBoardGroupVM {
  id: string;
  label: string;
  destinations: HomeBoardDestinationVM[];
}

export interface HomeBoardVM {
  origin: string;
  originCity: string;
  groups: HomeBoardGroupVM[];
  extras: HomeBoardDestinationVM[];
  updatedAt: number | null;
}

/** Builds one destination's view-model: the pure metrics from
 * ./homeBoardMetrics plus lookups that apply whether or not the
 * destination has ever been observed (cityName, trackedRouteSlug). `now` is
 * injectable for deterministic tests. */
function buildDestinationVM(
  code: string,
  origin: string,
  observations: readonly Observation[],
  now: number
): HomeBoardDestinationVM {
  const airport = db.select().from(airports).where(eq(airports.iataCode, code)).get();
  const cityName = airport?.cityName ?? null;

  // Defaults to a FLEXIBLE lookup (no params) — every route
  // scripts/bootstrap-real.ts creates is FLEXIBLE, matching the brief's
  // "active FLEXIBLE definition" requirement. Same call shape as
  // lib/markets/related.ts#getRelatedMarkets.
  const definition = resolveDefinition(origin, code);
  const trackedRouteSlug = definition?.slug ?? null;

  const metrics = computeDestinationMetrics(observations, now);

  return {
    code,
    cityName,
    trackedRouteSlug,
    ...metrics,
  };
}

/**
 * Returns the full "From Seattle" home board: every configured group with
 * every one of its codes present (null price when city-directions has never
 * returned that destination for this origin — see domain/config.ts#homeBoard's
 * SBA/STS "honesty" note), plus an `extras` list of destinations the history
 * has seen but that aren't in any group, cheapest-first, capped at 12.
 */
export function getHomeBoard(now: number = Date.now()): HomeBoardVM {
  const origin = config.homeBoard.origin;

  const rows = db.select().from(cityDirectionHistory).where(eq(cityDirectionHistory.origin, origin)).all();

  const byDestination = new Map<string, Observation[]>();
  for (const row of rows) {
    const list = byDestination.get(row.destination);
    const observation = { priceMinor: row.priceMinor, observedAt: row.observedAt };
    if (list) {
      list.push(observation);
    } else {
      byDestination.set(row.destination, [observation]);
    }
  }

  const groupedCodes = new Set<string>();
  const groups: HomeBoardGroupVM[] = config.homeBoard.groups.map((group) => ({
    id: group.id,
    label: group.label,
    destinations: group.codes.map((code) => {
      groupedCodes.add(code);
      return buildDestinationVM(code, origin, byDestination.get(code) ?? [], now);
    }),
  }));

  const extras: HomeBoardDestinationVM[] = Array.from(byDestination.keys())
    .filter((code) => !groupedCodes.has(code))
    .map((code) => buildDestinationVM(code, origin, byDestination.get(code) ?? [], now))
    .sort((a, b) => (a.currentPriceMinor ?? Infinity) - (b.currentPriceMinor ?? Infinity))
    .slice(0, 12);

  const updatedAt = rows.length > 0 ? Math.max(...rows.map((r) => r.observedAt)) : null;

  return {
    origin,
    originCity: config.homeBoard.originCity,
    groups,
    extras,
    updatedAt,
  };
}
