'use client';

import { useMemo, useState } from 'react';

import { ConfidenceChip, SeverityChip } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/Panel';
import { cn, EVENT_CATEGORIES, EVENT_CATEGORY, formatAbsoluteTime, formatRelativeTime } from '@/lib/format';
import type { MarketEventVM } from '@/lib/markets/view-models';

const CATEGORY_OPTIONS = ['All', ...EVENT_CATEGORIES] as const;
type CategoryFilter = (typeof CATEGORY_OPTIONS)[number];

function episodeDuration(startAt: number, endAt: number | null): string {
  const minutes = Math.round((endAt! - startAt) / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** Chronological event list with category filter chips + a severity toggle
 * (MEDIUM+HIGH shown by default; LOW events behind "Show minor events").
 * Receives the full event list as a prop (fetched server-side by the page)
 * and filters client-side — no extra network round trip needed for a
 * dataset this small. */
/** Timeline items shown initially; the rest sit behind "Show earlier
 * events" so a market with months of history doesn't render a wall. */
const INITIAL_VISIBLE = 20;

export function EventTimeline({ events }: { events: MarketEventVM[] }) {
  const [category, setCategory] = useState<CategoryFilter>('All');
  const [showMinor, setShowMinor] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const matching = useMemo(() => {
    return events.filter((e) => {
      if (category !== 'All' && EVENT_CATEGORY[e.eventType] !== category) return false;
      if (!showMinor && e.severity === 'LOW') return false;
      return true;
    });
  }, [events, category, showMinor]);

  const filtered = showAll ? matching : matching.slice(0, INITIAL_VISIBLE);
  const hiddenCount = matching.length - filtered.length;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter events by category">
        {CATEGORY_OPTIONS.map((opt) => (
          <button
            key={opt}
            type="button"
            aria-pressed={category === opt}
            onClick={() => setCategory(opt)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-xs font-medium',
              category === opt
                ? 'border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent)]'
                : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
            )}
          >
            {opt}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={showMinor}
          onClick={() => setShowMinor((s) => !s)}
          className={cn(
            'ml-auto rounded-full border px-2.5 py-1 text-xs font-medium',
            showMinor
              ? 'border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent)]'
              : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
          )}
        >
          {showMinor ? 'Hide minor events' : 'Show minor events'}
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="mt-3">
          <EmptyState message={category === 'All' ? 'No events match the current filters.' : `No ${category.toLowerCase()} events match the current filters.`} />
        </div>
      ) : (
        <ol className="mt-3 flex flex-col gap-3">
          {filtered.map((e) => (
            <li
              key={e.id}
              id={`event-${e.id}`}
              tabIndex={-1}
              className="scroll-mt-24 rounded-md border border-[var(--border)] bg-[var(--panel-raised)] p-3 focus:outline-2 focus:outline-[var(--focus-ring)]"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-[var(--border-strong)] px-2 py-0.5 text-xs font-medium text-[var(--text-secondary)]">
                  {e.label}
                </span>
                <SeverityChip severity={e.severity} />
                <span className="ml-auto text-xs text-[var(--text-tertiary)]" title={formatAbsoluteTime(e.eventStartAt)}>
                  {formatRelativeTime(e.eventStartAt)}
                </span>
              </div>

              {e.observedFacts.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-[var(--text-primary)]">
                  {e.observedFacts.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              )}

              {e.inference && (
                <p className="mt-2 flex flex-wrap items-center gap-2 text-sm italic text-[var(--text-secondary)]">
                  <span>
                    <span className="not-italic font-semibold">Inferred:</span> {e.inference.text}
                  </span>
                  <ConfidenceChip level={e.inference.confidence} />
                </p>
              )}

              <div className="mt-2 flex flex-wrap gap-3 text-xs text-[var(--text-tertiary)]">
                <span>{formatAbsoluteTime(e.eventStartAt)}</span>
                {e.eventEndAt && <span>Episode duration: {episodeDuration(e.eventStartAt, e.eventEndAt)}</span>}
              </div>
            </li>
          ))}
        </ol>
      )}

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-3 w-full rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:border-[var(--border-strong)] focus:outline-2 focus:outline-[var(--focus-ring)]"
        >
          Show {hiddenCount} earlier event{hiddenCount === 1 ? '' : 's'}
        </button>
      )}
    </div>
  );
}
