// Aggregates a batch of normalized offers for one search definition into
// SnapshotMetrics. Pure: takes `now` explicitly rather than reading the
// clock.

import { config } from '@/domain/config';
import { itineraryFingerprint } from '@/domain/normalization/fingerprint';
import type { NormalizedOffer, SnapshotMetrics } from '@/domain/types';

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// Linear-interpolation percentile (matches the common "R-7" method): rank
// falls between two sorted values and we interpolate proportionally.
function percentile(sortedAscending: number[], p: number): number {
  if (sortedAscending.length === 0) return 0;
  if (sortedAscending.length === 1) return sortedAscending[0];
  const rank = (p / 100) * (sortedAscending.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  if (lowerIndex === upperIndex) return sortedAscending[lowerIndex];
  const weight = rank - lowerIndex;
  return (
    sortedAscending[lowerIndex] +
    (sortedAscending[upperIndex] - sortedAscending[lowerIndex]) * weight
  );
}

function isExpired(offer: NormalizedOffer, now: number): boolean {
  return offer.expiresAt !== undefined && offer.expiresAt < now;
}

function isAnomalous(offer: NormalizedOffer): boolean {
  return offer.qualityFlags.includes('SUSPECTED_ANOMALY');
}

/**
 * Aggregates a (deduped) batch of offers into SnapshotMetrics.
 *
 * `offers` is expected to be the full deduped set for the window, including
 * any expired or SUSPECTED_ANOMALY offers — this function does the
 * filtering itself so it can factor exclusions into the data-quality score.
 *
 * Metric definitions:
 *  - "valid" offers = not expired (expiresAt < now) and not flagged
 *    SUSPECTED_ANOMALY. Every metric below except dataQualityScore is
 *    computed only over valid offers.
 *  - benchmarkPriceMinor = median of the config.benchmark.lowOfferSetSize
 *    (5) cheapest valid offers; if fewer than that many valid offers exist,
 *    it's the median of however many are available (the small sample is
 *    reflected in dataQualityScore via the offer-count component below,
 *    not by refusing to compute a benchmark).
 *  - fromPriceMinor = the single cheapest valid offer.
 *  - medianPriceMinor / p25PriceMinor = median / 25th percentile (linear
 *    interpolation) over ALL valid offers' prices.
 *  - uniqueItineraryCount = distinct itineraryFingerprint values among
 *    valid offers.
 *  - carrierCount = distinct validatingCarrier values among valid offers.
 *  - freshnessSeconds = now - max(observedAt) among valid offers, in whole
 *    seconds (0 when there are no valid offers).
 *
 * dataQualityScore (0..1) is the unweighted average of three independently
 * clamped [0,1] components, so no single factor can push it outside [0,1]:
 *   1. offerCount component  = min(1, validOfferCount / minOffersForFullQuality)
 *   2. freshness component   = clamp(1 - freshnessSeconds / (staleAfterMinutes*60), 0, 1)
 *   3. cleanliness component = 1 - (expired + anomalous offers) / total input offers
 * A snapshot with plenty of fresh, clean offers scores near 1; a snapshot
 * built from a handful of stale or anomaly-heavy offers scores low.
 */
export function computeSnapshotMetrics(
  offers: NormalizedOffer[],
  now: number
): SnapshotMetrics {
  const totalInput = offers.length;
  const excludedCount = offers.filter(
    (offer) => isExpired(offer, now) || isAnomalous(offer)
  ).length;

  const validOffers = offers
    .filter((offer) => !isExpired(offer, now) && !isAnomalous(offer))
    .slice()
    .sort((a, b) => a.totalPriceMinor - b.totalPriceMinor);

  if (validOffers.length === 0) {
    return {
      benchmarkPriceMinor: 0,
      fromPriceMinor: 0,
      medianPriceMinor: 0,
      p25PriceMinor: 0,
      validOfferCount: 0,
      uniqueItineraryCount: 0,
      carrierCount: 0,
      nonstopOfferCount: 0,
      oneStopOfferCount: 0,
      freshnessSeconds: 0,
      dataQualityScore: 0,
    };
  }

  const prices = validOffers.map((offer) => offer.totalPriceMinor);
  const lowSetSize = Math.min(config.benchmark.lowOfferSetSize, prices.length);
  const benchmarkPriceMinor = Math.round(median(prices.slice(0, lowSetSize)));
  const fromPriceMinor = prices[0];
  const medianPriceMinor = Math.round(median(prices));
  const p25PriceMinor = Math.round(percentile(prices, 25));

  const uniqueItineraryCount = new Set(
    validOffers.map((offer) => itineraryFingerprint(offer.segments))
  ).size;
  const carrierCount = new Set(
    validOffers.map((offer) => offer.validatingCarrier)
  ).size;
  const nonstopOfferCount = validOffers.filter(
    (offer) => offer.stopCount === 0
  ).length;
  const oneStopOfferCount = validOffers.filter(
    (offer) => offer.stopCount === 1
  ).length;

  const maxObservedAt = Math.max(
    ...validOffers.map((offer) => offer.observedAt)
  );
  const freshnessSeconds = Math.max(0, Math.round((now - maxObservedAt) / 1000));

  const offerCountComponent = Math.min(
    1,
    validOffers.length / config.benchmark.minOffersForFullQuality
  );
  const freshnessComponent = Math.max(
    0,
    Math.min(
      1,
      1 - freshnessSeconds / (config.freshness.staleAfterMinutes * 60)
    )
  );
  const cleanlinessComponent =
    totalInput === 0 ? 1 : 1 - excludedCount / totalInput;

  const dataQualityScore = Math.max(
    0,
    Math.min(
      1,
      (offerCountComponent + freshnessComponent + cleanlinessComponent) / 3
    )
  );

  return {
    benchmarkPriceMinor,
    fromPriceMinor,
    medianPriceMinor,
    p25PriceMinor,
    validOfferCount: validOffers.length,
    uniqueItineraryCount,
    carrierCount,
    nonstopOfferCount,
    oneStopOfferCount,
    freshnessSeconds,
    dataQualityScore,
  };
}
