import { FreshnessTag } from '@/components/ui/FreshnessTag';
import { ModeToggle } from '@/components/market/ModeToggle';
import { RefreshButton } from '@/components/market/RefreshButton';
import { SectionNavMobileChips } from '@/components/market/SectionNav';
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
  const { definition, snapshot, freshness, dataSourceMode, priceReliable, modeFallback } = summary;
  const isDemo = dataSourceMode === 'DEMO';
  const noLinkTitle = isDemo ? 'Not available in demo' : 'No outbound booking link for this offer';
  const noLinkCaption = isDemo
    ? 'Not available in demo — no external booking link for this offer.'
    : 'No external booking link for this offer.';

  return (
    <>
      {/* Sticky compact price header, mobile only. data-testid: no accessible
          selector distinguishes this from the <h1> below (same origin/dest
          text), so tests/e2e/mobile.spec.ts targets it directly. */}
      <div
        data-testid="sticky-summary"
        className="sticky top-0 z-10 -mx-4 flex h-11 items-center justify-between border-b border-[var(--border)] bg-[var(--bg)]/95 px-4 backdrop-blur sm:-mx-6 sm:px-6 md:hidden"
      >

        <span className="num text-sm font-semibold text-[var(--text-primary)]">
          {definition.origin} <span aria-hidden="true">→</span> {definition.destination}
        </span>
        <span className="num text-sm font-semibold text-[var(--text-primary)]">
          {priceReliable ? formatPriceMinor(snapshot.benchmarkPriceMinor, definition.currency) : 'Unreliable'}
        </span>
      </div>
      {/* WP-F4 §5: nav chip row stacks directly below the bar above — its
          `top-11` sticky offset (components/market/SectionNav.tsx) matches
          that bar's `h-11` here, so the two independently-sticky elements
          land back to back instead of overlapping. */}
      <SectionNavMobileChips />

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
          <div className="flex flex-col gap-2">
            <ModeToggle origin={definition.origin} destination={definition.destination} current={urlState} />
            {/* WP-F1 fix 2: resolveDefinitionDetailed silently substituted
                the FLEXIBLE-window definition because no EXACT-date
                search_definition exists for these dates yet. The toggle
                above still reflects what the user actually asked for
                (urlState, untouched) — this notice is what explains why the
                numbers on the page are the flexible benchmark anyway. */}
            {modeFallback && (
              <p
                role="status"
                className="max-w-sm rounded-md border border-[var(--warn)]/40 bg-[var(--warn-bg)] px-2.5 py-1.5 text-xs text-[var(--warn)]"
              >
                No exact-date observations exist for these dates yet — showing the flexible-window market benchmark
                instead.
              </p>
            )}
          </div>
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
              title={noLinkTitle}
              className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-[var(--border-strong)] px-4 py-2 text-sm font-semibold text-[var(--text-tertiary)]"
            >
              Check current availability <span aria-hidden="true">↗</span>
            </button>
          )}
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
            {outboundUrl ? 'Prices may have changed. External site.' : noLinkCaption}
          </p>
        </div>
      </header>
    </>
  );
}
