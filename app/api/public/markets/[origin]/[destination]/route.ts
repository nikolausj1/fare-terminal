// GET /api/public/markets/[origin]/[destination] — read-only,
// unauthenticated: one market's public summary card plus its last 90 days
// of benchmark history points, for external citation/embedding
// (docs/API.md). See lib/markets/share.ts#toPublicMarketCard/toPublicHistory
// for the trimmed public shape (deliberately narrower than the internal
// MarketSummaryVM/HistoryPointVM returned by /api/markets/**).

import { z } from 'zod';

import { badRequest, notFound, ok } from '@/lib/markets/http';
import { getMarketHistory, getMarketSummary } from '@/lib/markets/queries';
import { resolveSiteUrl, toPublicHistory, toPublicMarketCard } from '@/lib/markets/share';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const paramsSchema = z.object({
  origin: z.string().trim().length(3, 'origin must be a 3-letter IATA code'),
  destination: z.string().trim().length(3, 'destination must be a 3-letter IATA code'),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ origin: string; destination: string }> }
) {
  const { origin, destination } = await params;
  const parsed = paramsSchema.safeParse({ origin, destination });
  if (!parsed.success) {
    return badRequest('Invalid origin/destination', parsed.error);
  }

  const summary = getMarketSummary(parsed.data.origin, parsed.data.destination);
  if (!summary) {
    return notFound(
      `No tracked market for ${parsed.data.origin.toUpperCase()}-${parsed.data.destination.toUpperCase()}`
    );
  }

  const history = getMarketHistory(summary.definition.slug, '90d');
  const siteUrl = resolveSiteUrl();

  return ok(
    {
      market: toPublicMarketCard(summary, siteUrl),
      history: toPublicHistory(history),
    },
    'public, s-maxage=1800, stale-while-revalidate=3600'
  );
}
