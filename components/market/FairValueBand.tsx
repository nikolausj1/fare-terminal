import { formatPriceMinor } from '@/lib/format';
import type { FairValueRange } from '@/domain/history';

/** Pure-CSS horizontal fair-value band with a marker for the current
 * benchmark price. Low/high/center come from domain/history/fairValue.ts
 * (median ± 1.5·MAD by default — see the methodology page for the exact
 * constants). */
export function FairValueBand({
  range,
  currentMinor,
  currency = 'USD',
}: {
  range: FairValueRange;
  currentMinor: number;
  currency?: string;
}) {
  const span = Math.max(range.high - range.low, 1);
  // Give the marker room to render even if the current price sits outside
  // the [low, high] band (still expand the visual domain a bit).
  const domainLow = Math.min(range.low, currentMinor) - span * 0.15;
  const domainHigh = Math.max(range.high, currentMinor) + span * 0.15;
  const domainSpan = Math.max(domainHigh - domainLow, 1);

  const pct = (v: number) => `${(((v - domainLow) / domainSpan) * 100).toFixed(2)}%`;

  return (
    <div className="w-full">
      <div className="relative h-3 w-full rounded-full bg-white/5">
        <div
          className="absolute inset-y-0 rounded-full bg-[var(--accent-bg)]"
          style={{ left: pct(range.low), right: `${100 - parseFloat(pct(range.high))}%` }}
          aria-hidden="true"
        />
        <div
          className="absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--text-primary)]"
          style={{ left: pct(currentMinor) }}
          role="img"
          aria-label={`Current benchmark ${formatPriceMinor(currentMinor, currency)}, fair value range ${formatPriceMinor(range.low, currency)} to ${formatPriceMinor(range.high, currency)}`}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-[var(--text-tertiary)]">
        <span className="num">{formatPriceMinor(range.low, currency)}</span>
        <span className="num text-[var(--text-secondary)]">fair value</span>
        <span className="num">{formatPriceMinor(range.high, currency)}</span>
      </div>
    </div>
  );
}
