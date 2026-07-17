import { describe, expect, it } from 'vitest';
import { computeSnapshotMetrics } from '@/domain/snapshots/computeSnapshotMetrics';
import { makeOffer } from './fixtures';

const NOW = Date.parse('2026-07-17T12:00:00Z');

describe('computeSnapshotMetrics', () => {
  it('computes the benchmark as the median of the 5 cheapest offers when >=5 are available', () => {
    const prices = [10000, 12000, 11000, 13000, 14000, 20000, 21000];
    const offers = prices.map((p, i) =>
      makeOffer({ providerOfferId: `o${i}`, totalPriceMinor: p, observedAt: NOW })
    );
    const metrics = computeSnapshotMetrics(offers, NOW);
    // 5 cheapest: 10000,11000,12000,13000,14000 -> median 12000
    expect(metrics.benchmarkPriceMinor).toBe(12000);
    expect(metrics.fromPriceMinor).toBe(10000);
    expect(metrics.validOfferCount).toBe(7);
  });

  it('uses the median of whatever is available when fewer than 5 offers exist, and reflects that in dataQualityScore', () => {
    const prices = [10000, 12000, 11000];
    const offers = prices.map((p, i) =>
      makeOffer({ providerOfferId: `o${i}`, totalPriceMinor: p, observedAt: NOW })
    );
    const metrics = computeSnapshotMetrics(offers, NOW);
    expect(metrics.benchmarkPriceMinor).toBe(11000); // median of 3
    expect(metrics.validOfferCount).toBe(3);

    const fullOffers = [
      ...offers,
      ...[13000, 14000, 15000, 16000, 17000].map((p, i) =>
        makeOffer({ providerOfferId: `f${i}`, totalPriceMinor: p, observedAt: NOW })
      ),
    ];
    const fullMetrics = computeSnapshotMetrics(fullOffers, NOW);
    expect(fullMetrics.dataQualityScore).toBeGreaterThan(metrics.dataQualityScore);
  });

  it('excludes expired offers from every metric', () => {
    const fresh = makeOffer({
      providerOfferId: 'fresh',
      totalPriceMinor: 10000,
      observedAt: NOW,
      expiresAt: NOW + 60_000,
    });
    const expired = makeOffer({
      providerOfferId: 'expired',
      totalPriceMinor: 1,
      observedAt: NOW,
      expiresAt: NOW - 60_000,
    });
    const metrics = computeSnapshotMetrics([fresh, expired], NOW);
    expect(metrics.validOfferCount).toBe(1);
    expect(metrics.fromPriceMinor).toBe(10000);
  });

  it('excludes SUSPECTED_ANOMALY offers from the benchmark', () => {
    const normal = makeOffer({
      providerOfferId: 'normal',
      totalPriceMinor: 10000,
      observedAt: NOW,
    });
    const anomaly = makeOffer({
      providerOfferId: 'anomaly',
      totalPriceMinor: 1,
      observedAt: NOW,
      qualityFlags: ['SUSPECTED_ANOMALY'],
    });
    const metrics = computeSnapshotMetrics([normal, anomaly], NOW);
    expect(metrics.validOfferCount).toBe(1);
    expect(metrics.fromPriceMinor).toBe(10000);
  });

  it('handles duplicate prices correctly in the median/benchmark calc', () => {
    const prices = [10000, 10000, 10000, 10000, 10000];
    const offers = prices.map((p, i) =>
      makeOffer({ providerOfferId: `o${i}`, totalPriceMinor: p, observedAt: NOW })
    );
    const metrics = computeSnapshotMetrics(offers, NOW);
    expect(metrics.benchmarkPriceMinor).toBe(10000);
    expect(metrics.medianPriceMinor).toBe(10000);
  });

  it('returns all-zero metrics with dataQualityScore 0 when there are no valid offers', () => {
    const metrics = computeSnapshotMetrics([], NOW);
    expect(metrics.validOfferCount).toBe(0);
    expect(metrics.benchmarkPriceMinor).toBe(0);
    expect(metrics.dataQualityScore).toBe(0);
  });

  it('counts unique itineraries, carriers, nonstop and one-stop offers', () => {
    const offers = [
      makeOffer({ providerOfferId: 'a', validatingCarrier: 'AA', stopCount: 0, observedAt: NOW }),
      makeOffer({
        providerOfferId: 'b',
        validatingCarrier: 'BA',
        stopCount: 1,
        observedAt: NOW,
        segments: [
          {
            operatingFlightNumber: 'BA200',
            origin: 'JFK',
            destination: 'LHR',
            departureAt: '2026-09-01T09:00:00Z',
            arrivalAt: '2026-09-01T21:00:00Z',
            cabin: 'ECONOMY',
          },
        ],
      }),
      makeOffer({
        providerOfferId: 'c',
        validatingCarrier: 'AA',
        stopCount: 2,
        observedAt: NOW,
        segments: [
          {
            operatingFlightNumber: 'AA999',
            origin: 'JFK',
            destination: 'ORD',
            departureAt: '2026-09-01T08:00:00Z',
            arrivalAt: '2026-09-01T10:00:00Z',
            cabin: 'ECONOMY',
          },
        ],
      }),
    ];
    const metrics = computeSnapshotMetrics(offers, NOW);
    expect(metrics.carrierCount).toBe(2);
    expect(metrics.nonstopOfferCount).toBe(1);
    expect(metrics.oneStopOfferCount).toBe(1);
    expect(metrics.uniqueItineraryCount).toBe(3);
  });

  it('computes freshnessSeconds from the most recently observed valid offer', () => {
    const offers = [
      makeOffer({ providerOfferId: 'a', observedAt: NOW - 3600_000 }),
      makeOffer({ providerOfferId: 'b', observedAt: NOW - 60_000 }),
    ];
    const metrics = computeSnapshotMetrics(offers, NOW);
    expect(metrics.freshnessSeconds).toBe(60);
  });
});
