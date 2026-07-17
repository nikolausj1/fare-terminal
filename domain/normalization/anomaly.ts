// Flags suspiciously cheap offers so the snapshot engine can exclude them
// from the benchmark instead of letting a single mis-priced fare skew it.

import { config } from '@/domain/config';
import type { NormalizedOffer } from '@/domain/types';

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Marks offers as SUSPECTED_ANOMALY (appended to qualityFlags, returned as
 * new objects — inputs are never mutated) when:
 *  - the offer is priced at least config.normalization.anomalyBelowMedianPct
 *    percent below the batch median, AND
 *  - no other offer in the batch is within
 *    config.normalization.anomalySecondOfferWindowPct percent of its price
 *    (i.e. nothing corroborates that the low price is real).
 *
 * Offers that already carry the flag, or don't meet the "far below median"
 * bar, or do have a corroborating second offer, are returned unchanged.
 */
export function flagAnomalies(offers: NormalizedOffer[]): NormalizedOffer[] {
  if (offers.length === 0) return [];

  const batchMedian = median(offers.map((offer) => offer.totalPriceMinor));
  const anomalyCeiling =
    batchMedian * (1 - config.normalization.anomalyBelowMedianPct / 100);

  return offers.map((offer, index) => {
    const isFarBelowMedian = offer.totalPriceMinor <= anomalyCeiling;
    if (!isFarBelowMedian) return offer;

    const hasCorroboration = offers.some((other, otherIndex) => {
      if (otherIndex === index) return false;
      const diffPct =
        (Math.abs(other.totalPriceMinor - offer.totalPriceMinor) /
          offer.totalPriceMinor) *
        100;
      return diffPct <= config.normalization.anomalySecondOfferWindowPct;
    });

    if (hasCorroboration) return offer;
    if (offer.qualityFlags.includes('SUSPECTED_ANOMALY')) return offer;

    return {
      ...offer,
      qualityFlags: [...offer.qualityFlags, 'SUSPECTED_ANOMALY'],
    };
  });
}
