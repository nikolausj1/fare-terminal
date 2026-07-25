// WP-C: unit coverage for the pure "does this offer's timing need an est.
// marker" helper in components/market/OfferTable.tsx. Only exercises the
// pure function (no rendering/DOM) — component behavior itself is covered
// by tests/e2e/market.spec.ts.

import { describe, expect, it } from 'vitest';

import { hasEstimatedTiming } from '@/components/market/OfferTable';
import type { OfferRowVM } from '@/lib/markets/view-models';

function makeOfferRow(overrides: Partial<OfferRowVM> = {}): OfferRowVM {
  return {
    carrierCode: 'AA',
    carrierName: 'Test Air',
    priceMinor: 30000,
    currency: 'USD',
    stops: 0,
    durationMinutes: 300,
    departIso: '2026-09-01T08:00:00Z',
    arriveIso: '2026-09-01T13:00:00Z',
    fareBrand: null,
    seatsRemaining: null,
    lastObservedAt: Date.parse('2026-07-17T00:00:00Z'),
    outboundUrl: null,
    qualityFlags: [],
    ...overrides,
  };
}

describe('hasEstimatedTiming', () => {
  it('is false when qualityFlags is empty (demo offers)', () => {
    expect(hasEstimatedTiming(makeOfferRow({ qualityFlags: [] }))).toBe(false);
  });

  it('is false when qualityFlags has unrelated flags only', () => {
    expect(hasEstimatedTiming(makeOfferRow({ qualityFlags: ['SUSPECTED_ANOMALY'] }))).toBe(false);
  });

  it('is true for SYNTHETIC_SEGMENTS', () => {
    expect(hasEstimatedTiming(makeOfferRow({ qualityFlags: ['SYNTHETIC_SEGMENTS'] }))).toBe(true);
  });

  it('is true for ESTIMATED_LEG_SPLIT', () => {
    expect(hasEstimatedTiming(makeOfferRow({ qualityFlags: ['ESTIMATED_LEG_SPLIT'] }))).toBe(true);
  });

  it('is true for ESTIMATED_DURATION', () => {
    expect(hasEstimatedTiming(makeOfferRow({ qualityFlags: ['ESTIMATED_DURATION'] }))).toBe(true);
  });

  it('is true when mixed with unrelated flags', () => {
    expect(
      hasEstimatedTiming(
        makeOfferRow({ qualityFlags: ['AGGREGATED_CACHED_SOURCE', 'SYNTHETIC_SEGMENTS', 'ESTIMATED_LEG_SPLIT'] })
      )
    ).toBe(true);
  });
});
