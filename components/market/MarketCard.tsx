import Link from 'next/link';

import { ConfidenceChip, DataQualityChip } from '@/components/ui/Badge';
import { cn, formatPriceMinor, formatSignedPct, priceChangeVisual } from '@/lib/format';
import { buildMarketUrl } from '@/lib/url-state';
import type { MarketCardVM } from '@/lib/markets/view-models';

/** Compact route card used across market-pulse sections. A price DROP is
 * user-favorable, so drops render green/▼ and increases render red/▲ (the
 * inverse of a typical stock ticker) — see lib/format.ts#priceChangeVisual. */
export function MarketCard({ card }: { card: MarketCardVM }) {
  const visual = priceChangeVisual(card.changePct);
  return (
    <Link
      href={buildMarketUrl(card.origin, card.destination, { mode: 'flexible' })}
      className="group flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 transition-colors hover:border-[var(--accent)]/50 focus-visible:border-[var(--accent)]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="num text-sm font-semibold tracking-wide text-[var(--text-primary)]">
          {card.origin} <span aria-hidden="true">→</span> {card.destination}
        </span>
        {card.confidence && <ConfidenceChip level={card.confidence} />}
      </div>

      <div className="flex items-baseline gap-2">
        <span className="num text-2xl font-semibold text-[var(--text-primary)]">
          {formatPriceMinor(card.benchmarkPriceMinor)}
        </span>
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

      {card.percentile !== null && (
        <p className="text-xs text-[var(--text-secondary)]">
          Cheaper than {card.percentile.toFixed(0)}% of observed history
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
