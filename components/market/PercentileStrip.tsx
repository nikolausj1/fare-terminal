import { PERCENTILE_QUARTILE_TICKS, percentileMarkerLeftPct, percentileZone } from './percentileMath';

const ZONE_COLOR: Record<ReturnType<typeof percentileZone>, string> = {
  cheap: 'var(--pos)',
  mid: 'var(--text-secondary)',
  expensive: 'var(--neg)',
};

/** Compact 0-100 axis visualizing "cheaper than X% of comparable
 * observations" (WP-F4 §4). Purely decorative (aria-hidden) — the caller
 * keeps the existing prose sentence as the accessible text, so this never
 * duplicates content for screen readers. Skip rendering entirely when
 * percentile is null (handled by the caller, matching every other
 * null-history state on this page). */
export function PercentileStrip({ percentile }: { percentile: number }) {
  const zone = percentileZone(percentile);
  const markerLeft = percentileMarkerLeftPct(percentile);

  return (
    <div aria-hidden="true" className="mt-2 w-full">
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-white/5">
        {/* Expensive (low percentile) -> cheap (high percentile) tint,
            gradient direction matches historicalPercentile's convention:
            higher percentile = cheaper = favorable. */}
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to right, var(--neg-bg), transparent 30%, transparent 70%, var(--pos-bg))' }}
        />
        {PERCENTILE_QUARTILE_TICKS.map((tick) => (
          <div
            key={tick}
            className="absolute top-0 h-full w-px bg-[var(--border-strong)]"
            style={{ left: `${tick}%` }}
          />
        ))}
        <div
          className="absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: markerLeft, backgroundColor: ZONE_COLOR[zone] }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-[var(--text-tertiary)]">
        <span>More expensive</span>
        <span>Cheaper</span>
      </div>
    </div>
  );
}
