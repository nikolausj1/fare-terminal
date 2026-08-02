// Deals ticker (WP-F3 deliverable 4): a horizontal strip of recently
// spotted fares from lib/markets/deals.ts#getLatestDeals, a network-wide
// feed (per that file's doc comment) not scoped to the tracked roster — so
// most items won't link anywhere, and the ones that do link only when the
// origin/destination pair matches a tracked search_definition. Labeled
// honestly as a cached/network-wide discovery feed, not a per-market
// widget.
//
// Motion: a CSS keyframe scroll (.deals-track, app/globals.css) on
// desktop/tablet, paused on hover/focus so links stay reachable; a plain
// static stacked list on mobile (<640px) instead of a moving strip, per the
// WP-F3 motion spec ("static stacked list on mobile / reduced-motion"). The
// marquee half's duplicated items are rendered as non-interactive,
// aria-hidden decoration (never focusable) so keyboard/AT users only ever
// encounter each deal once.

import Link from 'next/link';

import { EmptyState } from '@/components/ui/Panel';
import { formatPriceMinor, formatRelativeTime } from '@/lib/format';
import type { DealVM } from '@/lib/markets/deals';
import { listTrackedMarkets } from '@/lib/markets/queries';
import { buildMarketUrl } from '@/lib/url-state';

import { isRecentlyUpdated, PulseDot } from './PulseDot';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

/** Pure — exported for unit testing (tests/unit/deals-ticker.test.ts). Maps
 * (origin, destination) -> the tracked FLEXIBLE search_definitions.slug for
 * that pair, so a deal from the network-wide feed can be linked when (and
 * only when) it's actually a market this app tracks. */
export function buildTrackedRouteMap(
  tracked: { origin: string; destination: string; slug: string }[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const t of tracked) {
    map.set(`${t.origin.toUpperCase()}-${t.destination.toUpperCase()}`, t.slug);
  }
  return map;
}

/** Pure — exported for unit testing. Null when the deal's route isn't
 * tracked (the DealsTicker item then renders as plain text, not a link). */
export function resolveDealSlug(deal: { origin: string; destination: string }, trackedMap: Map<string, string>): string | null {
  return trackedMap.get(`${deal.origin.toUpperCase()}-${deal.destination.toUpperCase()}`) ?? null;
}

function DealChip({ deal, slug, decorative = false }: { deal: DealVM; slug: string | null; decorative?: boolean }) {
  const isFresh = isRecentlyUpdated(deal.foundAt, TWO_HOURS_MS);
  const className =
    'inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-[var(--border)] bg-[var(--panel-raised)] px-3 py-1.5 text-xs';

  const content = (
    <>
      {isFresh && !decorative && <PulseDot />}
      <span className="num font-semibold text-[var(--text-primary)]">
        {deal.origin} <span aria-hidden="true">→</span> {deal.destination}
      </span>
      <span className="num text-[var(--text-primary)]">{formatPriceMinor(deal.priceMinor)}</span>
      <span className="text-[var(--text-tertiary)]">spotted {formatRelativeTime(deal.foundAt)}</span>
    </>
  );

  if (slug && !decorative) {
    return (
      <Link
        href={buildMarketUrl(deal.origin, deal.destination, { mode: 'flexible' })}
        className={`${className} transition-colors duration-150 hover:border-[var(--accent)]/50`}
      >
        {content}
      </Link>
    );
  }
  return (
    <span className={className} aria-hidden={decorative || undefined}>
      {content}
    </span>
  );
}

export function DealsTicker({ deals }: { deals: DealVM[] }) {
  // listTrackedMarkets defaults to a 12-market cap (built for the not-found
  // page's "here's what IS tracked" listing) — pass a high limit here since
  // this needs the *full* roster to check every deal against, not a
  // display-capped sample.
  const trackedMap = buildTrackedRouteMap(listTrackedMarkets(500));

  return (
    <section aria-labelledby="deals-heading" className="flex flex-col gap-3">
      <h2 id="deals-heading" className="text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
        Recently spotted fares across the network (cached)
      </h2>
      {deals.length === 0 ? (
        <EmptyState message="No recently spotted fares yet — check back soon." />
      ) : (
        <>
          {/* Desktop/tablet: CSS-scroll marquee, paused on hover/focus. */}
          <div className="deals-viewport hidden overflow-hidden sm:block">
            <ul className="deals-track flex w-max gap-3 py-1">
              {[...deals, ...deals].map((deal, i) => {
                const decorative = i >= deals.length;
                return (
                  <li key={`${deal.origin}-${deal.destination}-${deal.foundAt}-${i}`}>
                    <DealChip deal={deal} slug={resolveDealSlug(deal, trackedMap)} decorative={decorative} />
                  </li>
                );
              })}
            </ul>
          </div>
          {/* Mobile: static stacked list, no motion. */}
          <ul className="flex flex-col gap-2 sm:hidden">
            {deals.map((deal, i) => (
              <li key={`${deal.origin}-${deal.destination}-${deal.foundAt}-${i}`}>
                <DealChip deal={deal} slug={resolveDealSlug(deal, trackedMap)} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
