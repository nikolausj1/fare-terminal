// Provider registry. Returns the active FlightDataProvider based on the
// DATA_PROVIDER env var. "demo" is fully implemented (WP2, lib/providers/
// demo.ts); "travelpayouts" and other real integrations plug in here later.

import { demoProvider } from './demo';
import type { FlightDataProvider } from './types';

export { demoProvider };

const providers: Record<string, FlightDataProvider> = {
  demo: demoProvider,
};

export function getActiveProvider(): FlightDataProvider {
  const providerId = process.env.DATA_PROVIDER ?? 'demo';
  const provider = providers[providerId];
  if (!provider) {
    throw new Error(`Unknown DATA_PROVIDER: "${providerId}"`);
  }
  return provider;
}
