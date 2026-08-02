// Pure-function coverage for components/home/DealsTicker.tsx's deal ->
// tracked-route mapping (WP-F3 deliverable 4). getLatestDeals() itself
// (lib/markets/deals.ts) already has integration coverage in
// tests/integration/wp-f2.test.ts — this file covers the additional
// "is this deal one of our tracked markets" mapping DealsTicker adds on
// top, which decides whether an item renders as a link or plain text.
// Only the two exported pure functions are imported (never the React
// component itself), so this needs no DOM/jsdom environment.

import { describe, expect, it } from 'vitest';

import { buildTrackedRouteMap, resolveDealSlug } from '@/components/home/DealsTicker';

describe('buildTrackedRouteMap / resolveDealSlug', () => {
  const tracked = [
    { origin: 'JFK', destination: 'LHR', slug: 'jfk-lhr-flex-v1' },
    { origin: 'LAX', destination: 'HND', slug: 'lax-hnd-flex-v1' },
  ];

  it('resolves a slug for a deal whose route is tracked', () => {
    const map = buildTrackedRouteMap(tracked);
    expect(resolveDealSlug({ origin: 'JFK', destination: 'LHR' }, map)).toBe('jfk-lhr-flex-v1');
  });

  it('is case-insensitive on both origin and destination', () => {
    const map = buildTrackedRouteMap(tracked);
    expect(resolveDealSlug({ origin: 'jfk', destination: 'lhr' }, map)).toBe('jfk-lhr-flex-v1');
  });

  it('returns null for a route that is not tracked, without throwing', () => {
    const map = buildTrackedRouteMap(tracked);
    expect(resolveDealSlug({ origin: 'IST', destination: 'NAV' }, map)).toBeNull();
  });

  it('does not match the reverse direction of a tracked route', () => {
    const map = buildTrackedRouteMap(tracked);
    expect(resolveDealSlug({ origin: 'LHR', destination: 'JFK' }, map)).toBeNull();
  });

  it('builds an empty map from an empty roster, resolving everything to null', () => {
    const map = buildTrackedRouteMap([]);
    expect(resolveDealSlug({ origin: 'JFK', destination: 'LHR' }, map)).toBeNull();
  });
});
