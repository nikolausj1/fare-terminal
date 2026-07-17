// Shared test fixtures for WP3 domain-engine unit tests.

import type { NormalizedOffer, Segment } from '@/domain/types';

export function makeSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    operatingFlightNumber: 'AA100',
    marketingFlightNumber: 'AA100',
    origin: 'JFK',
    destination: 'LAX',
    departureAt: '2026-09-01T08:00:00Z',
    arrivalAt: '2026-09-01T11:00:00Z',
    cabin: 'ECONOMY',
    ...overrides,
  };
}

let offerCounter = 0;

export function makeOffer(overrides: Partial<NormalizedOffer> = {}): NormalizedOffer {
  offerCounter += 1;
  return {
    providerId: 'demo',
    providerOfferId: `offer-${offerCounter}`,
    observedAt: Date.parse('2026-07-17T00:00:00Z'),
    expiresAt: undefined,
    currency: 'USD',
    totalPriceMinor: 30000,
    basePriceMinor: 25000,
    taxesMinor: 5000,
    optionalFeesKnown: true,
    validatingCarrier: 'AA',
    marketingCarriers: ['AA'],
    operatingCarriers: ['AA'],
    segments: [makeSegment()],
    durationMinutes: 300,
    stopCount: 0,
    cabin: 'ECONOMY',
    fareBrand: 'BASIC',
    bookingClasses: ['Y'],
    seatsRemaining: 9,
    outboundUrl: undefined,
    qualityFlags: [],
    ...overrides,
  };
}
