// Persistent, unobtrusive top-of-page banner disclosing what kind of data
// the current deployment is actually showing. Server component — the mode
// comes from lib/markets/queries.ts#getDataSourceMode(), which derives it
// from the DB's actual search_runs.provider_id values (never from an env
// var), so this banner can never claim "demo" over real data or vice versa.
// Pass `mode` explicitly to override when a page already has it from a
// fetched VM (keeps a single source of truth per request instead of a
// second DB round trip — see lib/markets/queries.ts's React `cache()` note).
//
// WP-C: previously this only ever rendered the demo copy unconditionally.
// Now there are three data source modes (DataSourceMode in
// lib/markets/view-models.ts) and each gets its own honest disclosure.
import type { DataSourceMode } from '@/lib/markets/view-models';
import { getDataSourceMode } from '@/lib/markets/queries';

const BANNER_COPY: Record<DataSourceMode, { text: string; className: string } | null> = {
  DEMO: {
    text: 'Synthetic demo data. Not current airfare.',
    className: 'bg-[var(--warn-bg)] text-[var(--warn)]',
  },
  AGGREGATED_CACHED: {
    text: 'Prices are cached market observations (up to ~48h old), not live quotes. Verify before booking.',
    className: 'bg-[var(--warn-bg)] text-[var(--warn)]',
  },
  // Tripwire: demo and real provider_ids should never coexist in the same
  // DB (separate DB files by design). If this ever renders, it means a
  // data-integrity bug let synthetic and real observations mix — surfaced
  // loudly rather than silently averaged/compared together.
  MIXED: {
    text: 'Data integrity issue: mixed demo and real observations. Do not trust comparisons.',
    className: 'bg-[var(--neg-bg)] text-[var(--neg)] font-semibold',
  },
};

export function DemoBanner({ mode }: { mode?: DataSourceMode }) {
  const resolved = mode ?? getDataSourceMode();
  const copy = BANNER_COPY[resolved];
  if (!copy) return null;

  return (
    <div
      role={resolved === 'MIXED' ? 'alert' : undefined}
      className={`border-b border-[var(--border)] px-4 py-1.5 text-center text-xs font-medium ${copy.className}`}
    >
      {copy.text}
      {resolved === 'AGGREGATED_CACHED' && (
        <>
          {' '}
          <a href="/methodology#data-freshness" className="underline hover:no-underline">
            Learn more
          </a>
          .
        </>
      )}
    </div>
  );
}
