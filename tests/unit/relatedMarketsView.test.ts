// WP-F4 §3: unit coverage for the pure related-markets view transform
// backing components/market/RelatedMarkets.tsx.

import { describe, expect, it } from 'vitest';

import { toRelatedMarketRows } from '@/components/market/relatedMarketsView';
import type { RelatedMarketVM } from '@/lib/markets/related';

function makeMarket(overrides: Partial<RelatedMarketVM> = {}): RelatedMarketVM {
  return {
    destination: 'LAX',
    cityName: 'Los Angeles',
    priceMinor: 14500,
    observedAt: 1785703241739,
    trackedRouteSlug: null,
    ...overrides,
  };
}

describe('toRelatedMarketRows', () => {
  it('maps a tracked market to a resolved market-page href', () => {
    const rows = toRelatedMarketRows([makeMarket({ destination: 'LAX', trackedRouteSlug: 'bos-lax-flexible' })], 'BOS');
    expect(rows).toHaveLength(1);
    expect(rows[0].href).toBe('/market/bos/lax');
  });

  it('maps an untracked market to a null href', () => {
    const rows = toRelatedMarketRows([makeMarket({ destination: 'MIA', trackedRouteSlug: null })], 'BOS');
    expect(rows[0].href).toBeNull();
  });

  it('falls back to the destination code as cityLabel when cityName is null', () => {
    const rows = toRelatedMarketRows([makeMarket({ destination: 'XYZ', cityName: null })], 'BOS');
    expect(rows[0].cityLabel).toBe('XYZ');
  });

  it('caps at 6 rows by default, preserving the input (cheapest-first) order', () => {
    const markets = Array.from({ length: 10 }, (_, i) =>
      makeMarket({ destination: `D${i}`, priceMinor: (i + 1) * 1000 })
    );
    const rows = toRelatedMarketRows(markets, 'BOS');
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.destination)).toEqual(['D0', 'D1', 'D2', 'D3', 'D4', 'D5']);
  });

  it('respects a custom limit', () => {
    const markets = Array.from({ length: 5 }, (_, i) => makeMarket({ destination: `D${i}` }));
    expect(toRelatedMarketRows(markets, 'BOS', 2)).toHaveLength(2);
  });

  it('returns an empty array for an empty input, not an error', () => {
    expect(toRelatedMarketRows([], 'BOS')).toEqual([]);
  });

  it('preserves priceMinor and observedAt verbatim', () => {
    const rows = toRelatedMarketRows([makeMarket({ priceMinor: 99900, observedAt: 42 })], 'BOS');
    expect(rows[0].priceMinor).toBe(99900);
    expect(rows[0].observedAt).toBe(42);
  });
});
