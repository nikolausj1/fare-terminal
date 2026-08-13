import { describe, expect, it } from 'vitest';

import type { NormalizedSearchQuery } from '@/domain/types';

import {
  mapGoogleFlights,
  mapPriceInsights,
  QUALITY_FLAG_LIVE_SEARCH_SOURCE,
  QUALITY_FLAG_NAIVE_LOCAL_TIMESTAMPS,
  QUALITY_FLAG_OUTBOUND_ONLY_SEGMENTS,
} from '@/lib/providers/serpapi/mapping';

import realRoundTripFixture from './fixtures/serpapi-real-sea-fco-2026-08-02.json';
import oneWayFixture from './fixtures/serpapi/one-way-minimal.json';
import malformedFixture from './fixtures/serpapi/malformed-empty.json';
import errorFixture from './fixtures/serpapi/error-response.json';

const RETRIEVED_AT = Date.parse('2026-08-13T18:00:00.000Z');

function roundTripQuery(overrides: Partial<NormalizedSearchQuery> = {}): NormalizedSearchQuery {
  return {
    origin: 'SEA',
    destination: 'FCO',
    mode: 'EXACT',
    departureDate: '2026-09-15',
    returnDate: '2026-09-23',
    tripType: 'ROUND_TRIP',
    cabin: 'ECONOMY',
    adults: 1,
    maxStops: 1,
    currency: 'USD',
    ...overrides,
  };
}

function oneWayQuery(overrides: Partial<NormalizedSearchQuery> = {}): NormalizedSearchQuery {
  return {
    origin: 'SEA',
    destination: 'PHX',
    mode: 'EXACT',
    departureDate: '2026-10-05',
    tripType: 'ONE_WAY',
    cabin: 'ECONOMY',
    adults: 1,
    maxStops: 1,
    currency: 'USD',
    ...overrides,
  };
}

describe('mapGoogleFlights — real captured round-trip fixture (SEA-FCO, 2026-08-13 capture)', () => {
  it('maps best_flights + other_flights into offers with real multi-segment itineraries', () => {
    const result = mapGoogleFlights(realRoundTripFixture, roundTripQuery(), RETRIEVED_AT);

    // 3 best_flights + 9 other_flights in the real capture, all well-formed.
    expect(result.offers).toHaveLength(12);

    const cheapest = result.offers.find((o) => o.totalPriceMinor === 69000);
    expect(cheapest).toBeDefined();
    expect(cheapest!.currency).toBe('USD');
    expect(cheapest!.validatingCarrier).toBe('DE');
    expect(cheapest!.marketingCarriers).toEqual(['DE']);
    expect(cheapest!.segments).toHaveLength(2);
    expect(cheapest!.segments[0].origin).toBe('SEA');
    expect(cheapest!.segments[0].destination).toBe('FRA');
    expect(cheapest!.segments[0].operatingFlightNumber).toBe('DE 2033');
    expect(cheapest!.segments[1].origin).toBe('FRA');
    expect(cheapest!.segments[1].destination).toBe('FCO');
    expect(cheapest!.stopCount).toBe(1); // one layover entry (FRA)
    expect(cheapest!.durationMinutes).toBe(1125); // Google's own total_duration
  });

  it('derives segment timestamps from the naive-UTC-labeled departure time plus each leg duration', () => {
    const result = mapGoogleFlights(realRoundTripFixture, roundTripQuery(), RETRIEVED_AT);
    const cheapest = result.offers.find((o) => o.totalPriceMinor === 69000)!;

    // departure_airport.time "2026-09-15 18:05" treated as a UTC instant.
    expect(cheapest.segments[0].departureAt).toBe('2026-09-15T18:05:00.000Z');
    // duration 605 minutes later.
    expect(cheapest.segments[0].arrivalAt).toBe('2026-09-16T04:10:00.000Z');
    // second leg: departure_airport.time "2026-09-16 20:00", duration 110.
    expect(cheapest.segments[1].departureAt).toBe('2026-09-16T20:00:00.000Z');
    expect(cheapest.segments[1].arrivalAt).toBe('2026-09-16T21:50:00.000Z');
  });

  it('flags every offer LIVE_SEARCH_SOURCE + NAIVE_LOCAL_TIMESTAMPS, and OUTBOUND_ONLY_SEGMENTS for round trips', () => {
    const result = mapGoogleFlights(realRoundTripFixture, roundTripQuery(), RETRIEVED_AT);
    for (const offer of result.offers) {
      expect(offer.qualityFlags).toContain(QUALITY_FLAG_LIVE_SEARCH_SOURCE);
      expect(offer.qualityFlags).toContain(QUALITY_FLAG_NAIVE_LOCAL_TIMESTAMPS);
      expect(offer.qualityFlags).toContain(QUALITY_FLAG_OUTBOUND_ONLY_SEGMENTS);
      expect(offer.qualityFlags).not.toContain('SYNTHETIC_SEGMENTS');
    }
  });

  it('carries the batch-level google_flights_url onto every offer as outboundUrl', () => {
    const result = mapGoogleFlights(realRoundTripFixture, roundTripQuery(), RETRIEVED_AT);
    const expectedUrl = (realRoundTripFixture as { search_metadata: { google_flights_url: string } }).search_metadata
      .google_flights_url;
    for (const offer of result.offers) {
      expect(offer.outboundUrl).toBe(expectedUrl);
    }
  });

  it('produces deterministic, distinct providerOfferIds prefixed sp_', () => {
    const first = mapGoogleFlights(realRoundTripFixture, roundTripQuery(), RETRIEVED_AT);
    const second = mapGoogleFlights(realRoundTripFixture, roundTripQuery(), RETRIEVED_AT);

    expect(first.offers.map((o) => o.providerOfferId)).toEqual(second.offers.map((o) => o.providerOfferId));
    for (const offer of first.offers) {
      expect(offer.providerOfferId.startsWith('sp_')).toBe(true);
    }
    const uniqueIds = new Set(first.offers.map((o) => o.providerOfferId));
    expect(uniqueIds.size).toBe(first.offers.length);
  });

  it('a different retrievedAt changes the providerOfferId (retrieval time is part of the hash)', () => {
    const first = mapGoogleFlights(realRoundTripFixture, roundTripQuery(), RETRIEVED_AT);
    const second = mapGoogleFlights(realRoundTripFixture, roundTripQuery(), RETRIEVED_AT + 60_000);
    expect(first.offers[0].providerOfferId).not.toBe(second.offers[0].providerOfferId);
  });
});

describe('mapGoogleFlights — price_insights (WP-P5, real captured fixture)', () => {
  it('maps the full price_insights object: lowest price, price level, typical range, and every history point', () => {
    const result = mapGoogleFlights(realRoundTripFixture, roundTripQuery(), RETRIEVED_AT);
    expect(result.priceInsights).toBeDefined();
    const insights = result.priceInsights!;

    expect(insights.lowestPriceMinor).toBe(69000); // 690 * 100
    expect(insights.priceLevel).toBe('typical');
    expect(insights.typicalLowMinor).toBe(57000); // 570 * 100
    expect(insights.typicalHighMinor).toBe(81000); // 810 * 100
    expect(insights.history).toHaveLength(61);
  });

  it('converts each price_history unix-seconds timestamp to a UTC calendar-day date string', () => {
    const result = mapGoogleFlights(realRoundTripFixture, roundTripQuery(), RETRIEVED_AT);
    const insights = result.priceInsights!;

    // Fixture's first point is [1781420400, 640] -> 2026-06-14T07:00:00.000Z
    // -> UTC calendar day "2026-06-14"; last point [1786604400, 690] ->
    // 2026-08-13T07:00:00.000Z -> "2026-08-13".
    expect(insights.history[0]).toEqual({ date: '2026-06-14', priceMinor: 64000 });
    expect(insights.history[insights.history.length - 1]).toEqual({ date: '2026-08-13', priceMinor: 69000 });
  });
});

describe('mapPriceInsights — direct unit coverage (present/absent/partial)', () => {
  it('returns undefined (no warning-worthy failure) when price_insights is entirely absent', () => {
    const warnings: string[] = [];
    expect(mapPriceInsights(undefined, warnings)).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  it('drops the whole object (with a warning) when lowest_price is missing', () => {
    const warnings: string[] = [];
    const result = mapPriceInsights({ price_level: 'typical', typical_price_range: [500, 700] }, warnings);
    expect(result).toBeUndefined();
    expect(warnings.some((w) => w.includes('missing/invalid lowest_price'))).toBe(true);
  });

  it('drops the whole object (with a warning) when price_level is missing', () => {
    const warnings: string[] = [];
    const result = mapPriceInsights({ lowest_price: 690, typical_price_range: [500, 700] }, warnings);
    expect(result).toBeUndefined();
    expect(warnings.some((w) => w.includes('missing price_level'))).toBe(true);
  });

  it('yields null typicalLow/HighMinor (not a dropped object) when typical_price_range is entirely absent', () => {
    const warnings: string[] = [];
    const result = mapPriceInsights({ lowest_price: 690, price_level: 'typical' }, warnings);
    expect(result).toEqual({
      lowestPriceMinor: 69000,
      priceLevel: 'typical',
      typicalLowMinor: null,
      typicalHighMinor: null,
      history: [],
    });
    expect(warnings).toEqual([]);
  });

  it('yields null typicalLow/HighMinor plus a warning when typical_price_range is present but unparseable', () => {
    const warnings: string[] = [];
    const result = mapPriceInsights(
      { lowest_price: 690, price_level: 'typical', typical_price_range: ['not-a-number'] },
      warnings
    );
    expect(result?.typicalLowMinor).toBeNull();
    expect(result?.typicalHighMinor).toBeNull();
    expect(warnings.some((w) => w.includes('typical_price_range present but not a valid'))).toBe(true);
  });

  it('skips an individual unparseable history point (with a warning) but keeps the rest', () => {
    const warnings: string[] = [];
    const result = mapPriceInsights(
      {
        lowest_price: 690,
        price_level: 'typical',
        price_history: [
          [1781420400, 640],
          ['not-a-timestamp', 600],
          [1781593200, 'not-a-price'],
          [1781679600, 700],
        ],
      },
      warnings
    );
    expect(result?.history).toEqual([
      { date: '2026-06-14', priceMinor: 64000 },
      { date: '2026-06-17', priceMinor: 70000 },
    ]);
    expect(warnings.filter((w) => w.includes('skipped history point'))).toHaveLength(2);
  });

  it('mapGoogleFlights never throws when price_insights is present but shaped wrong (zod strips it via mapGoogleFlights\' own safeParse before mapPriceInsights ever sees it)', () => {
    const result = mapGoogleFlights(
      { price_insights: { lowest_price: 'not-a-number', price_history: 'nonsense' } },
      oneWayQuery(),
      RETRIEVED_AT
    );
    expect(result.offers).toEqual([]);
    expect(result.priceInsights).toBeUndefined();
  });
});

describe('mapGoogleFlights — minimal one-way fixture', () => {
  it('maps a single nonstop leg with no layovers and no OUTBOUND_ONLY_SEGMENTS flag', () => {
    const result = mapGoogleFlights(oneWayFixture, oneWayQuery(), RETRIEVED_AT);

    expect(result.offers).toHaveLength(1);
    const offer = result.offers[0];
    expect(offer.segments).toHaveLength(1);
    expect(offer.stopCount).toBe(0);
    expect(offer.totalPriceMinor).toBe(14900); // 149 * 100
    expect(offer.durationMinutes).toBe(225);
    expect(offer.qualityFlags).toContain(QUALITY_FLAG_LIVE_SEARCH_SOURCE);
    expect(offer.qualityFlags).not.toContain(QUALITY_FLAG_OUTBOUND_ONLY_SEGMENTS);
  });

  it('leaves outboundUrl undefined when search_metadata.google_flights_url is absent', () => {
    const result = mapGoogleFlights(oneWayFixture, oneWayQuery(), RETRIEVED_AT);
    expect(result.offers[0].outboundUrl).toBeUndefined();
  });
});

describe('mapGoogleFlights — malformed/empty fixture', () => {
  it('skips items with missing price, missing airport id, missing flight_number, or no legs — with warnings', () => {
    const result = mapGoogleFlights(malformedFixture, roundTripQuery({ origin: 'SEA', destination: 'TUS' }), RETRIEVED_AT);

    expect(result.offers).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes('missing/invalid price'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('flights[].arrival_airport.id'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('missing flight_number'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('no flights[] legs present'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('0 offers extracted'))).toBe(true);
  });
});

describe('mapGoogleFlights — in-band error response', () => {
  it('returns 0 offers plus a warning quoting the error, without throwing', () => {
    const result = mapGoogleFlights(errorFixture, oneWayQuery({ destination: 'NCE' }), RETRIEVED_AT);

    expect(result.offers).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("Google hasn't returned any results"))).toBe(true);
  });

  it('tolerates an unrecognized-but-shape-compatible payload without throwing (every field is optional)', () => {
    const result = mapGoogleFlights({ nonsense: true }, oneWayQuery(), RETRIEVED_AT);
    expect(result.offers).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('reports a schema-mismatch warning (not a throw) when a declared field has the wrong type', () => {
    const result = mapGoogleFlights({ best_flights: 'not-an-array' }, oneWayQuery(), RETRIEVED_AT);
    expect(result.offers).toEqual([]);
    expect(result.warnings.some((w) => w.includes('did not match the expected shape'))).toBe(true);
  });
});
