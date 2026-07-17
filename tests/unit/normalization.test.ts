import { describe, expect, it } from 'vitest';
import { itineraryFingerprint } from '@/domain/normalization/fingerprint';
import { normalizeAndValidate } from '@/domain/normalization/validate';
import { dedupeOffers } from '@/domain/normalization/dedupe';
import { flagAnomalies } from '@/domain/normalization/anomaly';
import { makeOffer, makeSegment } from './fixtures';
import type { NormalizedOfferBatch } from '@/domain/types';

describe('itineraryFingerprint', () => {
  it('is stable across repeated calls with the same segments', () => {
    const segments = [makeSegment()];
    expect(itineraryFingerprint(segments)).toBe(itineraryFingerprint(segments));
  });

  it('is stable across two structurally-identical-but-distinct segment arrays', () => {
    const a = [makeSegment()];
    const b = [makeSegment()];
    expect(itineraryFingerprint(a)).toBe(itineraryFingerprint(b));
  });

  it('excludes provider-specific ids: two offers with the same flights but different providerOfferId hash identically', () => {
    const offerA = makeOffer({ providerOfferId: 'provider-a-1' });
    const offerB = makeOffer({ providerOfferId: 'provider-b-999' });
    expect(itineraryFingerprint(offerA.segments)).toBe(
      itineraryFingerprint(offerB.segments)
    );
  });

  it('excludes marketingFlightNumber (codeshares hash identically)', () => {
    const a = [makeSegment({ marketingFlightNumber: 'BA9100' })];
    const b = [makeSegment({ marketingFlightNumber: 'IB100' })];
    expect(itineraryFingerprint(a)).toBe(itineraryFingerprint(b));
  });

  it('differs when the operating flight number differs', () => {
    const a = [makeSegment({ operatingFlightNumber: 'AA100' })];
    const b = [makeSegment({ operatingFlightNumber: 'AA200' })];
    expect(itineraryFingerprint(a)).not.toBe(itineraryFingerprint(b));
  });

  it('differs when segment order differs', () => {
    const seg1 = makeSegment({ operatingFlightNumber: 'AA100', origin: 'JFK', destination: 'LAX' });
    const seg2 = makeSegment({ operatingFlightNumber: 'AA200', origin: 'LAX', destination: 'SFO' });
    expect(itineraryFingerprint([seg1, seg2])).not.toBe(
      itineraryFingerprint([seg2, seg1])
    );
  });
});

function makeBatch(offers: NormalizedOfferBatch['offers']): NormalizedOfferBatch {
  return {
    providerId: 'demo',
    query: {
      origin: 'JFK',
      destination: 'LAX',
      mode: 'EXACT',
      departureDate: '2026-09-01',
      tripType: 'ONE_WAY',
      cabin: 'ECONOMY',
      adults: 1,
      maxStops: 2,
      currency: 'USD',
    },
    retrievedAt: Date.parse('2026-07-17T00:00:00Z'),
    offers,
    warnings: [],
  };
}

describe('normalizeAndValidate', () => {
  it('accepts a well-formed offer', () => {
    const batch = makeBatch([makeOffer()]);
    const result = normalizeAndValidate(batch);
    expect(result.valid).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it('rejects a nonpositive price', () => {
    const batch = makeBatch([makeOffer({ totalPriceMinor: 0 })]);
    const result = normalizeAndValidate(batch);
    expect(result.valid).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reasons.join(' ')).toMatch(/positive/);
  });

  it('rejects a negative price', () => {
    const batch = makeBatch([makeOffer({ totalPriceMinor: -500 })]);
    const result = normalizeAndValidate(batch);
    expect(result.rejected).toHaveLength(1);
  });

  it('rejects an offer with no segments', () => {
    const batch = makeBatch([makeOffer({ segments: [] })]);
    const result = normalizeAndValidate(batch);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reasons.join(' ')).toMatch(/missing segments/);
  });

  it('rejects an offer whose arrival is before its departure', () => {
    const batch = makeBatch([
      makeOffer({
        segments: [
          makeSegment({
            departureAt: '2026-09-01T11:00:00Z',
            arrivalAt: '2026-09-01T08:00:00Z',
          }),
        ],
      }),
    ]);
    const result = normalizeAndValidate(batch);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reasons.join(' ')).toMatch(/arrival is before departure/);
  });

  it('rejects an offer whose currency does not match the query currency', () => {
    const batch = makeBatch([makeOffer({ currency: 'EUR' })]);
    const result = normalizeAndValidate(batch);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reasons.join(' ')).toMatch(/currency mismatch/);
  });

  it('collects multiple reasons for a doubly-invalid offer', () => {
    const batch = makeBatch([
      makeOffer({ totalPriceMinor: -1, segments: [] }),
    ]);
    const result = normalizeAndValidate(batch);
    expect(result.rejected[0].reasons.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps valid offers alongside rejected ones in the same batch', () => {
    const batch = makeBatch([
      makeOffer({ providerOfferId: 'ok' }),
      makeOffer({ providerOfferId: 'bad', totalPriceMinor: 0 }),
    ]);
    const result = normalizeAndValidate(batch);
    expect(result.valid).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.valid[0].providerOfferId).toBe('ok');
  });
});

describe('dedupeOffers', () => {
  it('collapses identical fingerprint+price+fareBrand, keeping the freshest observedAt', () => {
    const older = makeOffer({
      providerOfferId: 'older',
      observedAt: 1000,
      marketingCarriers: ['AA'],
    });
    const newer = makeOffer({
      providerOfferId: 'newer',
      observedAt: 2000,
      marketingCarriers: ['AA', 'BA'],
    });
    const result = dedupeOffers([older, newer]);
    expect(result).toHaveLength(1);
    expect(result[0].providerOfferId).toBe('newer');
    expect(result[0].observedAt).toBe(2000);
  });

  it('merges marketingCarriers (union) across the collapsed group', () => {
    const a = makeOffer({ observedAt: 1000, marketingCarriers: ['AA'] });
    const b = makeOffer({ observedAt: 2000, marketingCarriers: ['BA'] });
    const result = dedupeOffers([a, b]);
    expect(result).toHaveLength(1);
    expect(new Set(result[0].marketingCarriers)).toEqual(new Set(['AA', 'BA']));
  });

  it('does NOT collapse offers with different fareBrand, even with identical fingerprint+price', () => {
    const basic = makeOffer({ fareBrand: 'BASIC' });
    const flex = makeOffer({ fareBrand: 'FLEX' });
    const result = dedupeOffers([basic, flex]);
    expect(result).toHaveLength(2);
  });

  it('does not collapse offers with different prices', () => {
    const cheap = makeOffer({ totalPriceMinor: 30000 });
    const expensive = makeOffer({ totalPriceMinor: 35000 });
    const result = dedupeOffers([cheap, expensive]);
    expect(result).toHaveLength(2);
  });

  it('leaves a single offer untouched', () => {
    const offer = makeOffer();
    const result = dedupeOffers([offer]);
    expect(result).toEqual([offer]);
  });
});

describe('flagAnomalies', () => {
  it('flags an offer priced far below the median with no corroborating second offer', () => {
    const offers = [
      makeOffer({ providerOfferId: 'a', totalPriceMinor: 30000 }),
      makeOffer({ providerOfferId: 'b', totalPriceMinor: 31000 }),
      makeOffer({ providerOfferId: 'c', totalPriceMinor: 29000 }),
      makeOffer({ providerOfferId: 'd', totalPriceMinor: 32000 }),
      makeOffer({ providerOfferId: 'anomaly', totalPriceMinor: 5000 }),
    ];
    const result = flagAnomalies(offers);
    const anomaly = result.find((o) => o.providerOfferId === 'anomaly');
    expect(anomaly?.qualityFlags).toContain('SUSPECTED_ANOMALY');
    // Others untouched.
    expect(result.find((o) => o.providerOfferId === 'a')?.qualityFlags).not.toContain(
      'SUSPECTED_ANOMALY'
    );
  });

  it('does NOT flag a low price that has a corroborating second offer within the window', () => {
    const offers = [
      makeOffer({ providerOfferId: 'a', totalPriceMinor: 30000 }),
      makeOffer({ providerOfferId: 'b', totalPriceMinor: 31000 }),
      makeOffer({ providerOfferId: 'c', totalPriceMinor: 29000 }),
      makeOffer({ providerOfferId: 'd', totalPriceMinor: 32000 }),
      makeOffer({ providerOfferId: 'low1', totalPriceMinor: 5000 }),
      makeOffer({ providerOfferId: 'low2', totalPriceMinor: 5200 }),
    ];
    const result = flagAnomalies(offers);
    expect(result.find((o) => o.providerOfferId === 'low1')?.qualityFlags).not.toContain(
      'SUSPECTED_ANOMALY'
    );
    expect(result.find((o) => o.providerOfferId === 'low2')?.qualityFlags).not.toContain(
      'SUSPECTED_ANOMALY'
    );
  });

  it('does not flag anything when all prices are close together', () => {
    const offers = [
      makeOffer({ totalPriceMinor: 30000 }),
      makeOffer({ totalPriceMinor: 30500 }),
      makeOffer({ totalPriceMinor: 29500 }),
    ];
    const result = flagAnomalies(offers);
    expect(result.some((o) => o.qualityFlags.includes('SUSPECTED_ANOMALY'))).toBe(
      false
    );
  });

  it('does not mutate the input offers', () => {
    const offers = [
      makeOffer({ providerOfferId: 'a', totalPriceMinor: 30000 }),
      makeOffer({ providerOfferId: 'b', totalPriceMinor: 31000 }),
      makeOffer({ providerOfferId: 'c', totalPriceMinor: 29000 }),
      makeOffer({ providerOfferId: 'anomaly', totalPriceMinor: 5000 }),
    ];
    const before = offers.map((o) => o.qualityFlags.length);
    flagAnomalies(offers);
    expect(offers.map((o) => o.qualityFlags.length)).toEqual(before);
  });

  it('returns an empty array for an empty batch', () => {
    expect(flagAnomalies([])).toEqual([]);
  });
});
