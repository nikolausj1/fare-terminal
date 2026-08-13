// "Top movers (24h)" (WP-F3 deliverable 3): replaces the old
// threshold-gated "Biggest drops" section, which on real data was very
// often empty (0-5%+ moves aren't guaranteed every sweep) — see
// lib/markets/movers.ts's module doc comment for the full rationale. Every
// fresh, reliable route is ranked by |pct24h| here; the old move-size gate
// survives only as a `qualifiesAsDrop` badge on qualifying cards, not a
// visibility gate.

import { EmptyState } from '@/components/ui/Panel';
import { MarketCard } from '@/components/market/MarketCard';
import { formatRelativeTime } from '@/lib/format';
import type { MoverVM } from '@/lib/markets/movers';

import { applyOriginBoost } from './originBoost';
import { isRecentlyUpdated, PulseDot } from './PulseDot';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

// WP-P2 deliverable 4: this deployment's home airport, matching HomeBoard's
// origin. Movers whose route starts here get a small "SEA" badge and sort
// first among equal-magnitude ties (see components/home/originBoost.ts) —
// applied entirely in this rendering layer; lib/markets/movers.ts (owned by
// a different work package) is untouched.
const HOME_ORIGIN = 'SEA';

export function TopMovers({
  movers,
  sparklines,
  freshnessAt,
}: {
  movers: MoverVM[];
  sparklines: Map<string, number[]>;
  /** lib/markets/queries.ts#PulseVM.freshness.datasetAnchorAt — used only to
   * decide whether the freshness pulse dot shows (< 2h old), and for the
   * "Updated Xh ago" caption. Per-card freshness isn't available from the
   * current read layer (see lib/markets/movers.ts's doc comment), so this
   * is one dataset-level freshness indicator for the whole section rather
   * than per-card. */
  freshnessAt: number;
}) {
  const isFresh = isRecentlyUpdated(freshnessAt, TWO_HOURS_MS);
  // Rendering-layer-only reorder + badge flag — see originBoost.ts's doc
  // comment for why a stable sort here is safe to apply on top of movers.ts's
  // already-|pct24h|-ranked output.
  const boosted = applyOriginBoost(movers, HOME_ORIGIN);

  return (
    <section aria-labelledby="movers-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="movers-heading" className="text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          Top movers (24h)
        </h2>
        <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
          {isFresh && <PulseDot />}
          Updated {formatRelativeTime(freshnessAt)}
        </span>
      </div>
      {boosted.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {boosted.map((card) => (
            <div key={card.slug} className="relative">
              {card.isHome && (
                <span
                  className="num absolute -top-2 -left-2 z-10 inline-flex items-center rounded-full border border-[var(--accent)]/40 bg-[var(--panel)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)] shadow-sm"
                  title="Departs from home airport (SEA)"
                >
                  SEA
                </span>
              )}
              <MarketCard
                card={card}
                sparkline={sparklines.get(card.slug) ?? null}
                dropBadge={card.qualifiesAsDrop}
              />
            </div>
          ))}
        </div>
      ) : (
        <EmptyState message="No fresh, reliable route data available right now." />
      )}
    </section>
  );
}
