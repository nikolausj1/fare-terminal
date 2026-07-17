import { DeltaTag } from '@/components/ui/StatBlock';
import { Panel, EmptyState } from '@/components/ui/Panel';
import { formatRelativeTime } from '@/lib/format';
import type { MarketEventVM, MarketSummaryVM } from '@/lib/markets/view-models';

/** "What changed" panel: the latest benchmark/offer-count deltas plus the
 * two most recent events. MarketSummaryVM doesn't expose an offer-count
 * delta or a carrier-entered/left-low-set diff directly (only the current
 * snapshot's validOfferCount) — those signals are derived here from the
 * most recent MarketEventVM entries instead, since OFFER_COUNT_SURGE/
 * CONTRACTION and CARRIER_ENTERED/LEFT_LOW_SET events already carry that
 * story in their observedFacts. */
export function WhatChangedPanel({ summary, recentEvents }: { summary: MarketSummaryVM; recentEvents: MarketEventVM[] }) {
  const latestTwo = recentEvents.slice(0, 2);

  return (
    <Panel title="What changed" titleId="what-changed-title">
      <div className="flex flex-wrap gap-6">
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">Benchmark, 24h</span>
          <div className="mt-1">
            {summary.change?.pct24h !== null && summary.change?.pct24h !== undefined ? (
              <DeltaTag pct={summary.change.pct24h} favorableWhen="down" />
            ) : (
              <span className="text-sm text-[var(--text-tertiary)]">No comparable snapshot</span>
            )}
          </div>
        </div>
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">Valid offers now</span>
          <div className="num mt-1 text-sm font-semibold text-[var(--text-primary)]">{summary.snapshot.validOfferCount}</div>
        </div>
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">Carriers now</span>
          <div className="num mt-1 text-sm font-semibold text-[var(--text-primary)]">{summary.snapshot.carrierCount}</div>
        </div>
      </div>

      <div className="mt-4">
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">Most recent events</span>
        {latestTwo.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-2">
            {latestTwo.map((e) => (
              <li key={e.id} className="rounded-md border border-[var(--border)] bg-[var(--panel-raised)] p-2.5 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-[var(--text-primary)]">{e.label}</span>
                  <span className="text-xs text-[var(--text-tertiary)]">{formatRelativeTime(e.eventStartAt)}</span>
                </div>
                {e.observedFacts[0] && <p className="mt-1 text-[var(--text-secondary)]">{e.observedFacts[0]}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-2">
            <EmptyState message="No recent events." />
          </div>
        )}
      </div>
    </Panel>
  );
}
