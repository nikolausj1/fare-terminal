import { describe, expect, it } from 'vitest';
import { detectEvents, type SnapshotWithTime } from '@/domain/events/detectEvents';
import { config } from '@/domain/config';
import { makeOffer, makeSegment } from './fixtures';
import type { NormalizedOffer } from '@/domain/types';

const NOW = Date.parse('2026-07-17T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function snapshot(overrides: Partial<SnapshotWithTime>): SnapshotWithTime {
  return {
    benchmarkPriceMinor: 30000,
    fromPriceMinor: 28000,
    medianPriceMinor: 30500,
    p25PriceMinor: 29000,
    validOfferCount: 10,
    uniqueItineraryCount: 8,
    carrierCount: 3,
    nonstopOfferCount: 4,
    oneStopOfferCount: 4,
    freshnessSeconds: 300,
    dataQualityScore: 0.9,
    snapshotAt: NOW,
    ...overrides,
  };
}

function offersAtCarrier(
  carrier: string,
  price: number,
  n: number,
  suffix = ''
): NormalizedOffer[] {
  return Array.from({ length: n }, (_, i) =>
    makeOffer({
      providerOfferId: `${carrier}-${suffix}-${i}`,
      validatingCarrier: carrier,
      totalPriceMinor: price + i * 100,
      observedAt: NOW,
      segments: [
        makeSegment({ operatingFlightNumber: `${carrier}${100 + i}${suffix}` }),
      ],
    })
  );
}

function baseInput(overrides: Partial<Parameters<typeof detectEvents>[0]> = {}) {
  return {
    searchDefinitionId: 1,
    current: snapshot({}),
    previous: null,
    history: [],
    currentOffers: [],
    previousOffers: [],
    now: NOW,
    ...overrides,
  };
}

describe('detectEvents: PRICE_DROP / PRICE_INCREASE', () => {
  it('fires PRICE_DROP when the pct drop meets the threshold', () => {
    const previous = snapshot({ benchmarkPriceMinor: 30000, snapshotAt: NOW - DAY_MS });
    const current = snapshot({
      benchmarkPriceMinor: Math.round(30000 * (1 - config.eventThresholds.priceDropPct / 100)),
    });
    const events = detectEvents(baseInput({ current, previous }));
    expect(events.some((e) => e.eventType === 'PRICE_DROP')).toBe(true);
  });

  it('does NOT fire just below both the pct and abs thresholds', () => {
    // At this scale, a 7% drop is both under the 8% pct threshold and
    // under the 4000-minor abs threshold (2100 minor).
    const previous = snapshot({ benchmarkPriceMinor: 30000, snapshotAt: NOW - DAY_MS });
    const current = snapshot({ benchmarkPriceMinor: 27900 }); // -7%, -2100 minor
    const events = detectEvents(baseInput({ current, previous }));
    expect(events.some((e) => e.eventType === 'PRICE_DROP')).toBe(false);
  });

  it('fires PRICE_INCREASE symmetrically', () => {
    const previous = snapshot({ benchmarkPriceMinor: 30000, snapshotAt: NOW - DAY_MS });
    const current = snapshot({
      benchmarkPriceMinor: Math.round(30000 * (1 + config.eventThresholds.priceDropPct / 100)),
    });
    const events = detectEvents(baseInput({ current, previous }));
    expect(events.some((e) => e.eventType === 'PRICE_INCREASE')).toBe(true);
  });

  it('does not fire without a previous snapshot', () => {
    const current = snapshot({ benchmarkPriceMinor: 1000 });
    const events = detectEvents(baseInput({ current, previous: null }));
    expect(events.some((e) => e.eventType === 'PRICE_DROP')).toBe(false);
  });
});

describe('detectEvents: NEW_HISTORICAL_LOW', () => {
  it('fires when current benchmark is below every historical value', () => {
    const history = [
      snapshot({ benchmarkPriceMinor: 30000, snapshotAt: NOW - 5 * DAY_MS }),
      snapshot({ benchmarkPriceMinor: 28000, snapshotAt: NOW - 4 * DAY_MS }),
    ];
    const current = snapshot({ benchmarkPriceMinor: 25000 });
    const events = detectEvents(
      baseInput({ current, previous: history[1], history })
    );
    expect(events.some((e) => e.eventType === 'NEW_HISTORICAL_LOW')).toBe(true);
  });

  it('does NOT fire when current is not below the historical minimum', () => {
    const history = [
      snapshot({ benchmarkPriceMinor: 30000, snapshotAt: NOW - 5 * DAY_MS }),
      snapshot({ benchmarkPriceMinor: 28000, snapshotAt: NOW - 4 * DAY_MS }),
    ];
    const current = snapshot({ benchmarkPriceMinor: 28500 });
    const events = detectEvents(
      baseInput({ current, previous: history[1], history })
    );
    expect(events.some((e) => e.eventType === 'NEW_HISTORICAL_LOW')).toBe(false);
  });

  it('does not fire with no history at all', () => {
    const current = snapshot({ benchmarkPriceMinor: 1 });
    const events = detectEvents(baseInput({ current, previous: null, history: [] }));
    expect(events.some((e) => e.eventType === 'NEW_HISTORICAL_LOW')).toBe(false);
  });
});

describe('detectEvents: VOLATILITY_SPIKE', () => {
  const stableHistory = [30000, 30100, 29900, 30050, 29950].map((p, i) =>
    snapshot({ benchmarkPriceMinor: p, snapshotAt: NOW - (10 - i) * DAY_MS })
  );

  it('fires when current deviates far beyond typical MAD from recent history', () => {
    const current = snapshot({ benchmarkPriceMinor: 45000 });
    const events = detectEvents(
      baseInput({ current, previous: stableHistory[4], history: stableHistory })
    );
    expect(events.some((e) => e.eventType === 'VOLATILITY_SPIKE')).toBe(true);
  });

  it('does NOT fire for a current value close to the recent median', () => {
    const current = snapshot({ benchmarkPriceMinor: 30020 });
    const events = detectEvents(
      baseInput({ current, previous: stableHistory[4], history: stableHistory })
    );
    expect(events.some((e) => e.eventType === 'VOLATILITY_SPIKE')).toBe(false);
  });

  it('does not fire with fewer than 5 historical points', () => {
    const current = snapshot({ benchmarkPriceMinor: 90000 });
    const events = detectEvents(
      baseInput({ current, previous: stableHistory[0], history: stableHistory.slice(0, 3) })
    );
    expect(events.some((e) => e.eventType === 'VOLATILITY_SPIKE')).toBe(false);
  });
});

describe('detectEvents: OFFER_COUNT_SURGE / CONTRACTION', () => {
  it('fires OFFER_COUNT_SURGE when the increase meets the threshold', () => {
    const previous = snapshot({ validOfferCount: 10, snapshotAt: NOW - DAY_MS });
    const current = snapshot({ validOfferCount: 14 }); // +40%
    const events = detectEvents(baseInput({ current, previous }));
    expect(events.some((e) => e.eventType === 'OFFER_COUNT_SURGE')).toBe(true);
  });

  it('does NOT fire just below the surge threshold', () => {
    const previous = snapshot({ validOfferCount: 10, snapshotAt: NOW - DAY_MS });
    const current = snapshot({ validOfferCount: 13 }); // +30%
    const events = detectEvents(baseInput({ current, previous }));
    expect(events.some((e) => e.eventType === 'OFFER_COUNT_SURGE')).toBe(false);
  });

  it('fires OFFER_COUNT_CONTRACTION when the decrease meets the threshold', () => {
    const previous = snapshot({ validOfferCount: 10, snapshotAt: NOW - DAY_MS });
    const current = snapshot({ validOfferCount: 6 }); // -40%
    const events = detectEvents(baseInput({ current, previous }));
    expect(events.some((e) => e.eventType === 'OFFER_COUNT_CONTRACTION')).toBe(true);
  });

  it('does NOT fire just below the contraction threshold', () => {
    const previous = snapshot({ validOfferCount: 10, snapshotAt: NOW - DAY_MS });
    const current = snapshot({ validOfferCount: 7 }); // -30%
    const events = detectEvents(baseInput({ current, previous }));
    expect(events.some((e) => e.eventType === 'OFFER_COUNT_CONTRACTION')).toBe(false);
  });
});

describe('detectEvents: LOW_FARE_SET_CHANGED', () => {
  it('fires when >= 3 of the 5 lowest-price itineraries are replaced', () => {
    const previousOffers = Array.from({ length: 5 }, (_, i) =>
      makeOffer({
        providerOfferId: `prev-${i}`,
        totalPriceMinor: 10000 + i * 100,
        observedAt: NOW - DAY_MS,
        segments: [makeSegment({ operatingFlightNumber: `AA${100 + i}` })],
      })
    );
    // Replace 3 of the 5 with different itineraries at similarly low prices.
    const currentOffers = [
      ...previousOffers.slice(0, 2),
      ...Array.from({ length: 3 }, (_, i) =>
        makeOffer({
          providerOfferId: `cur-${i}`,
          totalPriceMinor: 10000 + i * 100,
          observedAt: NOW,
          segments: [makeSegment({ operatingFlightNumber: `BB${200 + i}` })],
        })
      ),
    ];
    const previous = snapshot({ snapshotAt: NOW - DAY_MS });
    const current = snapshot({});
    const events = detectEvents(
      baseInput({ current, previous, currentOffers, previousOffers })
    );
    expect(events.some((e) => e.eventType === 'LOW_FARE_SET_CHANGED')).toBe(true);
  });

  it('does NOT fire when only 2 of the 5 lowest change', () => {
    const previousOffers = Array.from({ length: 5 }, (_, i) =>
      makeOffer({
        providerOfferId: `prev-${i}`,
        totalPriceMinor: 10000 + i * 100,
        observedAt: NOW - DAY_MS,
        segments: [makeSegment({ operatingFlightNumber: `AA${100 + i}` })],
      })
    );
    const currentOffers = [
      ...previousOffers.slice(0, 3),
      ...Array.from({ length: 2 }, (_, i) =>
        makeOffer({
          providerOfferId: `cur-${i}`,
          totalPriceMinor: 10000 + i * 100,
          observedAt: NOW,
          segments: [makeSegment({ operatingFlightNumber: `BB${200 + i}` })],
        })
      ),
    ];
    const previous = snapshot({ snapshotAt: NOW - DAY_MS });
    const current = snapshot({});
    const events = detectEvents(
      baseInput({ current, previous, currentOffers, previousOffers })
    );
    expect(events.some((e) => e.eventType === 'LOW_FARE_SET_CHANGED')).toBe(false);
  });
});

describe('detectEvents: CARRIER_ENTERED_LOW_SET / CARRIER_LEFT_LOW_SET', () => {
  it('fires CARRIER_ENTERED_LOW_SET and CARRIER_LEFT_LOW_SET when the carrier mix of the low set changes', () => {
    const previousOffers = offersAtCarrier('AA', 10000, 5, 'p');
    const currentOffers = [
      ...offersAtCarrier('AA', 10000, 3, 'c'),
      ...offersAtCarrier('BB', 10050, 2, 'c'),
    ];
    const previous = snapshot({ snapshotAt: NOW - DAY_MS });
    const current = snapshot({});
    const events = detectEvents(
      baseInput({ current, previous, currentOffers, previousOffers })
    );
    expect(events.some((e) => e.eventType === 'CARRIER_ENTERED_LOW_SET')).toBe(true);
  });

  it('does not fire either when the carrier mix is unchanged', () => {
    const previousOffers = offersAtCarrier('AA', 10000, 5, 'p');
    const currentOffers = offersAtCarrier('AA', 10000, 5, 'c');
    const previous = snapshot({ snapshotAt: NOW - DAY_MS });
    const current = snapshot({});
    const events = detectEvents(
      baseInput({ current, previous, currentOffers, previousOffers })
    );
    expect(events.some((e) => e.eventType === 'CARRIER_ENTERED_LOW_SET')).toBe(false);
    expect(events.some((e) => e.eventType === 'CARRIER_LEFT_LOW_SET')).toBe(false);
  });
});

describe('detectEvents: POSSIBLE_CARRIER_MATCH', () => {
  it('fires with "consistent with" wording and LOW/MODERATE confidence when two carriers move together within the window', () => {
    const dropPct = config.eventThresholds.priceDropPct; // 8
    const previousOffers = [
      ...offersAtCarrier('AA', 10000, 1, 'p'),
      ...offersAtCarrier('BB', 12000, 1, 'p'),
    ];
    const currentOffers = [
      ...offersAtCarrier('AA', Math.round(10000 * (1 - dropPct / 200 - 0.02)), 1, 'c'),
      ...offersAtCarrier('BB', Math.round(12000 * (1 - dropPct / 200 - 0.02)), 1, 'c'),
    ];
    const previous = snapshot({ snapshotAt: NOW - 2 * 60 * 60 * 1000 }); // 2h before
    const current = snapshot({});
    const events = detectEvents(
      baseInput({ current, previous, currentOffers, previousOffers })
    );
    const match = events.find((e) => e.eventType === 'POSSIBLE_CARRIER_MATCH');
    expect(match).toBeDefined();
    expect(match?.inference?.text).toMatch(/consistent with/i);
    expect(match?.inference?.text).not.toMatch(/\bmatched\b/i);
    expect(['LOW', 'MODERATE']).toContain(match?.inference?.confidence);
  });

  it('does not fire outside the carrier-match time window', () => {
    const dropPct = config.eventThresholds.priceDropPct;
    const previousOffers = [
      ...offersAtCarrier('AA', 10000, 1, 'p'),
      ...offersAtCarrier('BB', 12000, 1, 'p'),
    ];
    const currentOffers = [
      ...offersAtCarrier('AA', Math.round(10000 * (1 - dropPct / 100)), 1, 'c'),
      ...offersAtCarrier('BB', Math.round(12000 * (1 - dropPct / 100)), 1, 'c'),
    ];
    const windowHours = config.eventThresholds.carrierMatchWindowHours;
    const previous = snapshot({
      snapshotAt: NOW - (windowHours + 5) * 60 * 60 * 1000,
    });
    const current = snapshot({});
    const events = detectEvents(
      baseInput({ current, previous, currentOffers, previousOffers })
    );
    expect(events.some((e) => e.eventType === 'POSSIBLE_CARRIER_MATCH')).toBe(false);
  });

  it('does not fire when only one carrier moves', () => {
    const previousOffers = [
      ...offersAtCarrier('AA', 10000, 1, 'p'),
      ...offersAtCarrier('BB', 12000, 1, 'p'),
    ];
    const currentOffers = [
      ...offersAtCarrier('AA', 9000, 1, 'c'),
      ...offersAtCarrier('BB', 12000, 1, 'c'),
    ];
    const previous = snapshot({ snapshotAt: NOW - 60 * 60 * 1000 });
    const current = snapshot({});
    const events = detectEvents(
      baseInput({ current, previous, currentOffers, previousOffers })
    );
    expect(events.some((e) => e.eventType === 'POSSIBLE_CARRIER_MATCH')).toBe(false);
  });
});

describe('detectEvents: FARE_PRODUCT_APPEARED / DISAPPEARED', () => {
  it('fires FARE_PRODUCT_APPEARED and FARE_PRODUCT_DISAPPEARED when the low-set fareBrand mix changes', () => {
    const previousOffers = Array.from({ length: 5 }, (_, i) =>
      makeOffer({
        providerOfferId: `prev-${i}`,
        totalPriceMinor: 10000 + i * 10,
        observedAt: NOW - DAY_MS,
        fareBrand: 'BASIC',
        segments: [makeSegment({ operatingFlightNumber: `AA${100 + i}` })],
      })
    );
    const currentOffers = Array.from({ length: 5 }, (_, i) =>
      makeOffer({
        providerOfferId: `cur-${i}`,
        totalPriceMinor: 10000 + i * 10,
        observedAt: NOW,
        fareBrand: 'FLEX',
        segments: [makeSegment({ operatingFlightNumber: `AA${100 + i}` })],
      })
    );
    const previous = snapshot({ snapshotAt: NOW - DAY_MS });
    const current = snapshot({});
    const events = detectEvents(
      baseInput({ current, previous, currentOffers, previousOffers })
    );
    expect(events.some((e) => e.eventType === 'FARE_PRODUCT_APPEARED')).toBe(true);
    expect(events.some((e) => e.eventType === 'FARE_PRODUCT_DISAPPEARED')).toBe(true);
  });

  it('does not fire when the fareBrand mix is unchanged', () => {
    const offers = Array.from({ length: 5 }, (_, i) =>
      makeOffer({
        providerOfferId: `o-${i}`,
        totalPriceMinor: 10000 + i * 10,
        observedAt: NOW,
        fareBrand: 'BASIC',
        segments: [makeSegment({ operatingFlightNumber: `AA${100 + i}` })],
      })
    );
    const previous = snapshot({ snapshotAt: NOW - DAY_MS });
    const current = snapshot({});
    const events = detectEvents(
      baseInput({ current, previous, currentOffers: offers, previousOffers: offers })
    );
    expect(events.some((e) => e.eventType === 'FARE_PRODUCT_APPEARED')).toBe(false);
    expect(events.some((e) => e.eventType === 'FARE_PRODUCT_DISAPPEARED')).toBe(false);
  });
});

describe('detectEvents: DATA_ANOMALY', () => {
  it('fires when the current offers include a SUSPECTED_ANOMALY offer', () => {
    const currentOffers = [
      makeOffer({ qualityFlags: ['SUSPECTED_ANOMALY'] }),
      makeOffer({}),
    ];
    const events = detectEvents(baseInput({ currentOffers }));
    expect(events.some((e) => e.eventType === 'DATA_ANOMALY')).toBe(true);
  });

  it('fires when dataQualityScore is below the configured threshold', () => {
    const current = snapshot({
      dataQualityScore: config.eventThresholds.dataAnomalyQualityThreshold - 0.05,
    });
    const events = detectEvents(baseInput({ current }));
    expect(events.some((e) => e.eventType === 'DATA_ANOMALY')).toBe(true);
  });

  it('does not fire when quality is fine and no anomalies present', () => {
    const current = snapshot({ dataQualityScore: 0.95 });
    const events = detectEvents(baseInput({ current, currentOffers: [makeOffer({})] }));
    expect(events.some((e) => e.eventType === 'DATA_ANOMALY')).toBe(false);
  });
});
