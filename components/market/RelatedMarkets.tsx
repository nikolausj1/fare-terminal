import Link from 'next/link';

import { EmptyState } from '@/components/ui/Panel';
import { cn, formatPriceMinor, formatRelativeTime } from '@/lib/format';
import type { RelatedMarketVM } from '@/lib/markets/related';

import { toRelatedMarketRows } from './relatedMarketsView';

/** Related markets (PRD §14.9, WP-F4 §3): up to 6 cheapest destinations
 * cached from this origin. Server component — no interactivity beyond
 * plain <Link>s, so no 'use client' needed. */
export function RelatedMarkets({
  origin,
  originCity,
  markets,
  currency,
}: {
  origin: string;
  originCity: string;
  markets: RelatedMarketVM[];
  currency: string;
}) {
  const rows = toRelatedMarketRows(markets, origin);

  return (
    <div>
      <p className="mb-3 text-xs text-[var(--text-tertiary)]">
        These are different destinations, not substitutes for {originCity}&rsquo;s market above — cached city-level
        fares, not a live comparison.
      </p>

      {rows.length === 0 ? (
        <EmptyState message={`No related markets tracked yet for ${originCity}.`} />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => {
            const tracked = row.href !== null;
            const content = (
              <>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="num text-sm font-semibold text-[var(--text-primary)]">
                    {row.destination} <span className="font-normal text-[var(--text-secondary)]">{row.cityLabel}</span>
                  </span>
                </div>
                <div className="mt-1 flex items-baseline justify-between gap-2">
                  <span className="num text-lg font-semibold text-[var(--text-primary)]">
                    {formatPriceMinor(row.priceMinor, currency)}
                  </span>
                  <span className="text-xs text-[var(--text-tertiary)]">{formatRelativeTime(row.observedAt)}</span>
                </div>
                <div className="mt-2 text-xs">
                  {tracked ? (
                    <span className="text-[var(--accent)]">View market →</span>
                  ) : (
                    <span className="rounded-full border border-dashed border-[var(--border-strong)] px-2 py-0.5 text-[var(--text-tertiary)]">
                      Not tracked
                    </span>
                  )}
                </div>
              </>
            );

            const cardClass = cn(
              'block rounded-md border p-3',
              tracked
                ? 'border-[var(--border)] bg-[var(--panel-raised)] hover:border-[var(--accent)]'
                : 'border-dashed border-[var(--border)] bg-white/[0.02]'
            );

            return (
              <li key={row.destination}>
                {tracked ? (
                  <Link href={row.href as string} className={cardClass}>
                    {content}
                  </Link>
                ) : (
                  <div className={cardClass}>{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
