import Link from 'next/link';

import { ConfidenceChip, RecommendationBadge } from '@/components/ui/Badge';
import { Panel } from '@/components/ui/Panel';
import { PriceText } from '@/components/ui/PriceText';
import { DeltaTag } from '@/components/ui/StatBlock';
import { FairValueBand } from '@/components/market/FairValueBand';
import { ACTION_PHRASE } from '@/domain/analyst/labelPhrases';
import type { MarketSummaryVM } from '@/lib/markets/view-models';

/** The four-answer summary card (PRD §14.2): benchmark price, from price,
 * 24h/7d deltas, percentile sentence, fair-value band, and the
 * recommendation. */
export function SummaryCard({ summary }: { summary: MarketSummaryVM }) {
  const { snapshot, change, percentile, fairValue, recommendation } = summary;

  // MarketSummaryVM.recommendation.summary is always '' — the read layer's
  // rowToRecommendationOutput() never populates it from the stored
  // recommendation row (see lib/markets/queries.ts). Fall back to the
  // shared PRD-copy action phrase for the label so the panel never renders
  // blank text — flagged in the WP5 report as a VM gap for the query layer.
  const recommendationSummary =
    recommendation && recommendation.summary.trim().length > 0
      ? recommendation.summary
      : recommendation
        ? ACTION_PHRASE[recommendation.label]
        : null;

  return (
    <Panel title="Market summary" titleId="summary-card-title">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
              Current benchmark
            </span>
            <div className="mt-1 flex flex-wrap items-baseline gap-3">
              <PriceText minor={snapshot.benchmarkPriceMinor} currency={summary.definition.currency} size="xl" />
              {change?.pct24h !== null && change?.pct24h !== undefined && (
                <DeltaTag pct={change.pct24h} favorableWhen="down" />
              )}
            </div>
            <p className="mt-1 text-xs text-[var(--text-tertiary)]">
              Median of the 5 lowest valid unique offers observed in the current window.
            </p>
          </div>

          <div className="flex flex-wrap gap-6">
            <div>
              <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">From price</span>
              <div className="mt-1">
                <PriceText minor={snapshot.fromPriceMinor} currency={summary.definition.currency} size="lg" />
              </div>
            </div>
            {change?.pct7d !== null && change?.pct7d !== undefined && (
              <div>
                <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">7-day change</span>
                <div className="mt-1">
                  <DeltaTag pct={change.pct7d} favorableWhen="down" />
                </div>
              </div>
            )}
          </div>

          <p className="text-sm text-[var(--text-secondary)]">
            {percentile !== null
              ? `Cheaper than ${percentile.toFixed(0)}% of comparable observations.`
              : 'Not enough compatible history yet for a percentile comparison.'}
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
              Fair value band
            </span>
            {fairValue ? (
              <FairValueBand range={fairValue} currentMinor={snapshot.benchmarkPriceMinor} currency={summary.definition.currency} />
            ) : (
              <p className="text-sm text-[var(--text-tertiary)]">
                Fair value range unavailable — not enough compatible history yet.
              </p>
            )}
          </div>

          <div className="rounded-md border border-[var(--border)] bg-[var(--panel-raised)] p-3">
            {recommendation ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <RecommendationBadge label={recommendation.label} />
                  <ConfidenceChip level={recommendation.confidence} />
                </div>
                {recommendationSummary && <p className="mt-2 text-sm text-[var(--text-secondary)]">{recommendationSummary}</p>}
              </>
            ) : (
              <p className="text-sm text-[var(--text-tertiary)]">No recommendation available yet.</p>
            )}
            <Link href="/methodology#recommendations" className="mt-2 inline-block text-xs text-[var(--accent)] hover:underline">
              How recommendations are computed
            </Link>
          </div>
        </div>
      </div>
    </Panel>
  );
}
