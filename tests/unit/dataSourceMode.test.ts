// WP-C: unit coverage for the pure DataSourceMode derivation used by
// lib/markets/queries.ts#getDataSourceMode (the DB-backed wrapper) and
// consumed by MarketSummaryVM/PulseVM plus the DemoBanner/Footer/OfferTable
// components. Deliberately exercises fake provider_id combinations rather
// than touching a real DB — see lib/markets/dataSourceMode.ts's module
// docstring for why the derivation is split out into a DB-free module.

import { describe, expect, it } from 'vitest';

import { deriveDataSourceMode } from '@/lib/markets/dataSourceMode';

describe('deriveDataSourceMode', () => {
  it('returns DEMO when every provider_id is demo', () => {
    expect(deriveDataSourceMode(['demo'])).toBe('DEMO');
    expect(deriveDataSourceMode(['demo', 'demo'])).toBe('DEMO');
  });

  it('returns DEMO for an empty/fresh DB with no search_runs yet', () => {
    expect(deriveDataSourceMode([])).toBe('DEMO');
  });

  it('returns AGGREGATED_CACHED when every provider_id is a real provider', () => {
    expect(deriveDataSourceMode(['travelpayouts'])).toBe('AGGREGATED_CACHED');
  });

  it('returns AGGREGATED_CACHED for a real provider other than travelpayouts too (anything non-demo)', () => {
    expect(deriveDataSourceMode(['some-future-provider'])).toBe('AGGREGATED_CACHED');
  });

  it('returns MIXED — the tripwire case — when demo and a real provider both appear', () => {
    expect(deriveDataSourceMode(['demo', 'travelpayouts'])).toBe('MIXED');
  });

  it('returns MIXED regardless of ordering', () => {
    expect(deriveDataSourceMode(['travelpayouts', 'demo'])).toBe('MIXED');
  });
});
