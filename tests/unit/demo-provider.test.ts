import { afterEach, describe, expect, it } from 'vitest';

import { demoProvider } from '@/lib/providers/demo';
import type { NormalizedSearchQuery } from '@/domain/types';

const DEMO_NOW = '2026-07-17T12:00:00.000Z';

function flexQuery(origin: string, destination: string): NormalizedSearchQuery {
  return {
    origin,
    destination,
    mode: 'FLEXIBLE',
    departureWindowStart: '2026-08-07',
    departureWindowEnd: '2026-10-15',
    stayMinNights: 5,
    stayMaxNights: 9,
    tripType: 'ROUND_TRIP',
    cabin: 'ECONOMY',
    adults: 1,
    maxStops: 1,
    currency: 'USD',
  };
}

describe('demoProvider', () => {
  const originalDemoNow = process.env.DEMO_NOW;

  afterEach(() => {
    if (originalDemoNow === undefined) delete process.env.DEMO_NOW;
    else process.env.DEMO_NOW = originalDemoNow;
  });

  it('has providerId "demo"', () => {
    expect(demoProvider.providerId).toBe('demo');
  });

  it('search() returns a batch anchored to DEMO_NOW for a seeded market', async () => {
    process.env.DEMO_NOW = DEMO_NOW;
    const query = flexQuery('SEA', 'FCO');
    const batch = await demoProvider.search(query);

    expect(batch.providerId).toBe('demo');
    expect(batch.retrievedAt).toBe(Date.parse(DEMO_NOW));
    expect(batch.offers.length).toBeGreaterThan(0);
    for (const offer of batch.offers) {
      expect(offer.observedAt).toBe(Date.parse(DEMO_NOW));
    }
  });

  it('search() derives a generic market for an unseeded route', async () => {
    process.env.DEMO_NOW = DEMO_NOW;
    const query = flexQuery('ORD', 'MEX');
    const batch = await demoProvider.search(query);
    expect(batch.offers.length).toBeGreaterThan(0);
  });

  it('search() is deterministic for a fixed DEMO_NOW', async () => {
    process.env.DEMO_NOW = DEMO_NOW;
    const query = flexQuery('AUS', 'MEX');
    const a = await demoProvider.search(query);
    const b = await demoProvider.search(query);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('healthCheck() reports DOWN via the stale-outage canary market', async () => {
    process.env.DEMO_NOW = DEMO_NOW;
    const health = await demoProvider.healthCheck();
    expect(health.providerId).toBe('demo');
    expect(health.status).toBe('DOWN');
    expect(health.details).toContain('atl-lis');
  });

  it('buildOutboundUrl() returns a clearly-fake example.com link', async () => {
    process.env.DEMO_NOW = DEMO_NOW;
    const batch = await demoProvider.search(flexQuery('SEA', 'FCO'));
    const url = demoProvider.buildOutboundUrl?.(batch.offers[0]);
    expect(url).toBeTruthy();
    expect(url).toContain('example.com');
  });
});
