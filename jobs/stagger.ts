// Stateless request-budget staggering for the WP-F2 background jobs
// (jobs/heatmap.ts, jobs/related.ts). Rather than persisting "which bucket
// did we do last sweep" in the DB, the current bucket is derived from the
// hour-of-day (UTC) the sweep is running at, which lines up with the
// existing cron cadence (.github/workflows/real-data-refresh.yml runs every
// 6h, on the hour: 00:00, 06:00, 12:00, 18:00 UTC).
//
// With bucketCount=4 and a 6h cadence, `currentSweepBucket` cycles through
// all 4 buckets once per 24h, so every item (route, origin) assigned a
// bucket via `isInSweepBucket` gets refreshed ~once per day, spread evenly
// across the day's sweeps instead of all at once. This is deliberately
// stateless (no "last refreshed" column, no persisted cursor) so it can
// never drift or need repair if a sweep is skipped/fails/re-run manually
// (workflow_dispatch) — a missed bucket at one hour just means that item
// waits for its next scheduled hour, same as if the whole sweep had been
// skipped.
//
// A manual/off-cadence run (workflow_dispatch at an arbitrary hour) still
// maps to *some* valid bucket via the same formula — it just may not be the
// "next" bucket in strict rotation order, which is fine: the goal is even
// long-run coverage, not a strict round-robin sequence.

/** Which bucket (0..bucketCount-1) the CURRENT sweep belongs to, derived
 * from `now`'s UTC hour-of-day. Divides the 24h day into `bucketCount`
 * equal-width slices. */
export function currentSweepBucket(now: number, bucketCount: number): number {
  if (bucketCount <= 0) {
    throw new Error(`currentSweepBucket: bucketCount must be > 0, got ${bucketCount}`);
  }
  const hour = new Date(now).getUTCHours();
  const sliceWidthHours = 24 / bucketCount;
  return Math.floor(hour / sliceWidthHours) % bucketCount;
}

/** True when the item at `itemKey` (an integer id, or any string hashed to
 * one) belongs to the bucket the current sweep is covering. Assigning items
 * to buckets by `itemKey % bucketCount` (rather than by array position)
 * means a roster/origin-list that grows or shrinks between sweeps only
 * reshuffles the handful of items whose key happens to sit near a bucket
 * boundary — most items keep their bucket assignment stable. */
export function isInSweepBucket(itemKey: number, bucketCount: number, now: number): boolean {
  const normalizedKey = ((itemKey % bucketCount) + bucketCount) % bucketCount;
  return normalizedKey === currentSweepBucket(now, bucketCount);
}

/** Deterministic small-integer hash for string keys (e.g. an origin IATA
 * code) that need a stable bucket assignment via isInSweepBucket, when no
 * natural numeric id (like a DB row id) is available. FNV-1a, truncated to
 * a safe non-negative integer. */
export function hashStringToInt(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
