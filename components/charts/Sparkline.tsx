// Tiny inline-SVG trend line for route cards (WP-F3). Deliberately not
// Recharts — this renders dozens of times per page (every home-page card),
// and a bare <svg><polyline> is a handful of bytes with zero client JS,
// versus mounting a full chart runtime per card. No axes, no ticks: this is
// a glance-level "shape of the trend" indicator, not a readable chart (the
// full history chart on the market detail page — components/charts/
// PriceHistoryChart.tsx — is owned separately and does that job).
//
// Server-renderable: no 'use client', no hooks, so it can render inside a
// server component (e.g. components/market/MarketCard.tsx) with zero
// hydration cost.

import { cn } from '@/lib/format';

const WIDTH = 120;
const HEIGHT = 36;
const PADDING = 3;

export interface SparklineProps {
  /** Chronological (oldest first) series of values, e.g. benchmark prices in
   * minor units. Renders nothing (null) when fewer than 2 points — a single
   * point has no trend to draw. */
  values: number[] | null | undefined;
  /** Prefix for the accessible text alternative, e.g. "30-day" ->
   * "30-day trend: down 4%". */
  label?: string;
  className?: string;
}

/** A price DROP is user-favorable, so a downward trend renders green and an
 * upward trend renders red — same inverted convention as
 * lib/format.ts#priceChangeVisual, applied to the sparkline's first-vs-last
 * value rather than a single 24h delta. */
function trendDirection(first: number, last: number): 'up' | 'down' | 'flat' {
  if (last === first) return 'flat';
  return last > first ? 'up' : 'down';
}

export function Sparkline({ values, label = '30-day', className }: SparklineProps) {
  if (!values || values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const innerW = WIDTH - PADDING * 2;
  const innerH = HEIGHT - PADDING * 2;

  const points = values.map((v, i) => ({
    x: PADDING + (i / (values.length - 1)) * innerW,
    y: PADDING + innerH - ((v - min) / range) * innerH,
  }));

  const first = values[0];
  const last = values[values.length - 1];
  const direction = trendDirection(first, last);
  const colorVar = direction === 'down' ? '--pos' : direction === 'up' ? '--neg' : '--text-secondary';
  const pctChange = first !== 0 ? ((last - first) / first) * 100 : 0;

  const pointsAttr = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const lastPoint = points[points.length - 1];

  const altText =
    direction === 'flat'
      ? `${label} trend: flat`
      : `${label} trend: ${direction} ${Math.abs(pctChange).toFixed(0)}%`;

  return (
    <span className={cn('inline-flex items-center', className)}>
      <svg
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        aria-hidden="true"
        className="overflow-visible"
      >
        <polyline
          points={pointsAttr}
          fill="none"
          stroke={`var(${colorVar})`}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={lastPoint.x} cy={lastPoint.y} r={2} fill={`var(${colorVar})`} />
      </svg>
      <span className="sr-only">{altText}</span>
    </span>
  );
}
