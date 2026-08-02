// The Fare Terminal Index hero (WP-F3 deliverable 1): replaces the dead
// space that used to sit at the top of the home page. Purely presentational
// — app/page.tsx fetches getIndexToday()/getIndexSeries() and passes them
// in, so this stays a plain server component (no DB access of its own).
//
// Null-safety: the caller (app/page.tsx) only renders <IndexHero /> when
// getIndexToday() returned non-null — an index with zero data yet omits the
// whole hero rather than rendering a broken/empty one.

import { Disclosure } from '@/components/ui/Disclosure';
import { DeltaTag } from '@/components/ui/StatBlock';
import { formatAbsoluteDate } from '@/lib/format';
import type { IndexPointVM, IndexTodayVM } from '@/lib/markets/index-series';

import { AnimatedNumber } from './AnimatedNumber';
import { PulseDot } from './PulseDot';

/** Below this many daily index_values rows, the series is young enough that
 * day-to-day swings are more about the roster still filling in than an
 * actual market move — flagged explicitly rather than presented as a
 * mature index (WP-F3 spec). */
const MIN_DAYS_FOR_STABLE = 28;

const CHART_WIDTH = 320;
const CHART_HEIGHT = 80;
const CHART_PAD = 4;

function IndexAreaChart({ series }: { series: IndexPointVM[] }) {
  if (series.length < 2) return null;

  const values = series.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const innerW = CHART_WIDTH - CHART_PAD * 2;
  const innerH = CHART_HEIGHT - CHART_PAD * 2;
  const floorY = CHART_HEIGHT - CHART_PAD;

  const points = values.map((v, i) => ({
    x: CHART_PAD + (i / (values.length - 1)) * innerW,
    y: CHART_PAD + innerH - ((v - min) / range) * innerH,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${floorY} L${points[0].x.toFixed(1)},${floorY} Z`;

  const direction = values[values.length - 1] - values[0];
  const colorVar = direction < 0 ? '--pos' : direction > 0 ? '--neg' : '--text-secondary';

  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      preserveAspectRatio="none"
      className="h-16 w-full sm:h-20"
      aria-hidden="true"
    >
      <path d={areaPath} fill={`var(${colorVar})`} fillOpacity="0.14" stroke="none" />
      <path d={linePath} fill="none" stroke={`var(${colorVar})`} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IndexHero({ today, series }: { today: IndexTodayVM; series: IndexPointVM[] }) {
  const isCalibrating = series.length < MIN_DAYS_FOR_STABLE;
  const latestDate = series.length > 0 ? series[series.length - 1].date : null;
  const todayKey = new Date().toISOString().slice(0, 10);
  const isFresh = latestDate === todayKey;

  return (
    <section
      aria-labelledby="index-heading"
      className="flex flex-col gap-4 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="index-heading" className="text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          Fare Terminal Index
        </h2>
        <div className="flex items-center gap-2">
          {isFresh && <PulseDot />}
          {isCalibrating && (
            <span className="inline-flex items-center rounded-full border border-[var(--warn)]/40 bg-[var(--warn-bg)] px-2 py-0.5 text-xs font-medium text-[var(--warn)]">
              Calibrating — early data
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <AnimatedNumber
            value={today.value}
            format={{ kind: 'decimal', digits: 1 }}
            className="num text-4xl font-bold text-[var(--text-primary)] sm:text-5xl"
          />
          <div className="flex flex-wrap items-center gap-3">
            {today.changePct1d !== null && (
              <span className="inline-flex items-center gap-1.5">
                <span className="text-xs text-[var(--text-tertiary)]">1d</span>
                <DeltaTag pct={today.changePct1d} favorableWhen="down" />
              </span>
            )}
            {today.changePct7d !== null && (
              <span className="inline-flex items-center gap-1.5">
                <span className="text-xs text-[var(--text-tertiary)]">7d</span>
                <DeltaTag pct={today.changePct7d} favorableWhen="down" />
              </span>
            )}
          </div>
        </div>
        <div className="w-full sm:max-w-xs sm:flex-1">
          <IndexAreaChart series={series} />
        </div>
      </div>

      <p className="text-xs text-[var(--text-tertiary)]">
        Composition changes (new routes joining the tracked roster) can move the index more than the market itself
        does.
        {latestDate && ` Last updated ${formatAbsoluteDate(Date.parse(`${latestDate}T00:00:00.000Z`))}.`}
      </p>

      <Disclosure summary="Methodology">
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{today.methodologyNote}</p>
      </Disclosure>
    </section>
  );
}
