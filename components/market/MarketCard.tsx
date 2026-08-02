import Link from 'next/link';

import { ConfidenceChip, DataQualityChip } from '@/components/ui/Badge';
import { AnimatedNumber } from '@/components/home/AnimatedNumber';
import { Sparkline } from '@/components/charts/Sparkline';
import { cn, formatSignedPct, priceChangeVisual } from '@/lib/format';
import { buildMarketUrl } from '@/lib/url-state';
import type { MarketCardVM } from '@/lib/markets/view-models';

/** Compact route card used across market-pulse sections. A price DROP is
 * user-favorable, so drops render green/▼ and increases render red/▲ (the
 * inverse of a typical stock ticker) — see lib/format.ts#priceChangeVisual.
 *
 * WP-F3: `sparkline` (from lib/markets/sparklines.ts#getSparklines, batched
 * per page rather than fetched per card) and `dropBadge` (from
 * lib/markets/movers.ts#MoverVM.qualifiesAsDrop) are both optional/nullable
 * so this still renders correctly for callers that don't have that data
 * (e.g. it's simply omitted). */
export function MarketCard({
  card,
  sparkline,
  dropBadge = false,
}: {
  card: MarketCardVM;
  sparkline?: number[] | null;
  dropBadge?: boolean;
}) {
  const visual = priceChangeVisual(card.changePct);
  return (
    <Link
      href={buildMarketUrl(card.origin, card.destination, { mode: 'flexible' })}
      className="group flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 transition-all duration-150 hover:-translate-y-0.5 hover:border-[var(--accent)]/50 hover:shadow-[0_8px_24px_-10px_rgba(0,0,0,0.65)] focus-visible:border-[var(--accent)]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="num text-sm font-semibold tracking-wide text-[var(--text-primary)]">
          {card.origin} <span aria-hidden="true">→</span> {card.destination}
        </span>
        <div className="flex items-center gap-1.5">
          {dropBadge && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--pos)]/30 bg-[var(--pos-bg)] px-2 py-0.5 text-xs font-medium text-[var(--pos)]">
              <span aria-hidden="true">▼</span>
              Qualifying drop
            </span>
          )}
          {card.confidence && <ConfidenceChip level={card.confidence} />}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <AnimatedNumber
            value={card.benchmarkPriceMinor}
            format={{ kind: 'price' }}
            className="num text-2xl font-semibold text-[var(--text-primary)]"
          />
          {card.changePct !== null && (
            <span
              className="num inline-flex items-center gap-1 text-sm font-medium"
              style={{ color: `var(${visual.colorVar})` }}
            >
              <span aria-hidden="true">{visual.glyph}</span>
              {formatSignedPct(card.changePct)}
            </span>
          )}
        </div>
        <Sparkline values={sparkline} />
      </div>

      {card.percentile !== null && (
        <p className="text-xs text-[var(--text-secondary)]">
          {card.percentile >= 99.5
            ? 'Cheapest level in observed history'
            : card.percentile < 1
              ? 'At the high end of observed history'
              : `Cheaper than ${card.percentile.toFixed(0)}% of observed history`}
        </p>
      )}

      <p className="text-xs text-[var(--text-tertiary)]">{card.windowLabel}</p>

      {/* The pulse query's `note` field can restate the percentile sentence
          verbatim for "newly favorable" cards — skip it here rather than
          showing the same sentence twice. */}
      {card.note && !card.note.startsWith('Cheaper than') && (
        <p className={cn('text-sm text-[var(--text-secondary)]')}>{card.note}</p>
      )}

      <div className="mt-1">
        <DataQualityChip label={card.dataQualityLabel} />
      </div>
    </Link>
  );
}
