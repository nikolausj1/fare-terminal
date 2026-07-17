// Provider registry. Returns the active FlightDataProvider based on the
// DATA_PROVIDER env var. "demo" is fully implemented (WP2, lib/providers/
// demo.ts). "travelpayouts" (WP6, lib/providers/travelpayouts/) is the
// first real integration; it additionally requires TRAVELPAYOUTS_TOKEN to
// be set, since there is no way to call the Travelpayouts API without one —
// see the fallback logic below and docs/PROVIDERS.md.

import { demoProvider } from './demo';
import { travelpayoutsProvider } from './travelpayouts';
import type { FlightDataProvider } from './types';

export { demoProvider, travelpayoutsProvider };

const providers: Record<string, FlightDataProvider> = {
  demo: demoProvider,
  travelpayouts: travelpayoutsProvider,
};

export function getActiveProvider(): FlightDataProvider {
  const providerId = process.env.DATA_PROVIDER ?? 'demo';

  if (providerId === 'travelpayouts' && !process.env.TRAVELPAYOUTS_TOKEN) {
    console.warn(
      '[providers] DATA_PROVIDER=travelpayouts but TRAVELPAYOUTS_TOKEN is not set; falling back to the demo provider. Set TRAVELPAYOUTS_TOKEN to activate the real integration (see .env.example / docs/PROVIDERS.md).'
    );
    return demoProvider;
  }

  const provider = providers[providerId];
  if (!provider) {
    throw new Error(`Unknown DATA_PROVIDER: "${providerId}"`);
  }
  return provider;
}
