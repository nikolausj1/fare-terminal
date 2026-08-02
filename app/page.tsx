import Link from 'next/link';

import { SeverityChip } from '@/components/ui/Badge';
import { EmptyState, Panel } from '@/components/ui/Panel';
import { SearchBox } from '@/components/search/SearchBox';
import { MarketCard } from '@/components/market/MarketCard';
import { IndexHero } from '@/components/home/IndexHero';
import { TopMovers } from '@/components/home/TopMovers';
import { DealsTicker } from '@/components/home/DealsTicker';
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/format';
import { buildMarketUrl } from '@/lib/url-state';
import { getMarketPulse } from '@/lib/markets/queries';
import { getIndexSeries, getIndexToday } from '@/lib/markets/index-series';
import { getLatestDeals } from '@/lib/markets/deals';
import { getTopMovers } from '@/lib/markets/movers';
import { getSparklines } from '@/lib/markets/sparklines';

// WP-F3: home page rebuilt from a mostly-static list into an "alive" market
// terminal. Section order (Nav lives in app/layout.tsx, not here):
//   hero title/search -> Index hero -> Top movers -> Deals ticker ->
//   Newly favorable -> Unusual events -> AI brief -> (footer, in layout.tsx)
// The AI brief moved from the top to just above the footer — it's secondary
// context, not the reason to load the page. Every section below is
// null-safe with an honest empty state (movers/ticker are additionally
// designed to essentially never be empty on real data — see
// lib/markets/movers.ts's doc comment for why the old "Biggest drops" gate
// made that section empty far too often).
export default function HomePage() {
  const pulse = getMarketPulse();
  const movers = getTopMovers(6);
  const indexToday = getIndexToday();
  const indexSeries = indexToday ? getIndexSeries(90) : [];
  const deals = getLatestDeals(12);

  // One batched sparkline query covering every card slug this render needs
  // (movers + newly-favorable), instead of one query per card.
  const sparklineSlugs = Array.from(new Set([...movers.map((m) => m.slug), ...pulse.newlyFavorable.map((c) => c.slug)]));
  const sparklines = getSparklines(sparklineSlugs, 30);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8">
      <section aria-labelledby="hero-heading" className="flex flex-col gap-2 sm:gap-3">
        <h1 id="hero-heading" className="text-xl font-semibold text-[var(--text-primary)] sm:text-3xl">
          Market Pulse
        </h1>
        <p className="max-w-2xl text-xs text-[var(--text-secondary)] sm:text-sm">
          Airfare market intelligence built from observed data — current benchmark prices, history, and
          recommendations for tracked airport-pair routes.
        </p>
        <SearchBox />
      </section>

      {/* Null-safe: an index with zero data yet (e.g. a brand-new real-data
          deploy before the anchor-day coverage threshold is met) omits the
          hero entirely rather than rendering a broken/empty one. */}
      {indexToday && <IndexHero today={indexToday} series={indexSeries} />}

      <TopMovers movers={movers} sparklines={sparklines} freshnessAt={pulse.freshness.datasetAnchorAt} />

      <DealsTicker deals={deals} />

      <section aria-labelledby="favorable-heading" className="flex flex-col gap-3">
        <h2 id="favorable-heading" className="text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          Newly favorable
        </h2>
        {pulse.newlyFavorable.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pulse.newlyFavorable.map((card) => (
              <MarketCard key={card.slug} card={card} sparkline={sparklines.get(card.slug) ?? null} />
            ))}
          </div>
        ) : (
          <EmptyState message="No markets currently look newly favorable." />
        )}
      </section>

      <section aria-labelledby="unusual-heading" className="flex flex-col gap-3">
        <h2 id="unusual-heading" className="text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          Unusual events
        </h2>
        {pulse.unusualEvents.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {pulse.unusualEvents.map((item, i) => (
              <li key={i}>
                <Link
                  href={buildMarketUrl(item.origin, item.destination, { mode: 'flexible' })}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm transition-colors duration-150 hover:border-[var(--accent)]/50"
                >
                  <SeverityChip severity={item.event.severity} />
                  <span className="rounded-full border border-[var(--border-strong)] px-2 py-0.5 text-xs font-medium text-[var(--text-secondary)]">
                    {item.event.label}
                  </span>
                  <span className="num font-semibold text-[var(--text-primary)]">
                    {item.origin} <span aria-hidden="true">→</span> {item.destination}
                  </span>
                  {item.event.observedFacts[0] && (
                    <span className="text-[var(--text-secondary)]">{item.event.observedFacts[0]}</span>
                  )}
                  <span className="ml-auto text-xs text-[var(--text-tertiary)]">
                    {formatRelativeTime(item.event.eventStartAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState message="No unusual signals detected in the last 48 hours." />
        )}
      </section>

      {/* AI brief moved below the movers/events sections — secondary
          context, not the reason to load the page (WP-F3 section order). */}
      <Panel title="AI market brief" titleId="brief-title">
        <p className="text-sm leading-relaxed text-[var(--text-primary)]">{pulse.brief.text}</p>
        <p className="mt-2 text-xs text-[var(--text-tertiary)]">
          {pulse.brief.mode === 'TEMPLATE' ? 'Template-generated' : pulse.brief.mode} ·{' '}
          <span title={formatAbsoluteTime(pulse.brief.generatedAt)}>{formatRelativeTime(pulse.brief.generatedAt)}</span>
        </p>
      </Panel>
    </div>
  );
}
