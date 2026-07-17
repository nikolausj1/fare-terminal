// Provider-layer contract. Every flight data provider (demo, travelpayouts,
// ...) implements this interface. See lib/providers/index.ts for the
// registry that picks the active provider from env.

import type {
  NormalizedOffer,
  NormalizedOfferBatch,
  NormalizedSearchQuery,
  ProviderHealth,
} from '@/domain/types';

export interface FlightDataProvider {
  readonly providerId: string;
  search(query: NormalizedSearchQuery): Promise<NormalizedOfferBatch>;
  healthCheck(): Promise<ProviderHealth>;
  buildOutboundUrl?(offer: NormalizedOffer): string | null;
}
