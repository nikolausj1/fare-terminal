// Pinned top routes strip (added 2026-08-13, owner request): the owner's
// three main destinations (Milwaukee, Phoenix, Minneapolis —
// domain/config.ts#homeBoard.pinned) rendered as three larger, richer cards
// at the very TOP of the "From Seattle" section, above the existing group
// rows in HomeBoard.tsx. Fed by lib/markets/pinned.ts#getPinnedRoutes,
// which prefers each route's FULL_TRACKING (daily Google Flights-depth)
// benchmark data and falls back to the same lightweight WATCH_FEED
// (city_direction_history) feed the group rows below use when no reliable
// FULL_TRACKING snapshot exists yet — see that file for the full
// precedence. Purely additive: a pinned code is never removed from its
// existing group row (HomeBoard.tsx's insertion point renders this strip
// before the group rows, not instead of them).
//
// Server component, same reasoning as HomeBoard.tsx: AnimatedNumber is a
// client island but composes fine inside a server component's tree.

import Link from 'next/link';

import { AnimatedNumber } from '@/components/home/AnimatedNumber';
import { RecommendationBadge } from '@/components/ui/Badge';
import { Sparkline } from '@/components/charts/Sparkline';
import { cn, formatPriceMinor, formatSignedPct, priceChangeVisual } from '@/lib/format';
import { isBelowTypicalRange } from '@/lib/markets/googleInsights';
import { buildMarketUrl } from '@/lib/url-state';
import type { PinnedRouteVM } from '@/lib/markets/pinned';

import { percentileLabel } from './homeBoardHelpers';

/** "Cheaper than X% of Google's 60-day tracking" — the WP-P5 counterpart to
 * percentileLabel() above, shown ONLY when our own percentile is
 * unavailable (thin own-history) but Google's price_insights history gives
 * us something to compare against. Deliberately worded "Google's ... tracking"
 * every time, never just "history" or "what we've seen" — this is Google's
 * observation, not this app's, and must never read as if it were. */
function googlePercentileLabel(pct: number): string {
  if (pct >= 99.5) return "Cheapest Google's tracked in the last 60 days";
  if (pct < 1) return "Priciest Google's tracked in the last 60 days";
  return `Cheaper than ${pct.toFixed(0)}% of Google's 60-day tracking`;
}

/** Visually distinct from the plain group-row cards below (larger, accent
 * border, raised panel background) — this strip is the "deep view" and
 * should read as a step up, not just another row. */
const PINNED_CARD_CLASS =
  'flex min-w-[15rem] flex-1 flex-col gap-2.5 rounded-xl border border-[var(--accent)]/25 bg-[var(--panel-raised)] p-4 transition-all duration-150';
const PINNED_CARD_LINK_CLASS =
  'hover:-translate-y-0.5 hover:border-[var(--accent)]/60 hover:shadow-[0_10px_28px_-16px_rgba(59,130,246,0.45)] focus-visible:border-[var(--accent)]';

const SOURCE_TAG_COPY: Record<'FULL_TRACKING' | 'WATCH_FEED', { label: string; title: string }> = {
  FULL_TRACKING: {
    label: 'Google-depth',
    title: 'Full-tracking route: daily deep search data from Google Flights (via SerpApi), the richest tier this terminal collects.',
  },
  WATCH_FEED: {
    label: 'cached feed',
    title: 'Watch-level tracking: cheapest fare seen in the lightweight city-directions feed, not the deep Google Flights search data.',
  },
};

function SourceTag({ source }: { source: 'FULL_TRACKING' | 'WATCH_FEED' }) {
  const copy = SOURCE_TAG_COPY[source];
  return (
    <span
      title={copy.title}
      className="inline-flex shrink-0 items-center rounded-full border border-[var(--border-strong)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]"
    >
      {copy.label}
    </span>
  );
}

function PinnedRouteCardInner({ origin, route }: { origin: string; route: PinnedRouteVM }) {
  const {
    code,
    cityName,
    priceMinor,
    priceSource,
    changePct24h,
    sparkline,
    sparklineSource,
    percentile,
    googlePercentile,
    typicalRange,
    recommendationLabel,
    offerCount,
  } = route;

  const header = (
    <div className="flex items-start justify-between gap-2">
      <div className="flex flex-col gap-0.5">
        <span className="num text-sm font-semibold tracking-wide text-[var(--text-primary)]">
          {origin} <span aria-hidden="true">→</span> {code}
          {cityName && <span className="text-[var(--text-tertiary)]"> · {cityName}</span>}
        </span>
      </div>
      {priceSource !== 'NONE' && <SourceTag source={priceSource} />}
    </div>
  );

  if (priceMinor === null) {
    return (
      <>
        {header}
        <p className="text-xs italic text-[var(--text-tertiary)]">No cached fares seen yet</p>
      </>
    );
  }

  const visual = priceChangeVisual(changePct24h);

  return (
    <>
      {header}

      <div className="flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <AnimatedNumber
            value={priceMinor}
            format={{ kind: 'price' }}
            className="num text-3xl font-semibold text-[var(--text-primary)]"
          />
          {changePct24h !== null && (
            <span
              className="num inline-flex items-center gap-1 text-sm font-medium"
              style={{ color: `var(${visual.colorVar})` }}
            >
              <span aria-hidden="true">{visual.glyph}</span>
              {formatSignedPct(changePct24h)}
              <span className="text-[var(--text-tertiary)]">24h</span>
            </span>
          )}
        </div>
        {sparkline.length >= 2 && (
          <div className="flex shrink-0 flex-col items-end gap-0.5">
            <Sparkline values={sparkline} label="Recent" className="relative shrink-0" />
            {/* WP-P5: a GOOGLE_HISTORY sparkline is Google's own tracking
                data, not this app's observations — caption it honestly
                rather than let it look like the same kind of line as an
                OBSERVATIONS sparkline. */}
            {sparklineSource === 'GOOGLE_HISTORY' && (
              <span
                title="This sparkline is Google's own price-tracking history for this route (via SerpApi's price_insights), not observations this terminal has collected itself yet."
                className="text-[9px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]"
              >
                60d · Google
              </span>
            )}
          </div>
        )}
      </div>

      {percentile !== null ? (
        <p className="text-xs text-[var(--text-secondary)]">{percentileLabel(percentile)}</p>
      ) : (
        googlePercentile !== null && (
          <p
            title="Computed against Google's own price-tracking history for this route, not this terminal's own observations."
            className="text-xs text-[var(--text-secondary)]"
          >
            {googlePercentileLabel(googlePercentile)}
          </p>
        )
      )}

      {(recommendationLabel || offerCount !== null || isBelowTypicalRange(priceMinor, typicalRange)) && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {recommendationLabel && <RecommendationBadge label={recommendationLabel} className="px-2 py-0.5 text-xs" />}
          {offerCount !== null && (
            <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-white/5 px-2 py-0.5 text-xs text-[var(--text-secondary)]">
              {offerCount} offer{offerCount === 1 ? '' : 's'} today
            </span>
          )}
          {typicalRange && isBelowTypicalRange(priceMinor, typicalRange) && (
            <span
              title={`Below Google's typical price range for this route (${formatPriceMinor(typicalRange.lowMinor)}-${formatPriceMinor(typicalRange.highMinor)}).`}
              className="inline-flex items-center rounded-full border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-2 py-0.5 text-xs font-medium text-[var(--accent)]"
            >
              Below typical range
            </span>
          )}
        </div>
      )}
    </>
  );
}

function PinnedRouteCard({ origin, route }: { origin: string; route: PinnedRouteVM }) {
  if (route.slug) {
    return (
      <Link
        href={buildMarketUrl(origin, route.code, { mode: 'flexible' })}
        className={cn(PINNED_CARD_CLASS, PINNED_CARD_LINK_CLASS)}
      >
        <PinnedRouteCardInner origin={origin} route={route} />
      </Link>
    );
  }
  return (
    <div className={PINNED_CARD_CLASS}>
      <PinnedRouteCardInner origin={origin} route={route} />
    </div>
  );
}

export function PinnedRoutes({ origin, routes }: { origin: string; routes: PinnedRouteVM[] }) {
  if (routes.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="pinned-routes">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">Pinned</h3>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
        {routes.map((route) => (
          <PinnedRouteCard key={route.code} origin={origin} route={route} />
        ))}
      </div>
    </div>
  );
}
