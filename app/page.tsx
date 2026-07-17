import Link from 'next/link';

import { SeverityChip } from '@/components/ui/Badge';
import { EmptyState, Panel } from '@/components/ui/Panel';
import { SearchBox } from '@/components/search/SearchBox';
import { MarketCard } from '@/components/market/MarketCard';
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/format';
import { buildMarketUrl } from '@/lib/url-state';
import { getMarketPulse } from '@/lib/markets/queries';

export default function HomePage() {
  const pulse = getMarketPulse();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6">
      <section aria-labelledby="hero-heading" className="flex flex-col gap-3">
        <h1 id="hero-heading" className="text-2xl font-semibold text-[var(--text-primary)] sm:text-3xl">
          Market Pulse
        </h1>
        <p className="max-w-2xl text-sm text-[var(--text-secondary)]">
          Airfare market intelligence built from observed data — current benchmark prices, history, and
          recommendations for tracked airport-pair routes.
        </p>
        <SearchBox />
      </section>

      <Panel title="AI market brief" titleId="brief-title">
        <p className="text-sm leading-relaxed text-[var(--text-primary)]">{pulse.brief.text}</p>
        <p className="mt-2 text-xs text-[var(--text-tertiary)]">
          {pulse.brief.mode === 'TEMPLATE' ? 'Template-generated' : pulse.brief.mode} ·{' '}
          <span title={formatAbsoluteTime(pulse.brief.generatedAt)}>{formatRelativeTime(pulse.brief.generatedAt)}</span>
        </p>
      </Panel>

      <section aria-labelledby="drops-heading" className="flex flex-col gap-3">
        <h2 id="drops-heading" className="text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          Biggest drops
        </h2>
        {pulse.biggestDrops.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pulse.biggestDrops.map((card) => (
              <MarketCard key={card.slug} card={card} />
            ))}
          </div>
        ) : (
          <EmptyState message="No markets currently show a qualifying price drop." />
        )}
      </section>

      <section aria-labelledby="favorable-heading" className="flex flex-col gap-3">
        <h2 id="favorable-heading" className="text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          Newly favorable
        </h2>
        {pulse.newlyFavorable.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pulse.newlyFavorable.map((card) => (
              <MarketCard key={card.slug} card={card} />
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
                  className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm hover:border-[var(--accent)]/50"
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
    </div>
  );
}
