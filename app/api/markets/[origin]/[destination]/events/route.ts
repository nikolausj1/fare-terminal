// GET /api/markets/[origin]/[destination]/events?types=&since=&until=&limit=

import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { badRequest, notFound, ok } from '@/lib/markets/http';
import { getMarketEvents, resolveDefinition } from '@/lib/markets/queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const paramsSchema = z.object({
  origin: z.string().trim().length(3, 'origin must be a 3-letter IATA code'),
  destination: z.string().trim().length(3, 'destination must be a 3-letter IATA code'),
});

const querySchema = z.object({
  types: z.string().optional(),
  since: z.coerce.number().optional(),
  until: z.coerce.number().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
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
    types: sp.get('types') ?? undefined,
    since: sp.get('since') ?? undefined,
    until: sp.get('until') ?? undefined,
    limit: sp.get('limit') ?? undefined,
  });
  if (!queryParsed.success) {
    return badRequest('Invalid query parameters', queryParsed.error);
  }

  const def = resolveDefinition(paramsParsed.data.origin, paramsParsed.data.destination);
  if (!def) {
    return notFound(
      `No tracked market for ${paramsParsed.data.origin.toUpperCase()}-${paramsParsed.data.destination.toUpperCase()}`
    );
  }

  const eventTypes = queryParsed.data.types
    ? queryParsed.data.types
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  const events = getMarketEvents(def.id, {
    eventTypes,
    since: queryParsed.data.since,
    until: queryParsed.data.until,
    limit: queryParsed.data.limit,
  });

  return ok({ definitionSlug: def.slug, events }, 'public, s-maxage=60, stale-while-revalidate=300');
}
