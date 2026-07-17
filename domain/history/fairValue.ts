import { config } from '@/domain/config';
import { median, medianAbsoluteDeviation } from './stats';

export interface FairValueRange {
  low: number;
  high: number;
  center: number;
}

/**
 * Robust "fair value" band computed from historical benchmark prices.
 *
 * - center = median(history)
 * - half-width = config.history.fairValueMadK * 1.4826 * MAD, where 1.4826
 *   is the standard scale factor that makes MAD a consistent estimator of
 *   the standard deviation for normally-distributed data, and
 *   fairValueMadK widens/narrows the resulting band.
 * - low = center - half-width, high = center + half-width.
 *
 * Returns null when there isn't enough history to trust the estimate
 * (fewer than config.history.minHistoryForFairValue points).
 */
export function fairValueRange(history: number[]): FairValueRange | null {
  if (history.length < config.history.minHistoryForFairValue) return null;

  const center = median(history);
  const mad = medianAbsoluteDeviation(history, center);
  const halfWidth = config.history.fairValueMadK * 1.4826 * mad;

  return {
    low: center - halfWidth,
    high: center + halfWidth,
    center,
  };
}
