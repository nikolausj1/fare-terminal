// The "demo" FlightDataProvider: a fully synthetic, deterministic data
// source built from db/seed/{markets,generate}.ts. search() regenerates the
// current batch on the fly (anchored to getNow()) using the exact same
// pure functions the seed script uses to build history, so live queries
// and seeded history are always internally consistent for the same "now".

import { config } from '@/domain/config';
import type {
  NormalizedOffer,
  NormalizedOfferBatch,
  NormalizedSearchQuery,
  ProviderHealth,
} from '@/domain/types';

import { getNow } from '@/lib/demo-time';
import { computeRunTimestamps, deriveGenericMarket, generateOfferBatch } from '@/db/seed/generate';
import { findMarketByRoute, MARKETS, type MarketSpec } from '@/db/seed/markets';

import type { FlightDataProvider } from './types';

function resolveMarket(query: NormalizedSearchQuery): MarketSpec {
  return (
    findMarketByRoute(query.origin, query.destination) ??
    deriveGenericMarket(query.origin, query.destination)
  );
}

export const demoProvider: FlightDataProvider = {
  providerId: 'demo',

  async search(query: NormalizedSearchQuery): Promise<NormalizedOfferBatch> {
    const now = getNow();
    const market = resolveMarket(query);
    const offers: NormalizedOffer[] = generateOfferBatch(market, query, now, now);
    return {
      providerId: 'demo',
      query,
      retrievedAt: now,
      offers,
      warnings: [],
    };
  },

  async healthCheck(): Promise<ProviderHealth> {
    const now = getNow();
    // Canary check: the demo dataset dedicates one market to the "stale
    // data / provider outage" scenario (no observations in the last ~10h).
    // Using it as the health-check probe reliably exercises the DOWN path
    // required by the demo, while every other synthetic market stays
    // fresh, so this is the only source of a DOWN status.
    const outageMarket = MARKETS.find((m) => m.scenario === 'STALE_OUTAGE');
    if (outageMarket) {
      const runs = computeRunTimestamps(outageMarket, now);
      const lastRunAt = runs.length > 0 ? runs[runs.length - 1] : now - 24 * 3_600_000;
      const freshnessMinutes = (now - lastRunAt) / 60_000;
      if (freshnessMinutes > config.freshness.staleAfterMinutes) {
        return {
          providerId: 'demo',
          status: 'DOWN',
          details: `Canary market "${outageMarket.id}" has no observations in the last ${Math.round(
            freshnessMinutes
          )}m (demo outage scenario; threshold ${config.freshness.staleAfterMinutes}m).`,
        };
      }
    }
    return { providerId: 'demo', status: 'OK', latencyMs: 5 };
  },

  buildOutboundUrl(offer: NormalizedOffer): string | null {
    const params = new URLSearchParams({
      carrier: offer.validatingCarrier,
      offer: offer.providerOfferId,
      price: String(offer.totalPriceMinor),
    });
    // Clearly-fake booking link — the demo provider never talks to a real
    // airline or OTA.
    return `https://demo.example.com/fare-terminal/book?${params.toString()}`;
  },
};
