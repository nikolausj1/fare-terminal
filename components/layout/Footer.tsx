import Link from 'next/link';

import type { DataSourceMode } from '@/lib/markets/view-models';

const FOOTER_DATA_LINE: Record<DataSourceMode, string> = {
  DEMO: 'Synthetic demo data. Not financial, travel, or booking advice',
  AGGREGATED_CACHED:
    'Cached, aggregated market observations — not live quotes. Not financial, travel, or booking advice',
  MIXED: 'Data integrity issue: mixed demo and real data. Not financial, travel, or booking advice',
};

/** `mode` is optional so this still renders sensibly if ever used outside
 * the root layout (e.g. a test harness) without a DB-derived mode on hand —
 * defaults to the old unconditional demo-leaning copy in that case. */
export function Footer({ mode }: { mode?: DataSourceMode }) {
  const dataLine = FOOTER_DATA_LINE[mode ?? 'DEMO'];
  return (
    <footer className="border-t border-[var(--border)] py-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 text-xs text-[var(--text-tertiary)] sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          {dataLine} — see the{' '}
          <Link href="/methodology" className="text-[var(--accent)] hover:underline">
            methodology
          </Link>{' '}
          and{' '}
          <Link href="/about" className="text-[var(--accent)] hover:underline">
            about
          </Link>{' '}
          pages.
        </p>
        <a
          href="https://github.com/nikolausj1/fare-terminal"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--accent)] hover:underline"
        >
          GitHub
        </a>
      </div>
    </footer>
  );
}
