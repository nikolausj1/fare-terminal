// GET /api/markets/[origin]/[destination]?mode=&depart=&return=&cabin=&stops=
//
// Resolves the matching search_definition (FLEXIBLE by default) and returns
// its MarketSummaryVM. 404 when the route isn't tracked (or has no
// derived snapshots yet).

import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { cabinSchema, searchModeSchema } from '@/domain/schemas';
import { badRequest, notFound, ok } from '@/lib/markets/http';
import { getMarketSummary } from '@/lib/markets/queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const paramsSchema = z.object({
  origin: z.string().trim().length(3, 'origin must be a 3-letter IATA code'),
  destination: z.string().trim().length(3, 'destination must be a 3-letter IATA code'),
});

const querySchema = z.object({
  mode: searchModeSchema.optional(),
  depart: z.string().optional(),
  return: z.string().optional(),
  cabin: cabinSchema.optional(),
  stops: z.coerce.number().int().nonnegative().optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ origin: string; destination: string }> }
) {
  const { origin, destination } = await params;
  const paramsParsed = paramsSchema.safeParse({ origin, destination });
  if (!paramsParsed.success) {
    return badRequest('Invalid origin/destination', paramsParsed.error);
  }

  const sp = request.nextUrl.searchParams;
  const queryParsed = querySchema.safeParse({
    mode: sp.get('mode') ?? undefined,
    depart: sp.get('depart') ?? undefined,
    return: sp.get('return') ?? undefined,
    cabin: sp.get('cabin') ?? undefined,
    stops: sp.get('stops') ?? undefined,
  });
  if (!queryParsed.success) {
    return badRequest('Invalid query parameters', queryParsed.error);
  }

  const summary = getMarketSummary(paramsParsed.data.origin, paramsParsed.data.destination, queryParsed.data);
  if (!summary) {
    return notFound(
      `No tracked market for ${paramsParsed.data.origin.toUpperCase()}-${paramsParsed.data.destination.toUpperCase()}`
    );
  }

  return ok(summary, 'public, s-maxage=60, stale-while-revalidate=300');
}
