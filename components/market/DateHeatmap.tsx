'use client';

import { useRef, useState, type KeyboardEvent } from 'react';

import { EmptyState } from '@/components/ui/Panel';
import { cn, formatPriceMinor } from '@/lib/format';
import type { HeatmapMonthVM } from '@/lib/markets/heatmap';

import { heatmapVisibleStats, priceToHeatmapColor } from './dateHeatmapMath';

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function parseMonthKey(month: string): { year: number; monthIndex0: number } {
  const [year, m] = month.split('-').map(Number);
  return { year, monthIndex0: m - 1 };
}

/** Weekday (0=Sun) of the 1st of `month`, i.e. how many empty leading cells
 * a 7-column grid needs before day 1. UTC throughout — calendar_prices'
 * depart_date is a plain YYYY-MM-DD with no timezone attached, so the grid
 * treats it as a calendar date, not a timezone-relative instant. */
function leadingBlankCount(month: string): number {
  const { year, monthIndex0 } = parseMonthKey(month);
  return new Date(Date.UTC(year, monthIndex0, 1)).getUTCDay();
}

function monthLabel(month: string): string {
  const { year, monthIndex0 } = parseMonthKey(month);
  return new Date(Date.UTC(year, monthIndex0, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function dayOfMonth(date: string): string {
  // date is YYYY-MM-DD — slice instead of `new Date(date)` to avoid any
  // timezone-shift surprise on a plain calendar date.
  return String(Number(date.slice(8, 10)));
}

/** Today as a YYYY-MM-DD string, UTC — decorative only (marks "today" on
 * the grid), so an off-by-one against the viewer's local calendar day near
 * midnight is an acceptable trade-off for staying consistent with how
 * every date in this component is otherwise treated (UTC calendar dates,
 * no timezone conversion). */
function todayDateString(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function transfersLabel(transfers: number | null): string {
  if (transfers === null) return '';
  if (transfers === 0) return ', nonstop';
  return `, ${transfers} stop${transfers === 1 ? '' : 's'}`;
}

function MonthGrid({
  monthVM,
  min,
  max,
  currency,
  today,
}: {
  monthVM: HeatmapMonthVM;
  min: number;
  max: number;
  currency: string;
  today: string;
}) {
  const { days } = monthVM;
  const [activeIndex, setActiveIndex] = useState(0);
  const cellRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const label = monthLabel(monthVM.month);

  function focusIndex(next: number) {
    const clamped = Math.min(days.length - 1, Math.max(0, next));
    setActiveIndex(clamped);
    cellRefs.current[clamped]?.focus();
  }

  // Roving tabindex per grid (PRD §14.8 keyboard-nav requirement): only the
  // active cell is in the tab order; arrow keys move focus (and the active
  // index) within this month's 7-wide grid, Home/End jump to the first/last
  // day. Movement never crosses into an adjacent month's grid.
  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        focusIndex(i + 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        focusIndex(i - 1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        focusIndex(i + 7);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusIndex(i - 7);
        break;
      case 'Home':
        e.preventDefault();
        focusIndex(0);
        break;
      case 'End':
        e.preventDefault();
        focusIndex(days.length - 1);
        break;
      default:
        break;
    }
  }

  const leading = leadingBlankCount(monthVM.month);

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{label}</h3>
        <span className="text-xs text-[var(--text-tertiary)]">{monthVM.coveragePct}% observed</span>
      </div>
      <div role="grid" aria-label={`${label} fare calendar`} className="grid grid-cols-7 gap-1">
        {WEEKDAY_LABELS.map((w) => (
          <div
            key={w}
            aria-hidden="true"
            className="pb-1 text-center text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]"
          >
            {w}
          </div>
        ))}
        {Array.from({ length: leading }, (_, i) => (
          <div key={`blank-${i}`} aria-hidden="true" />
        ))}
        {days.map((day, i) => {
          const isToday = day.date === today;
          const isObserved = day.cellState === 'OBSERVED' && day.priceMinor !== null;
          const nonstop = isObserved && day.transfers === 0;
          const dayNum = dayOfMonth(day.date);
          const priceLabel = isObserved ? formatPriceMinor(day.priceMinor as number, currency) : null;
          const ariaLabel = isObserved
            ? `${label} ${dayNum}: ${priceLabel}${transfersLabel(day.transfers)}${isToday ? ' — today' : ''}`
            : `${label} ${dayNum}: no data${isToday ? ' — today' : ''}`;

          return (
            <button
              key={day.date}
              type="button"
              ref={(el) => {
                cellRefs.current[i] = el;
              }}
              tabIndex={i === activeIndex ? 0 : -1}
              onKeyDown={(e) => onKeyDown(e, i)}
              onFocus={() => setActiveIndex(i)}
              role="gridcell"
              aria-label={ariaLabel}
              className={cn(
                'group relative flex aspect-square flex-col items-center justify-center gap-0.5 rounded-md border text-[var(--text-primary)] transition-colors',
                isObserved ? 'border-transparent' : 'border-dashed border-[var(--border)] text-[var(--text-tertiary)]',
                isToday && 'border-2 border-[var(--accent)]',
                nonstop && 'ring-2 ring-inset ring-white/50',
                'focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-[var(--focus-ring)]'
              )}
              style={isObserved ? { backgroundColor: priceToHeatmapColor(day.priceMinor as number, min, max) } : undefined}
            >
              <span aria-hidden="true" className="absolute left-1 top-0.5 text-[9px] text-[var(--text-tertiary)]">
                {dayNum}
              </span>
              {isObserved && (
                <span aria-hidden="true" className="num mt-2 hidden text-[10px] font-semibold leading-none sm:block">
                  {priceLabel}
                </span>
              )}
              {isObserved && day.transfers !== null && day.transfers > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-[var(--text-primary)]/70"
                />
              )}
              {/* Hover/focus tooltip — visible at every breakpoint, unlike
                  the always-on in-cell price text which only fits at sm+. */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded border border-[var(--border-strong)] bg-[var(--panel-raised)] px-2 py-1 text-[10px] font-normal text-[var(--text-primary)] opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              >
                {label.split(' ')[0]} {dayNum}
                {isObserved ? ` — ${priceLabel}${transfersLabel(day.transfers)}` : ' — no data'}
                {isToday ? ' (today)' : ''}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Date-price heatmap (PRD §14.8, WP-F4 §2): month grids for the current
 * month + `months.length - 1` ahead (server passes getCalendarHeatmap's
 * default 3 — current + next 2 — per PRD's "current + next 2 months"
 * heatmap-gappiness verdict). `now` marks "today" on the grid — required
 * (not defaulted via `Date.now()`, an impure call React's purity rules
 * disallow during render) and passed down from the server, matching how
 * OfferTable takes `nowMs` from the page rather than reading the wall
 * clock itself. */
export function DateHeatmap({
  months,
  currency,
  now,
}: {
  months: HeatmapMonthVM[];
  currency: string;
  now: number;
}) {
  const stats = heatmapVisibleStats(months);

  if (!stats) {
    return (
      <EmptyState message="Calendar data is still being collected for this route (fills in within ~24h)." />
    );
  }

  const today = todayDateString(now);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: priceToHeatmapColor(stats.minMinor, stats.minMinor, stats.maxMinor, 0.75) }} />
          Cheapest observed: <span className="num text-[var(--text-primary)]">{formatPriceMinor(stats.minMinor, currency)}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: priceToHeatmapColor(stats.medianMinor, stats.minMinor, stats.maxMinor, 0.75) }} />
          Median: <span className="num text-[var(--text-primary)]">{formatPriceMinor(stats.medianMinor, currency)}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: priceToHeatmapColor(stats.maxMinor, stats.minMinor, stats.maxMinor, 0.75) }} />
          Priciest observed: <span className="num text-[var(--text-primary)]">{formatPriceMinor(stats.maxMinor, currency)}</span>
        </span>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        {months.map((m) => (
          <MonthGrid key={m.month} monthVM={m} min={stats.minMinor} max={stats.maxMinor} currency={currency} today={today} />
        ))}
      </div>

      <p className="mt-4 text-xs text-[var(--text-tertiary)]">
        Observed cached fares; blank days have no recent observation — not necessarily unavailable.
      </p>
    </div>
  );
}
