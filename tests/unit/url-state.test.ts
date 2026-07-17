import { describe, expect, it } from 'vitest';

import {
  buildMarketUrl,
  parseMarketUrlState,
  serializeMarketUrlState,
  toQueryLookupParams,
  type MarketUrlState,
} from '@/lib/url-state';

describe('parseMarketUrlState', () => {
  it('defaults to flexible when no params are present', () => {
    expect(parseMarketUrlState({})).toEqual({ mode: 'flexible' });
  });

  it('parses a full exact state with depart + return', () => {
    expect(
      parseMarketUrlState({ mode: 'exact', depart: '2026-09-15', return: '2026-09-22' })
    ).toEqual({ mode: 'exact', depart: '2026-09-15', return: '2026-09-22' });
  });

  it('parses a one-way exact state (depart only)', () => {
    expect(parseMarketUrlState({ mode: 'exact', depart: '2026-09-15' })).toEqual({
      mode: 'exact',
      depart: '2026-09-15',
    });
  });

  it('falls back to flexible when mode=exact but depart is missing', () => {
    expect(parseMarketUrlState({ mode: 'exact' })).toEqual({ mode: 'flexible' });
  });

  it('falls back to flexible when depart is present without mode=exact (absence of mode = flexible)', () => {
    expect(parseMarketUrlState({ depart: '2026-09-15' })).toEqual({ mode: 'flexible' });
  });

  it('falls back to flexible on a malformed depart date', () => {
    expect(parseMarketUrlState({ mode: 'exact', depart: '09/15/2026' })).toEqual({ mode: 'flexible' });
  });

  it('drops an invalid return date but keeps a valid depart date', () => {
    expect(parseMarketUrlState({ mode: 'exact', depart: '2026-09-15', return: 'not-a-date' })).toEqual({
      mode: 'exact',
      depart: '2026-09-15',
    });
  });

  it('ignores unknown query params', () => {
    expect(
      parseMarketUrlState({ mode: 'exact', depart: '2026-09-15', cabin: 'BUSINESS', foo: 'bar' })
    ).toEqual({ mode: 'exact', depart: '2026-09-15' });
  });

  it('takes the first value when a param is repeated (array form)', () => {
    expect(parseMarketUrlState({ mode: ['exact', 'flexible'], depart: ['2026-09-15'] })).toEqual({
      mode: 'exact',
      depart: '2026-09-15',
    });
  });

  it('ignores an explicit mode=flexible with stray depart/return', () => {
    expect(parseMarketUrlState({ mode: 'flexible', depart: '2026-09-15', return: '2026-09-22' })).toEqual({
      mode: 'flexible',
    });
  });
});

describe('serializeMarketUrlState', () => {
  it('serializes the flexible default to an empty string', () => {
    expect(serializeMarketUrlState({ mode: 'flexible' })).toBe('');
  });

  it('serializes exact state in canonical order mode, depart, return', () => {
    const qs = serializeMarketUrlState({ mode: 'exact', depart: '2026-09-15', return: '2026-09-22' });
    expect(qs).toBe('mode=exact&depart=2026-09-15&return=2026-09-22');
  });

  it('omits return when absent (one-way)', () => {
    expect(serializeMarketUrlState({ mode: 'exact', depart: '2026-09-15' })).toBe(
      'mode=exact&depart=2026-09-15'
    );
  });

  it('treats exact mode without depart as flexible (empty string)', () => {
    expect(serializeMarketUrlState({ mode: 'exact' })).toBe('');
  });
});

describe('round-trip', () => {
  const cases: MarketUrlState[] = [
    { mode: 'flexible' },
    { mode: 'exact', depart: '2026-09-15' },
    { mode: 'exact', depart: '2026-09-15', return: '2026-09-22' },
  ];

  for (const state of cases) {
    it(`round-trips ${JSON.stringify(state)}`, () => {
      const qs = serializeMarketUrlState(state);
      const params = new URLSearchParams(qs);
      const raw: Record<string, string> = {};
      for (const [k, v] of params.entries()) raw[k] = v;
      expect(parseMarketUrlState(raw)).toEqual(state);
    });
  }

  it('re-serializing a parsed malformed input converges to the canonical flexible form', () => {
    const parsed = parseMarketUrlState({ mode: 'exact', depart: '15-09-2026' });
    const qs = serializeMarketUrlState(parsed);
    expect(qs).toBe('');
  });
});

describe('buildMarketUrl', () => {
  it('builds a bare path for the flexible default', () => {
    expect(buildMarketUrl('SEA', 'FCO', { mode: 'flexible' })).toBe('/market/sea/fco');
  });

  it('lowercases origin/destination and appends the canonical query', () => {
    expect(buildMarketUrl('JFK', 'LHR', { mode: 'exact', depart: '2026-09-15' })).toBe(
      '/market/jfk/lhr?mode=exact&depart=2026-09-15'
    );
  });
});

describe('toQueryLookupParams', () => {
  it('maps flexible state to { mode: FLEXIBLE }', () => {
    expect(toQueryLookupParams({ mode: 'flexible' })).toEqual({ mode: 'FLEXIBLE' });
  });

  it('maps exact state to uppercase MarketLookupParams shape', () => {
    expect(toQueryLookupParams({ mode: 'exact', depart: '2026-09-15', return: '2026-09-22' })).toEqual({
      mode: 'EXACT',
      depart: '2026-09-15',
      return: '2026-09-22',
    });
  });
});
