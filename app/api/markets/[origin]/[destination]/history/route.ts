// GET /api/markets/[origin]/[destination]/history?range=7d|30d|90d|all

import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { badRequest, notFound, ok } from '@/lib/markets/http';
import { getMarketHistory, resolveDefinition } from '@/lib/markets/queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const paramsSchema = z.object({
  origin: z.string().trim().length(3, 'origin must be a 3-letter IATA code'),
  destination: z.string().trim().length(3, 'destination must be a 3-letter IATA code'),
});

const querySchema = z.object({
  range: z.enum(['7d', '30d', '90d', 'all']).default('7d'),
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

  const queryParsed = querySchema.safeParse({
    range: request.nextUrl.searchParams.get('range') ?? undefined,
  });
  if (!queryParsed.success) {
    return badRequest('Invalid "range" query parameter', queryParsed.error);
  }

  const def = resolveDefinition(paramsParsed.data.origin, paramsParsed.data.destination);
  if (!def) {
    return notFound(
      `No tracked market for ${paramsParsed.data.origin.toUpperCase()}-${paramsParsed.data.destination.toUpperCase()}`
    );
  }

  const points = getMarketHistory(def.id, queryParsed.data.range);
  return ok(
    { definitionSlug: def.slug, range: queryParsed.data.range, points },
    'public, s-maxage=120, stale-while-revalidate=600'
  );
}
