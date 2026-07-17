'use client';

import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';

import { Disclosure } from '@/components/ui/Disclosure';
import { cn, formatAbsoluteDate, formatAbsoluteTime, formatPriceMinor } from '@/lib/format';
import type { HistoryRange } from '@/lib/markets/queries';
import type { HistoryPointVM, MarketEventVM } from '@/lib/markets/view-models';

const RANGES: HistoryRange[] = ['7d', '30d', '90d', 'all'];
const RANGE_LABEL: Record<HistoryRange, string> = { '7d': '7D', '30d': '30D', '90d': '90D', all: 'ALL' };

const SEVERITY_COLOR: Record<'LOW' | 'MEDIUM' | 'HIGH', string> = {
  LOW: 'var(--text-secondary)',
  MEDIUM: 'var(--warn)',
  HIGH: 'var(--neg)',
};

interface ChartRow {
  x: number;
  benchmark: number | null;
  from: number | null;
}

function toChartRows(points: HistoryPointVM[]): ChartRow[] {
  const rows: ChartRow[] = [];
  points.forEach((p, i) => {
    rows.push({ x: p.snapshotAt, benchmark: p.benchmarkPriceMinor, from: p.fromPriceMinor });
    const next = points[i + 1];
    if (p.gapAfter && next) {
      rows.push({ x: (p.snapshotAt + next.snapshotAt) / 2, benchmark: null, from: null });
    }
  });
  return rows;
}

function nearestBenchmark(points: HistoryPointVM[], atMs: number): number | null {
  if (points.length === 0) return null;
  let best = points[0];
  let bestDiff = Math.abs(best.snapshotAt - atMs);
  for (const p of points) {
    const diff = Math.abs(p.snapshotAt - atMs);
    if (diff < bestDiff) {
      best = p;
      bestDiff = diff;
    }
  }
  return best.benchmarkPriceMinor;
}

// Recharts clones/injects active/payload/coordinate/etc. into `content` at
// render time, which a plain JSX element can't statically satisfy — so the
// tooltip content is built as a factory closing over `currency` instead of
// receiving it as a prop (content also accepts a plain render function, per
// recharts' ContentType).
function makeTooltipContent(currency: string) {
  return function CustomTooltip({ active, payload }: TooltipContentProps) {
    if (!active || !payload || payload.length === 0) return null;
    const row = payload[0].payload as ChartRow;
    if (row.benchmark === null) return null;
    return (
      <div className="rounded-md border border-[var(--border-strong)] bg-[var(--panel-raised)] px-3 py-2 text-xs shadow-lg">
        <div className="text-[var(--text-tertiary)]">{formatAbsoluteTime(row.x)}</div>
        <div className="num mt-1 font-semibold text-[var(--text-primary)]">
          Benchmark: {formatPriceMinor(row.benchmark, currency)}
        </div>
        {row.from !== null && (
          <div className="num text-[var(--text-secondary)]">From price: {formatPriceMinor(row.from, currency)}</div>
        )}
      </div>
    );
  };
}

export function PriceHistoryChart({
  origin,
  destination,
  initialPoints,
  events,
  currency,
}: {
  origin: string;
  destination: string;
  initialPoints: HistoryPointVM[];
  events: MarketEventVM[];
  currency: string;
}) {
  const [range, setRange] = useState<HistoryRange>('30d');
  const [points, setPoints] = useState<HistoryPointVM[]>(initialPoints);
  const [loading, setLoading] = useState(false);
  const [showFromPrice, setShowFromPrice] = useState(true);

  async function changeRange(next: HistoryRange) {
    if (next === range) return;
    setRange(next);
    setLoading(true);
    try {
      const res = await fetch(`/api/markets/${origin.toLowerCase()}/${destination.toLowerCase()}/history?range=${next}`);
      if (res.ok) {
        const data = await res.json();
        setPoints(data.points ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  const chartData = useMemo(() => toChartRows(points), [points]);

  const domainStart = points[0]?.snapshotAt;
  const domainEnd = points[points.length - 1]?.snapshotAt;
  const eventMarkers = useMemo(() => {
    if (domainStart === undefined || domainEnd === undefined) return [];
    return events
      .filter((e) => e.eventStartAt >= domainStart && e.eventStartAt <= domainEnd)
      .map((e) => ({ event: e, y: nearestBenchmark(points, e.eventStartAt) }))
      .filter((m): m is { event: MarketEventVM; y: number } => m.y !== null);
  }, [events, points, domainStart, domainEnd]);

  function focusEvent(id: number) {
    const el = document.getElementById(`event-${id}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.focus();
  }

  return (
    <figure aria-label={`Price history chart for ${origin} to ${destination}`} className="m-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-md border border-[var(--border-strong)] p-0.5 text-sm" role="group" aria-label="History range">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={range === r}
              onClick={() => changeRange(r)}
              className={cn(
                'rounded px-2.5 py-1 font-medium',
                range === r ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)]'
              )}
            >
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
          <input type="checkbox" checked={showFromPrice} onChange={(e) => setShowFromPrice(e.target.checked)} />
          Show from price
        </label>
      </div>

      <div className={cn('h-72 w-full transition-opacity', loading && 'opacity-50')} aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="x"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(v) => formatAbsoluteDate(v)}
              stroke="var(--text-tertiary)"
              tick={{ fontSize: 11 }}
            />
            <YAxis
              tickFormatter={(v) => formatPriceMinor(v, currency)}
              stroke="var(--text-tertiary)"
              tick={{ fontSize: 11 }}
              width={70}
            />
            <Tooltip content={makeTooltipContent(currency)} />
            {showFromPrice && (
              <Line
                type="monotone"
                dataKey="from"
                stroke="var(--text-secondary)"
                strokeDasharray="4 3"
                strokeWidth={1.5}
                // Sparser/unevenly-sampled history can produce many
                // gapAfter breaks (see toChartRows), which would otherwise
                // leave isolated points invisible (no connecting segment,
                // no dot) — small dots keep every observed point visible
                // even where it can't be connected to its neighbor.
                dot={{ r: 1.5, strokeWidth: 0, fill: 'var(--text-secondary)' }}
                activeDot={{ r: 3 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
            <Line
              type="monotone"
              dataKey="benchmark"
              stroke="var(--accent)"
              strokeWidth={2}
              dot={{ r: 2, strokeWidth: 0, fill: 'var(--accent)' }}
              activeDot={{ r: 4 }}
              connectNulls={false}
              isAnimationActive={false}
            />
            {eventMarkers.map(({ event, y }) => (
              <ReferenceDot
                key={event.id}
                x={event.eventStartAt}
                y={y}
                r={4}
                fill={SEVERITY_COLOR[event.severity]}
                stroke="var(--panel)"
                strokeWidth={1}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Keyboard-accessible equivalent of the chart's event markers — the
          visual dots above are decorative (aria-hidden); these buttons are
          the real interactive controls, each jumping to and focusing the
          matching entry in the event timeline below. */}
      {eventMarkers.length > 0 && (
        <div className="sr-only">
          <p>Chart events</p>
          <ul>
            {eventMarkers.map(({ event }) => (
              <li key={event.id}>
                <button type="button" onClick={() => focusEvent(event.id)}>
                  {event.label} on {formatAbsoluteDate(event.eventStartAt)}, severity {event.severity.toLowerCase()}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Disclosure summary="View as table" className="mt-3">
        <div className="max-h-64 overflow-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-[var(--text-secondary)]">
                <th scope="col" className="py-1.5 pr-3">
                  Date
                </th>
                <th scope="col" className="py-1.5 pr-3">
                  Benchmark
                </th>
                <th scope="col" className="py-1.5 pr-3">
                  From price
                </th>
                <th scope="col" className="py-1.5">
                  Data quality
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((p, i) => (
                <tr key={i} className="border-b border-[var(--border)]/60 last:border-0">
                  <td className="py-1.5 pr-3">{formatAbsoluteTime(p.snapshotAt)}</td>
                  <td className="num py-1.5 pr-3">{formatPriceMinor(p.benchmarkPriceMinor, currency)}</td>
                  <td className="num py-1.5 pr-3">{formatPriceMinor(p.fromPriceMinor, currency)}</td>
                  <td className="num py-1.5">{p.dataQualityScore.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Disclosure>
    </figure>
  );
}
