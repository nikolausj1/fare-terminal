import { FreshnessTag } from '@/components/ui/FreshnessTag';
import { ModeToggle } from '@/components/market/ModeToggle';
import { RefreshButton } from '@/components/market/RefreshButton';
import { ShareButton } from '@/components/market/ShareButton';
import { formatPriceMinor } from '@/lib/format';
import type { MarketUrlState } from '@/lib/url-state';
import type { MarketSummaryVM } from '@/lib/markets/view-models';

export function MarketHeader({
  summary,
  urlState,
  outboundUrl,
}: {
  summary: MarketSummaryVM;
  urlState: MarketUrlState;
  outboundUrl: string | null;
}) {
  const { definition, snapshot, freshness } = summary;

  return (
    <>
      {/* Sticky compact price header, mobile only. */}
      <div className="sticky top-0 z-10 -mx-4 flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg)]/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 md:hidden">
        <span className="num text-sm font-semibold text-[var(--text-primary)]">
          {definition.origin} <span aria-hidden="true">→</span> {definition.destination}
        </span>
        <span className="num text-sm font-semibold text-[var(--text-primary)]">
          {formatPriceMinor(snapshot.benchmarkPriceMinor, definition.currency)}
        </span>
      </div>

      <header className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="num text-3xl font-semibold text-[var(--text-primary)] sm:text-4xl">
            {definition.origin} <span aria-hidden="true">→</span> {definition.destination}
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            {definition.originCity} to {definition.destinationCity}
            <span className="text-[var(--text-tertiary)]"> · Airport pair</span>
          </p>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <ModeToggle origin={definition.origin} destination={definition.destination} current={urlState} />
          <div className="flex items-center gap-2">
            <ShareButton />
            <RefreshButton origin={definition.origin} destination={definition.destination} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-[var(--text-secondary)]">{definition.windowDescription}</span>
          <FreshnessTag ageSeconds={freshness.ageSeconds} isStale={freshness.isStale} asOfMs={summary.snapshot.snapshotAt} />
        </div>

        <div>
          {outboundUrl ? (
            <a
              href={outboundUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Check current availability <span aria-hidden="true">↗</span>
            </a>
          ) : (
            <button
              type="button"
              disabled
              title="Not available in demo"
              className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-[var(--border-strong)] px-4 py-2 text-sm font-semibold text-[var(--text-tertiary)]"
            >
              Check current availability <span aria-hidden="true">↗</span>
            </button>
          )}
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
            {outboundUrl ? 'Prices may have changed. External site.' : 'Not available in demo — no external booking link for this offer.'}
          </p>
        </div>
      </header>
    </>
  );
}
