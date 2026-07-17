// POST /api/markets/[origin]/[destination]/refresh
//
// Demo behavior: re-runs ingest for this one search_definition via the
// active (demo) provider — which generates a fresh "current time" offer
// batch — then re-derives its snapshot/events/recommendation/analyst note,
// and returns the updated MarketSummaryVM.
//
// Rate-limited naive in-memory (per search_definition, 60s cooldown) — see
// module-level `lastRefreshAt`. This resets on cold start / redeploy, which
// is an accepted tradeoff for a demo (a real deployment would use a shared
// store, e.g. Redis).
//
// On a read-only DB (Vercel, or DB_READONLY=1 locally) there is nowhere to
// write the refreshed data, so this degrades gracefully: it returns the
// existing cached summary with `refreshed: false` and a reason, rather than
// calling into jobs that would throw on the read-only connection.

import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { isDatabaseReadonly } from '@/db';
import { badRequest, notFound, okNoStore } from '@/lib/markets/http';
import { getMarketSummary, resolveDefinition } from '@/lib/markets/queries';
import { deriveAnalystNotes } from '@/jobs/analyst-notes';
import { deriveEvents } from '@/jobs/events';
import { runIngestion } from '@/jobs/ingest';
import { deriveRecommendations } from '@/jobs/recommendations';
import { deriveSnapshots } from '@/jobs/snapshots';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const REFRESH_COOLDOWN_MS = 60_000;

// Naive in-memory rate limiter, keyed by search_definition id. Module-level
// state is intentional and sufficient for the demo (see module docstring).
const lastRefreshAt = new Map<number, number>();

const paramsSchema = z.object({
  origin: z.string().trim().length(3, 'origin must be a 3-letter IATA code'),
  destination: z.string().trim().length(3, 'destination must be a 3-letter IATA code'),
});

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ origin: string; destination: string }> }
) {
  const { origin, destination } = await params;
  const paramsParsed = paramsSchema.safeParse({ origin, destination });
  if (!paramsParsed.success) {
    return badRequest('Invalid origin/destination', paramsParsed.error);
  }

  const def = resolveDefinition(paramsParsed.data.origin, paramsParsed.data.destination);
  if (!def) {
    return notFound(
      `No tracked market for ${paramsParsed.data.origin.toUpperCase()}-${paramsParsed.data.destination.toUpperCase()}`
    );
  }

  if (isDatabaseReadonly()) {
    const summary = getMarketSummary(paramsParsed.data.origin, paramsParsed.data.destination);
    return okNoStore({ refreshed: false, reason: 'read-only-database', summary });
  }

  const now = Date.now();
  const last = lastRefreshAt.get(def.id);
  if (last !== undefined && now - last < REFRESH_COOLDOWN_MS) {
    const summary = getMarketSummary(paramsParsed.data.origin, paramsParsed.data.destination);
    return okNoStore({
      refreshed: false,
      reason: 'rate-limited',
      retryAfterMs: REFRESH_COOLDOWN_MS - (now - last),
      summary,
    });
  }
  lastRefreshAt.set(def.id, now);

  await runIngestion([def.id]);
  deriveSnapshots(def.id);
  deriveEvents(def.id);
  deriveRecommendations(def.id);
  await deriveAnalystNotes(def.id);

  const summary = getMarketSummary(paramsParsed.data.origin, paramsParsed.data.destination);
  return okNoStore({ refreshed: true, summary });
}
