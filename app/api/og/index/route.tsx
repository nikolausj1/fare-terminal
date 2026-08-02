// GET /api/og/index — 1200x630 PNG share card for the Fare Terminal Index
// (jobs/index-series.ts / lib/markets/index-series.ts): index value + 90-day
// sparkline. Same runtime/DB-tracing constraints as
// app/api/og/market/[origin]/[destination]/route.tsx — see that file's
// header comment.

import { ImageResponse } from 'next/og';

import { formatAbsoluteDate, formatSignedPct, priceChangeVisual } from '@/lib/format';
import { getIndexSeries, getIndexToday } from '@/lib/markets/index-series';
import { getDatasetAnchor } from '@/lib/markets/queries';
import { OG_COLORS, sparklinePathD } from '@/lib/markets/share';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const SPARK_W = 1072;
const SPARK_H = 160;

export async function GET() {
  const today = getIndexToday();
  const dateLabel = formatAbsoluteDate(getDatasetAnchor());

  if (!today) {
    return new ImageResponse(
      (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            height: '100%',
            backgroundColor: OG_COLORS.bg,
            padding: '56px 64px 40px',
            fontFamily: 'sans-serif',
          }}
        >
          <div style={{ display: 'flex', fontSize: 24, fontWeight: 700, letterSpacing: 2, color: OG_COLORS.textSecondary }}>
            FARE TERMINAL INDEX
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center', gap: 20 }}>
            <div
              style={{
                display: 'flex',
                fontSize: 30,
                color: OG_COLORS.warn,
                border: `1px solid ${OG_COLORS.warn}`,
                borderRadius: 8,
                padding: '14px 20px',
                maxWidth: 900,
              }}
            >
              Index not available yet — insufficient roster coverage.
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              width: '100%',
              justifyContent: 'space-between',
              borderTop: `1px solid ${OG_COLORS.border}`,
              paddingTop: 20,
            }}
          >
            <div style={{ display: 'flex', fontSize: 20, color: OG_COLORS.textTertiary }}>fare-terminal.vercel.app</div>
            <div style={{ display: 'flex', fontSize: 20, color: OG_COLORS.textTertiary }}>Cached market data · {dateLabel}</div>
          </div>
        </div>
      ),
      size
    );
  }

  const series = getIndexSeries(90);
  const values = series.map((p) => p.value);
  const pathD = values.length >= 2 ? sparklinePathD(values, SPARK_W, SPARK_H, 12) : null;

  const visual1d = today.changePct1d !== null ? priceChangeVisual(today.changePct1d) : null;
  const color1d = visual1d
    ? visual1d.colorVar === '--pos'
      ? OG_COLORS.pos
      : visual1d.colorVar === '--neg'
        ? OG_COLORS.neg
        : OG_COLORS.textSecondary
    : OG_COLORS.textTertiary;

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          backgroundColor: OG_COLORS.bg,
          padding: '56px 64px 40px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', width: 14, height: 14, borderRadius: 3, backgroundColor: OG_COLORS.accent }} />
          <div style={{ display: 'flex', fontSize: 24, fontWeight: 700, letterSpacing: 2, color: OG_COLORS.textSecondary }}>
            FARE TERMINAL INDEX
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center', gap: 24 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 32 }}>
            <div style={{ display: 'flex', fontSize: 140, fontWeight: 700, color: OG_COLORS.textPrimary, lineHeight: 1 }}>
              {today.value.toFixed(1)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 20 }}>
              <div style={{ display: 'flex', fontSize: 20, color: OG_COLORS.textSecondary }}>vs. prior day</div>
              <div style={{ display: 'flex', fontSize: 34, fontWeight: 600, color: color1d }}>
                {visual1d ? `${visual1d.glyph} ${formatSignedPct(today.changePct1d as number)}` : '—'}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', fontSize: 26, color: OG_COLORS.textSecondary }}>
            Average of each tracked route&apos;s benchmark vs. its own trailing 28-day median, rebased to 100.
          </div>

          {pathD && (
            <svg width={SPARK_W} height={SPARK_H} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} style={{ display: 'flex' }}>
              <path d={pathD} fill="none" stroke={OG_COLORS.accent} strokeWidth={4} />
            </svg>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            width: '100%',
            justifyContent: 'space-between',
            borderTop: `1px solid ${OG_COLORS.border}`,
            paddingTop: 20,
          }}
        >
          <div style={{ display: 'flex', fontSize: 20, color: OG_COLORS.textTertiary }}>fare-terminal.vercel.app</div>
          <div style={{ display: 'flex', fontSize: 20, color: OG_COLORS.textTertiary }}>Cached market data · {dateLabel}</div>
        </div>
      </div>
    ),
    size
  );
}
