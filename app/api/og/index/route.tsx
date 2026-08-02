// GET /api/og/index — 1200x630 PNG share card for the Fare Terminal Index
// (jobs/index-series.ts / lib/markets/index-series.ts): index value + 90-day
// sparkline. Same runtime/DB-tracing constraints as
// app/api/og/market/[origin]/[destination]/route.tsx — see that file's
// header comment, including the Satori layout notes (every flex container
// declares flexDirection explicitly, longhand padding, fixed content width
// to prevent word-per-line wrapping/overlap).

import { ImageResponse } from 'next/og';
import type { CSSProperties, ReactNode } from 'react';

import { formatAbsoluteDate, formatSignedPct, priceChangeVisual } from '@/lib/format';
import { getIndexSeries, getIndexToday } from '@/lib/markets/index-series';
import { getDatasetAnchor } from '@/lib/markets/queries';
import { OG_COLORS, sparklinePathD } from '@/lib/markets/share';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const CARD_W = 1200;
const CARD_H = 630;
const PAD_X = 64;
const CONTENT_W = CARD_W - PAD_X * 2; // 1072
const SPARK_W = CONTENT_W;
const SPARK_H = 150;

const row: CSSProperties = { display: 'flex', flexDirection: 'row', flexWrap: 'nowrap' };
const column: CSSProperties = { display: 'flex', flexDirection: 'column' };

function Wordmark({ label }: { label: string }) {
  return (
    <div style={{ ...row, height: 34, flexShrink: 0, alignItems: 'center' }}>
      <div
        style={{ ...row, width: 14, height: 14, borderRadius: 3, backgroundColor: OG_COLORS.accent, marginRight: 10 }}
      />
      <div style={{ ...row, fontSize: 24, fontWeight: 700, letterSpacing: 2, color: OG_COLORS.textSecondary }}>
        {label}
      </div>
    </div>
  );
}

function Footer({ dateLabel }: { dateLabel: string }) {
  return (
    <div
      style={{
        ...row,
        height: 58,
        flexShrink: 0,
        width: CONTENT_W,
        justifyContent: 'space-between',
        alignItems: 'center',
        borderTopWidth: 1,
        borderTopStyle: 'solid',
        borderTopColor: OG_COLORS.border,
        paddingTop: 20,
      }}
    >
      <div style={{ ...row, fontSize: 20, color: OG_COLORS.textTertiary }}>fare-terminal.vercel.app</div>
      <div style={{ ...row, fontSize: 20, color: OG_COLORS.textTertiary }}>Cached market data · {dateLabel}</div>
    </div>
  );
}

function baseCard(children: ReactNode) {
  return new ImageResponse(
    (
      <div
        style={{
          ...column,
          width: CARD_W,
          height: CARD_H,
          backgroundColor: OG_COLORS.bg,
          paddingTop: 56,
          paddingBottom: 40,
          paddingLeft: PAD_X,
          paddingRight: PAD_X,
          fontFamily: 'sans-serif',
        }}
      >
        {children}
      </div>
    ),
    size
  );
}

export async function GET() {
  const today = getIndexToday();
  const dateLabel = formatAbsoluteDate(getDatasetAnchor());

  if (!today) {
    return baseCard(
      <>
        <Wordmark label="FARE TERMINAL INDEX" />
        <div style={{ ...column, width: CONTENT_W, flexGrow: 1, minHeight: 0, justifyContent: 'center' }}>
          <div
            style={{
              ...row,
              fontSize: 28,
              lineHeight: 1.4,
              color: OG_COLORS.warn,
              borderWidth: 1,
              borderStyle: 'solid',
              borderColor: OG_COLORS.warn,
              borderRadius: 8,
              paddingTop: 14,
              paddingBottom: 14,
              paddingLeft: 20,
              paddingRight: 20,
              width: 860,
            }}
          >
            Index not available yet — insufficient roster coverage.
          </div>
        </div>
        <Footer dateLabel={dateLabel} />
      </>
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

  return baseCard(
    <>
      <Wordmark label="FARE TERMINAL INDEX" />

      <div style={{ ...column, width: CONTENT_W, flexGrow: 1, justifyContent: 'center' }}>
        <div style={{ ...row, alignItems: 'flex-end', marginBottom: 20 }}>
          <div
            style={{
              ...row,
              fontSize: 136,
              fontWeight: 700,
              color: OG_COLORS.textPrimary,
              lineHeight: 1,
              marginRight: 32,
            }}
          >
            {today.value.toFixed(1)}
          </div>
          <div style={{ ...column, paddingBottom: 18 }}>
            <div style={{ ...row, fontSize: 20, color: OG_COLORS.textSecondary, marginBottom: 6 }}>vs. prior day</div>
            <div style={{ ...row, fontSize: 34, fontWeight: 600, color: color1d, alignItems: 'baseline' }}>
              <span style={{ ...row, marginRight: 6 }}>{visual1d ? visual1d.glyph : '—'}</span>
              <span style={row}>{today.changePct1d !== null ? formatSignedPct(today.changePct1d) : ''}</span>
            </div>
          </div>
        </div>

        <div
          style={{
            ...row,
            fontSize: 24,
            lineHeight: 1.4,
            color: OG_COLORS.textSecondary,
            width: CONTENT_W,
            marginBottom: 20,
          }}
        >
          Average of each tracked route&apos;s benchmark vs. its own trailing 28-day median, rebased to 100.
        </div>

        {pathD ? (
          <svg width={SPARK_W} height={SPARK_H} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} style={{ display: 'flex' }}>
            <path d={pathD} fill="none" stroke={OG_COLORS.accent} strokeWidth={4} />
          </svg>
        ) : (
          <div style={{ ...row, height: SPARK_H }} />
        )}
      </div>

      <Footer dateLabel={dateLabel} />
    </>
  );
}
