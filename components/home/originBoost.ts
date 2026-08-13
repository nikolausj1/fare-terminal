// Home-origin ("SEA") boost for components/home/TopMovers.tsx (WP-P2
// deliverable 4). The movers data itself (lib/markets/movers.ts) is owned
// by a different work package and stays untouched — this is purely a
// rendering-layer reorder + badge-flag applied on top of whatever
// getTopMovers() already returned, sorted by |pct24h| descending.
//
// Sort semantics: a plain Array.prototype.sort is used with a comparator
// that returns 0 for any pair whose |changePct| magnitudes differ. Per
// ES2019, Array.prototype.sort is a STABLE sort, so returning 0 for
// non-tied pairs leaves their relative order exactly as movers.ts produced
// it (already ranked by |pct24h|) — the comparator only ever reorders
// within a tied magnitude group, moving home-origin routes to the front of
// that group. See tests/unit/origin-boost.test.ts.

export interface OriginBoostable {
  origin: string;
  changePct: number | null;
}

/** Adds `isHome` (origin === homeOrigin, case-insensitive) to every item and
 * stable-sorts so home-origin routes come first among equal-|changePct|
 * ties, without disturbing the relative order of non-tied items. A missing
 * changePct (null) is treated as its own magnitude bucket (-1, mirroring
 * lib/markets/movers.ts#rankMoversByAbsChange's "sorts last" convention) so
 * it only ties with other null-change items. */
export function applyOriginBoost<T extends OriginBoostable>(
  items: T[],
  homeOrigin: string
): (T & { isHome: boolean })[] {
  const home = homeOrigin.toUpperCase();
  const magnitude = (pct: number | null) => (pct === null ? -1 : Math.abs(pct));

  return items
    .map((item) => ({ ...item, isHome: item.origin.toUpperCase() === home }))
    .sort((a, b) => {
      if (magnitude(a.changePct) !== magnitude(b.changePct)) return 0;
      if (a.isHome === b.isHome) return 0;
      return a.isHome ? -1 : 1;
    });
}
