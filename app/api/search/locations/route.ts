// GET /api/search/locations?q= — prefix/substring match on seeded airports
// (IATA code, airport name, or city name).

import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { badRequest, ok } from '@/lib/markets/http';
import { searchLocations } from '@/lib/markets/queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const querySchema = z.object({
  q: z.string().trim().min(1, 'q must not be empty').max(100),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({ q: request.nextUrl.searchParams.get('q') ?? '' });
  if (!parsed.success) {
    return badRequest('Invalid "q" query parameter', parsed.error);
  }

  const results = searchLocations(parsed.data.q);
  return ok({ results }, 'public, s-maxage=3600, stale-while-revalidate=86400');
}
