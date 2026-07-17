// GET /api/market-pulse — deterministic template brief assembled from
// already-derived snapshots/recommendations/events (see
// lib/markets/queries.ts#getMarketPulse for the quality gates).

import { ok } from '@/lib/markets/http';
import { getMarketPulse } from '@/lib/markets/queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const pulse = getMarketPulse();
  return ok(pulse, 'public, s-maxage=60, stale-while-revalidate=300');
}
