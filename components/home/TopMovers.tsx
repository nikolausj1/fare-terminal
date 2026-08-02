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

import { isRecentlyUpdated, PulseDot } from './PulseDot';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

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
      {movers.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {movers.map((card) => (
            <MarketCard
              key={card.slug}
              card={card}
              sparkline={sparklines.get(card.slug) ?? null}
              dropBadge={card.qualifiesAsDrop}
            />
          ))}
        </div>
      ) : (
        <EmptyState message="No fresh, reliable route data available right now." />
      )}
    </section>
  );
}
