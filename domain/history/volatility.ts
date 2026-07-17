import { median, medianAbsoluteDeviation } from './stats';

/**
 * Robust dispersion measure: median absolute deviation expressed as a
 * percentage of the median. Less sensitive to a single outlier spike than
 * stddev/mean would be. Returns 0 for fewer than 2 points or a zero
 * median (nothing to divide by).
 */
export function volatility(history: number[]): number {
  if (history.length < 2) return 0;
  const center = median(history);
  if (center === 0) return 0;
  const mad = medianAbsoluteDeviation(history, center);
  return (mad / center) * 100;
}
