/**
 * "Cheaper than X% of history": the percentage of historical values that
 * are strictly HIGHER than currentBenchmark.
 *
 *   percentile = (count of history values > currentBenchmark) / history.length * 100
 *
 * 100 means every historical price this market has seen was higher than
 * today's (today is as cheap as it's ever been); 0 means nothing in history
 * was more expensive than today. Ties (a history value exactly equal to
 * currentBenchmark) count toward neither side. Returns 0 for an empty
 * history (nothing to compare against).
 *
 * Note for callers: this is the complement of the standard "percentile
 * rank" used by config.percentileToHistoricalValue in
 * domain/recommendations — see that module for the conversion.
 */
export function historicalPercentile(
  currentBenchmark: number,
  history: number[]
): number {
  if (history.length === 0) return 0;
  const higherCount = history.filter((value) => value > currentBenchmark).length;
  return (higherCount / history.length) * 100;
}
