// Provider registry. Returns the active FlightDataProvider based on the
// DATA_PROVIDER env var. "demo" is fully implemented (WP2, lib/providers/
// demo.ts). "travelpayouts" (WP6, lib/providers/travelpayouts/) is the
// first real integration; it additionally requires TRAVELPAYOUTS_TOKEN to
// be set, since there is no way to call the Travelpayouts API without one —
// see the fallback logic below and docs/PROVIDERS.md. "serpapi" (WP-P3,
// lib/providers/serpapi/) is a second real integration, similarly gated on
// SERPAPI_KEY.
//
// NOTE: setting DATA_PROVIDER=serpapi here makes it the provider for EVERY
// definition, which is not how this app actually uses serpapi day to day —
// see jobs/ingest.ts, which instead routes only the specific
// domain/config.ts#serpapi.routes definitions to serpapiProvider directly,
// leaving every other definition on whatever getActiveProvider() below
// returns. DATA_PROVIDER=serpapi is supported here mainly for completeness
// and ad-hoc/manual testing of the serpapi provider in isolation.

import { demoProvider } from './demo';
import { serpapiProvider } from './serpapi';
import { travelpayoutsProvider } from './travelpayouts';
import type { FlightDataProvider } from './types';

export { demoProvider, serpapiProvider, travelpayoutsProvider };

const providers: Record<string, FlightDataProvider> = {
  demo: demoProvider,
  travelpayouts: travelpayoutsProvider,
  serpapi: serpapiProvider,
};

export function getActiveProvider(): FlightDataProvider {
  const providerId = process.env.DATA_PROVIDER ?? 'demo';

  if (providerId === 'travelpayouts' && !process.env.TRAVELPAYOUTS_TOKEN) {
    console.warn(
      '[providers] DATA_PROVIDER=travelpayouts but TRAVELPAYOUTS_TOKEN is not set; falling back to the demo provider. Set TRAVELPAYOUTS_TOKEN to activate the real integration (see .env.example / docs/PROVIDERS.md).'
    );
    return demoProvider;
  }

  if (providerId === 'serpapi' && !process.env.SERPAPI_KEY) {
    console.warn(
      '[providers] DATA_PROVIDER=serpapi but SERPAPI_KEY is not set; falling back to the demo provider. Set SERPAPI_KEY to activate the real integration (see .env.example / docs/PROVIDERS.md).'
    );
    return demoProvider;
  }

  const provider = providers[providerId];
  if (!provider) {
    throw new Error(`Unknown DATA_PROVIDER: "${providerId}"`);
  }
  return provider;
}
