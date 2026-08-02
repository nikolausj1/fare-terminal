// Read layer for the date-price heatmap (PRD §14.8, P1), built on top of
// calendar_prices (populated by jobs/heatmap.ts from /v2/prices/
// month-matrix — see that job's and db/schema.ts's doc comments for why
// this table, not offer_observations, is the heatmap's data source).
//
// NEW FILE per WP-F2 scope — additions only, no changes to
// lib/markets/queries.ts or view-models.ts (a different WP is concurrently
// fixing bugs there). This is the Wave-2 UI contract for the heatmap.

import { and, asc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { calendarPrices } from '@/db/schema';

/** One calendar-day cell in the heatmap. `cellState` is the PRD §14.8
 * honesty label: 'OBSERVED' when calendar_prices has a real cached price
 * for this exact day, 'NO_DATA' otherwise — there is no 'Modeled'/'Cached'
 * distinction here because month-matrix cells are always a genuine cache
 * observation when present at all (see the audit's heatmap-gappiness
 * verdict: dense near-term, gappy further out, never estimated/synthetic). */
export interface HeatmapDayCellVM {
  date: string; // YYYY-MM-DD
  priceMinor: number | null;
  transfers: number | null;
  observedAt: number | null;
  cellState: 'OBSERVED' | 'NO_DATA';
}

export interface HeatmapMonthVM {
  month: string; // YYYY-MM
  days: HeatmapDayCellVM[];
  /** Percent of this month's calendar days that have an OBSERVED cell,
   * rounded to the nearest whole percent — the number the audit's
   * heatmap-gappiness verdict reports (e.g. "29/30 days priced (97%)"). */
  coveragePct: number;
}

function daysInMonth(year: number, monthIndex0: number): number {
  // Day 0 of the next month = the last day of this month.
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

function monthKey(year: number, monthIndex0: number): string {
  return `${year}-${String(monthIndex0 + 1).padStart(2, '0')}`;
}

/**
 * Returns up to `monthsAhead` months of heatmap data for `origin` ->
 * `destination`, starting with the current UTC calendar month. Every
 * calendar day in each month gets a cell — days with no matching
 * calendar_prices row render as `cellState: 'NO_DATA'` (priceMinor/
 * transfers/observedAt all null) rather than being omitted, so the UI can
 * render a complete grid and label gaps honestly instead of silently
 * skipping them (PRD §14.8).
 *
 * Origin/destination are matched exactly against calendar_prices.origin/
 * destination (uppercased) — these are the airport codes jobs/heatmap.ts
 * queried month-matrix with, not the source's own (sometimes city-level)
 * fields; see extras.ts's mapMonthMatrix doc comment.
 *
 * `now` is injectable (defaults to Date.now()) purely for deterministic
 * tests — see tests/integration/wp-f2.test.ts — production callers should
 * never pass it.
 */
export function getCalendarHeatmap(
  origin: string,
  destination: string,
  monthsAhead = 3,
  now: number = Date.now()
): HeatmapMonthVM[] {
  const originCode = origin.toUpperCase();
  const destCode = destination.toUpperCase();

  const rows = db
    .select()
    .from(calendarPrices)
    .where(and(eq(calendarPrices.origin, originCode), eq(calendarPrices.destination, destCode)))
    .orderBy(asc(calendarPrices.departDate))
    .all();

  const byDate = new Map(rows.map((row) => [row.departDate, row]));

  const nowDate = new Date(now);
  const startYear = nowDate.getUTCFullYear();
  const startMonthIndex0 = nowDate.getUTCMonth();

  const months: HeatmapMonthVM[] = [];
  for (let offset = 0; offset < monthsAhead; offset++) {
    const totalMonthIndex0 = startMonthIndex0 + offset;
    const year = startYear + Math.floor(totalMonthIndex0 / 12);
    const monthIndex0 = ((totalMonthIndex0 % 12) + 12) % 12;
    const totalDays = daysInMonth(year, monthIndex0);
    const month = monthKey(year, monthIndex0);

    let observedCount = 0;
    const days: HeatmapDayCellVM[] = [];
    for (let day = 1; day <= totalDays; day++) {
      const date = `${month}-${String(day).padStart(2, '0')}`;
      const row = byDate.get(date);
      if (row) {
        observedCount += 1;
        days.push({
          date,
          priceMinor: row.priceMinor,
          transfers: row.transfers,
          observedAt: row.observedAt,
          cellState: 'OBSERVED',
        });
      } else {
        days.push({ date, priceMinor: null, transfers: null, observedAt: null, cellState: 'NO_DATA' });
      }
    }

    months.push({
      month,
      days,
      coveragePct: totalDays > 0 ? Math.round((observedCount / totalDays) * 100) : 0,
    });
  }

  return months;
}
