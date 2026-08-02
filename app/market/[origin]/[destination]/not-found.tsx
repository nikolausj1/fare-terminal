import Link from 'next/link';

import { SearchBox } from '@/components/search/SearchBox';
import { listTrackedMarkets } from '@/lib/markets/queries';
import { buildMarketUrl } from '@/lib/url-state';

/** WP-F1 fix 3: this page used to promise "the tracked markets below" and
 * render nothing underneath — listTrackedMarkets() now backs that promise
 * with the actual active FLEXIBLE markets, capped at 12 and sorted
 * alphabetically. Server component (not a client one) since it just reads
 * the DB once at render time; no interactivity needed beyond the links. */
export default function MarketNotFound() {
  const markets = listTrackedMarkets(12);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-16 sm:px-6">
      <h1 className="text-xl font-semibold text-[var(--text-primary)]">Market not tracked</h1>
      <p className="text-sm text-[var(--text-secondary)]">
        We don&apos;t have data for that route yet. Try one of the tracked markets below.
      </p>
      <SearchBox />

      {markets.length > 0 && (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {markets.map((m) => (
            <Link
              key={m.slug}
              href={buildMarketUrl(m.origin, m.destination, { mode: 'flexible' })}
              className="flex flex-col gap-0.5 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm hover:border-[var(--accent)]/50"
            >
              <span className="num font-semibold text-[var(--text-primary)]">
                {m.origin} <span aria-hidden="true">→</span> {m.destination}
              </span>
              <span className="text-xs text-[var(--text-tertiary)]">
                {m.originCity} to {m.destinationCity}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
