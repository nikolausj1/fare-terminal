import { cn, formatAbsoluteTime, formatRelativeTime } from '@/lib/format';

/** Relative time + a stale warning once age exceeds config.freshness.staleAfterMinutes
 * (the caller passes `isStale`, already computed by lib/markets/queries.ts against
 * the dataset anchor — see MarketSummaryVM.freshness). */
export function FreshnessTag({
  ageSeconds,
  isStale,
  asOfMs,
  className,
}: {
  ageSeconds: number;
  isStale: boolean;
  asOfMs: number;
  className?: string;
}) {
  const relative = formatRelativeTime(0, ageSeconds * 1000);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        isStale
          ? 'border-[var(--warn)]/40 bg-[var(--warn-bg)] text-[var(--warn)]'
          : 'border-[var(--border)] bg-white/5 text-[var(--text-secondary)]',
        className
      )}
      title={`Last updated ${formatAbsoluteTime(asOfMs)}`}
    >
      {isStale && <span aria-hidden="true">⚠</span>}
      Last updated {relative}
      {isStale && <span className="font-semibold">— data may be stale</span>}
    </span>
  );
}
