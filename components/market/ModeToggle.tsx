'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { cn } from '@/lib/format';
import { buildMarketUrl, type MarketUrlState } from '@/lib/url-state';

/** Flexible/Exact mode toggle. Switching to Exact opens a small inline date
 * form; submitting (or switching back to Flexible) updates the URL, which
 * re-renders the server page with the new search_definition lookup. */
export function ModeToggle({
  origin,
  destination,
  current,
}: {
  origin: string;
  destination: string;
  current: MarketUrlState;
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(current.mode === 'exact');
  const [depart, setDepart] = useState(current.depart ?? '');
  const [returnDate, setReturnDate] = useState(current.return ?? '');

  function goFlexible() {
    setShowForm(false);
    router.push(buildMarketUrl(origin, destination, { mode: 'flexible' }));
  }

  function submitExact(e: React.FormEvent) {
    e.preventDefault();
    if (!depart) return;
    router.push(
      buildMarketUrl(origin, destination, { mode: 'exact', depart, ...(returnDate ? { return: returnDate } : {}) })
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="inline-flex rounded-md border border-[var(--border-strong)] p-0.5 text-sm" role="group" aria-label="Benchmark mode">
        <button
          type="button"
          aria-pressed={current.mode === 'flexible'}
          onClick={goFlexible}
          className={cn(
            'rounded px-3 py-1 font-medium',
            current.mode === 'flexible' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)]'
          )}
        >
          Flexible benchmark
        </button>
        <button
          type="button"
          aria-pressed={current.mode === 'exact'}
          onClick={() => setShowForm(true)}
          className={cn(
            'rounded px-3 py-1 font-medium',
            current.mode === 'exact' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)]'
          )}
        >
          Exact dates
        </button>
      </div>

      {showForm && (
        <form onSubmit={submitExact} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-xs text-[var(--text-secondary)]">
            Depart
            <input
              type="date"
              required
              value={depart}
              onChange={(e) => setDepart(e.target.value)}
              className="mt-0.5 rounded border border-[var(--border-strong)] bg-[var(--panel-raised)] px-2 py-1 text-sm text-[var(--text-primary)]"
            />
          </label>
          <label className="flex flex-col text-xs text-[var(--text-secondary)]">
            Return (optional)
            <input
              type="date"
              value={returnDate}
              onChange={(e) => setReturnDate(e.target.value)}
              className="mt-0.5 rounded border border-[var(--border-strong)] bg-[var(--panel-raised)] px-2 py-1 text-sm text-[var(--text-primary)]"
            />
          </label>
          <button type="submit" className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90">
            Apply
          </button>
        </form>
      )}
    </div>
  );
}
