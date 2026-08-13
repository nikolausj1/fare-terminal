// WP-P5: a small, honest one-liner surfacing Google's own price-tracking
// data (price_insights, via SerpApi) for routes that have it — a completely
// separate signal from this app's own recommendation/percentile engine
// (SummaryCard/PercentileStrip), never blended with it. Renders nothing
// when there's no usable Google insights data for this definition (see
// MarketSummaryVM.googleInsights's doc comment for exactly when that is)
// or when the current benchmark price itself isn't reliable — no
// comparison to make without a trustworthy "today" price.

import { formatPriceMinor } from '@/lib/format';
import { typicalRangeComparison } from '@/lib/markets/googleInsights';
import type { MarketSummaryVM } from '@/lib/markets/view-models';

export function GoogleInsightsLine({ summary }: { summary: MarketSummaryVM }) {
  const { googleInsights, priceReliable, snapshot, definition } = summary;
  if (!googleInsights || !priceReliable) return null;

  const { typicalLowMinor, typicalHighMinor } = googleInsights;
  const comparison = typicalRangeComparison(snapshot.benchmarkPriceMinor, {
    lowMinor: typicalLowMinor,
    highMinor: typicalHighMinor,
  });

  return (
    <p
      className="text-xs text-[var(--text-tertiary)]"
      title="From Google Flights' own price-tracking (via SerpApi's price_insights) for this route — a separate signal from this terminal's own recommendation engine above, not a re-statement of it."
    >
      Google price tracking: typical range{' '}
      <span className="num">
        {formatPriceMinor(typicalLowMinor, definition.currency)}-{formatPriceMinor(typicalHighMinor, definition.currency)}
      </span>{' '}
      for this route; today&rsquo;s benchmark is <span className="font-medium text-[var(--text-secondary)]">{comparison}</span> that
      range.
    </p>
  );
}
