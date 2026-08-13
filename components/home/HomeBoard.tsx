// "From Seattle" home board (WP-P2): the first content section on the home
// page now that this deployment is a personal fare terminal with a fixed
// home airport (SEA). Grouped rows of destinations the owner actually
// cares about, each rendered honestly — a destination with no cached fare
// seen yet (e.g. a watch-level-only airport like SBA/STS) is SHOWN, not
// hidden, with a muted "No cached fares seen yet" state. That honesty is
// deliberate: a board that quietly omits what it doesn't know would be
// lying by omission.
//
// Server component (no 'use client') — AnimatedNumber and Sparkline are
// both server-renderable-safe the same way MarketCard already composes
// them (AnimatedNumber is itself a client island but can be rendered from a
// server component's tree, same pattern as components/market/MarketCard.tsx).

import Link from 'next/link';

import { AnimatedNumber } from '@/components/home/AnimatedNumber';
import { Sparkline } from '@/components/charts/Sparkline';
import { cn, formatPriceMinor, formatRelativeTime, formatSignedPct, priceChangeVisual } from '@/lib/format';
import { buildMarketUrl } from '@/lib/url-state';
import type { HomeBoardDestinationVM, HomeBoardGroupVM, HomeBoardVM } from '@/lib/markets/home-board';

import { percentileLabel, shouldShowBuildingHistory, shouldShowSparkline } from './homeBoardHelpers';

const CARD_CLASS =
  'flex w-44 shrink-0 flex-col gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-2.5 transition-all duration-150';
const CARD_LINK_CLASS = 'hover:-translate-y-0.5 hover:border-[var(--accent)]/50 focus-visible:border-[var(--accent)]';

function HomeBoardCardInner({ destination }: { destination: HomeBoardDestinationVM }) {
  const { code, cityName, currentPriceMinor, sparkline, changePct7d, percentile, observationCount } = destination;

  if (currentPriceMinor === null) {
    return (
      <>
        <div className="flex items-center justify-between gap-2">
          <span className="num text-sm font-semibold text-[var(--text-primary)]">{code}</span>
        </div>
        {cityName && <p className="text-xs text-[var(--text-tertiary)]">{cityName}</p>}
        <p className="text-xs italic text-[var(--text-tertiary)]">No cached fares seen yet</p>
      </>
    );
  }

  const visual = priceChangeVisual(changePct7d);

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="num text-sm font-semibold text-[var(--text-primary)]">{code}</span>
        {/* `relative` (not just shrink-0) matters here: Sparkline's internal
            sr-only span is `position: absolute` with no positioned
            ancestor of its own, so without a `relative` wrapper its static
            position escapes this row's overflow-x-auto clipping once a
            card sits past the visible edge — invisible but still counted
            in the page's layout overflow, causing real page-level
            horizontal scroll. MarketCard's grid layout never hits this
            because its cards are never scrolled past a clipped edge. */}
        {shouldShowSparkline(sparkline) && <Sparkline values={sparkline} label="7-day" className="relative shrink-0" />}
      </div>
      {cityName && <p className="text-xs text-[var(--text-tertiary)]">{cityName}</p>}

      <div className="flex items-baseline gap-1.5">
        <AnimatedNumber
          value={currentPriceMinor}
          format={{ kind: 'price' }}
          className="num text-lg font-semibold text-[var(--text-primary)]"
        />
        {changePct7d !== null && (
          <span
            className="num inline-flex items-center gap-0.5 text-xs font-medium"
            style={{ color: `var(${visual.colorVar})` }}
          >
            <span aria-hidden="true">{visual.glyph}</span>
            {formatSignedPct(changePct7d)}
          </span>
        )}
      </div>

      {percentile !== null && (
        <p className="text-xs text-[var(--text-secondary)]">{percentileLabel(percentile)}</p>
      )}

      {shouldShowBuildingHistory(observationCount) && (
        <p className="text-xs text-[var(--text-tertiary)]">Building history</p>
      )}
    </>
  );
}

function HomeBoardCard({ origin, destination }: { origin: string; destination: HomeBoardDestinationVM }) {
  if (destination.trackedRouteSlug) {
    return (
      <Link
        href={buildMarketUrl(origin, destination.code, { mode: 'flexible' })}
        className={cn(CARD_CLASS, CARD_LINK_CLASS)}
      >
        <HomeBoardCardInner destination={destination} />
      </Link>
    );
  }
  return (
    <div className={CARD_CLASS} title="Watch-level tracking (cheapest cached fare only)">
      <HomeBoardCardInner destination={destination} />
    </div>
  );
}

function HomeBoardGroupRow({ origin, group }: { origin: string; group: HomeBoardGroupVM }) {
  if (group.destinations.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">{group.label}</h3>
      <div className="home-board-hscroll flex min-w-0 gap-3 overflow-x-auto pb-1">
        {group.destinations.map((destination) => (
          <HomeBoardCard key={destination.code} origin={origin} destination={destination} />
        ))}
      </div>
    </div>
  );
}

function HomeBoardExtras({ origin, extras }: { origin: string; extras: HomeBoardDestinationVM[] }) {
  if (extras.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
        Also spotted from Seattle
      </h3>
      <div className="home-board-hscroll flex min-w-0 gap-2 overflow-x-auto pb-1">
        {extras.map((destination) => {
          const chipClass =
            'inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-[var(--border)] bg-[var(--panel-raised)] px-3 py-1.5 text-xs';
          const content = (
            <>
              <span className="num font-semibold text-[var(--text-primary)]">{destination.code}</span>
              <span className="num text-[var(--text-secondary)]">
                {destination.currentPriceMinor !== null
                  ? formatPriceMinor(destination.currentPriceMinor)
                  : 'No fare yet'}
              </span>
            </>
          );
          if (destination.trackedRouteSlug) {
            return (
              <Link
                key={destination.code}
                href={buildMarketUrl(origin, destination.code, { mode: 'flexible' })}
                className={cn(chipClass, 'transition-colors duration-150 hover:border-[var(--accent)]/50')}
              >
                {content}
              </Link>
            );
          }
          return (
            <span key={destination.code} className={chipClass} title="Watch-level tracking (cheapest cached fare only)">
              {content}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function HomeBoard({ board }: { board: HomeBoardVM }) {
  return (
    <section aria-labelledby="home-board-heading" className="flex min-w-0 flex-col gap-3 overflow-x-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 id="home-board-heading" className="text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
            From {board.originCity}
          </h2>
          <span className="num inline-flex items-center rounded-full border border-[var(--accent)]/40 bg-[var(--accent-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--accent)]">
            {board.origin}
          </span>
        </div>
        <span className="text-xs text-[var(--text-tertiary)]">
          {board.updatedAt !== null ? `Updated ${formatRelativeTime(board.updatedAt)}` : 'No data yet'}
        </span>
      </div>

      {board.groups.length === 0 && board.extras.length === 0 ? (
        <p className="rounded-md border border-dashed border-[var(--border)] px-3 py-6 text-center text-sm text-[var(--text-tertiary)]">
          No destinations tracked from {board.originCity} yet.
        </p>
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          {board.groups.map((group) => (
            <HomeBoardGroupRow key={group.id} origin={board.origin} group={group} />
          ))}
          <HomeBoardExtras origin={board.origin} extras={board.extras} />
        </div>
      )}
    </section>
  );
}
