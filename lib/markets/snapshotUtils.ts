// Small shared utilities for working with a chronological series of
// snapshot-like rows ({ snapshotAt, ... }). Used by both the recommendations
// job (momentum7dPct, offer-count deltas) and the read layer (24h/7d change
// in MarketSummaryVM). These are plain data-selection/arithmetic helpers,
// not calibrated domain calculations, so they live here instead of
// domain/history — anything threshold-driven still goes through
// domain/config.ts and the domain/ engines.

export function nearestByTime<T extends { snapshotAt: number }>(
  items: readonly T[],
  targetAt: number,
  toleranceMs?: number
): T | null {
  if (items.length === 0) return null;
  let closest = items[0];
  let closestDiff = Math.abs(closest.snapshotAt - targetAt);
  for (const item of items) {
    const diff = Math.abs(item.snapshotAt - targetAt);
    if (diff < closestDiff) {
      closest = item;
      closestDiff = diff;
    }
  }
  if (toleranceMs !== undefined && closestDiff > toleranceMs) return null;
  return closest;
}

/** Signed percent change from `from` to `to`. Null when either input is
 * missing, or `from` is 0 (avoids a divide-by-zero / Infinity result). */
export function pctChange(
  from: number | null | undefined,
  to: number | null | undefined
): number | null {
  if (from === null || from === undefined || to === null || to === undefined) {
    return null;
  }
  if (from === 0) return null;
  return ((to - from) / from) * 100;
}
