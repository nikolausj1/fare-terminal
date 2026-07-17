// Provider registry. Returns the active FlightDataProvider based on the
// DATA_PROVIDER env var. Only "demo" exists today; "travelpayouts" and
// others plug in here in later work packages.

import type { FlightDataProvider } from './types';

export const demoProvider: FlightDataProvider = {
  providerId: 'demo',
  async search() {
    throw new Error('not implemented (WP2)');
  },
  async healthCheck() {
    throw new Error('not implemented (WP2)');
  },
};

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
