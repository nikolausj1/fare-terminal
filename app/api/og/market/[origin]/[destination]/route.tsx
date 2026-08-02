// GET /api/og/market/[origin]/[destination] — 1200x630 PNG share card for
// one market, dark terminal aesthetic. Uses next/og's ImageResponse
// (Satori), which requires: (a) the "nodejs" runtime, NOT "edge" — Satori
// itself is runtime-agnostic, but this route reads through
// lib/markets/queries.ts -> db/index.ts -> better-sqlite3, a native module
// that does not work in the edge runtime; (b) the DB file traced into the
// serverless function bundle, already covered by next.config.ts's
// outputFileTracingIncludes["/api/**"].
//
// priceReliable=false (WP-F1's "don't publish a $0 benchmark" gate) or an
// untracked route both render a neutral fallback card instead of a bare
// "$0" — never a numeric lie in a social preview.
//
// Satori layout notes (learned the hard way — see git history for the
// broken first pass): Satori does NOT default flexDirection to 'row' the
// way browsers do for `display:flex` — every single flex container here
// declares flexDirection explicitly (never omitted), longhand padding
// (never the `'56px 64px 40px'` shorthand, which Satori mis-applies), and
// every row that can vary in content length gets `flexWrap: 'nowrap'` plus
// either a fixed pixel width or `flexShrink: 0` on its fixed-size children
// so satori can't collapse a sibling to zero width and overlap text.

import { ImageResponse } from 'next/og';
import type { CSSProperties, ReactNode } from 'react';
import { z } from 'zod';

import { formatAbsoluteDate, formatSignedPct, priceChangeVisual } from '@/lib/format';
import { getMarketHistory, getMarketSummary } from '@/lib/markets/queries';
import { OG_COLORS, sparklinePathD } from '@/lib/markets/share';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const paramsSchema = z.object({
  origin: z.string().trim().length(3),
  destination: z.string().trim().length(3),
});

const CARD_W = 1200;
const CARD_H = 630;
const PAD_X = 64;
const CONTENT_W = CARD_W - PAD_X * 2; // 1072
const SPARK_W = CONTENT_W;
const SPARK_H = 120;

const row: CSSProperties = { display: 'flex', flexDirection: 'row', flexWrap: 'nowrap' };
const column: CSSProperties = { display: 'flex', flexDirection: 'column' };

function Wordmark() {
  return (
    <div style={{ ...row, height: 34, flexShrink: 0, alignItems: 'center' }}>
      <div
        style={{
          ...row,
          width: 14,
          height: 14,
          borderRadius: 3,
          backgroundColor: OG_COLORS.accent,
          marginRight: 10,
        }}
      />
      <div style={{ ...row, fontSize: 24, fontWeight: 700, letterSpacing: 2, color: OG_COLORS.textSecondary }}>
        FARE TERMINAL
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

function fallbackCard(routeLabel: string, message: string) {
  const dateLabel = formatAbsoluteDate(Date.now());
  return baseCard(
    <>
      <Wordmark />
      <div style={{ ...column, width: CONTENT_W, flexGrow: 1, minHeight: 0, justifyContent: 'center' }}>
        <div style={{ ...row, fontSize: 64, fontWeight: 700, color: OG_COLORS.textPrimary, marginBottom: 24 }}>
          {routeLabel}
        </div>
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
          {message}
        </div>
      </div>
      <Footer dateLabel={dateLabel} />
    </>
  );
}

function deltaColor(pct: number | null): string {
  if (pct === null) return OG_COLORS.textTertiary;
  const visual = priceChangeVisual(pct);
  if (visual.colorVar === '--pos') return OG_COLORS.pos;
  if (visual.colorVar === '--neg') return OG_COLORS.neg;
  return OG_COLORS.textSecondary;
}

function DeltaBlock({ label, pct }: { label: string; pct: number | null }) {
  const glyphColor = deltaColor(pct);
  const glyph = pct === null ? '—' : priceChangeVisual(pct).glyph;
  const valueText = pct === null ? '' : formatSignedPct(pct);

  return (
    <div style={{ ...column, width: 150, marginRight: 32 }}>
      <div style={{ ...row, fontSize: 20, color: OG_COLORS.textSecondary, marginBottom: 6 }}>{label}</div>
      <div style={{ ...row, fontSize: 32, fontWeight: 600, color: glyphColor, alignItems: 'baseline' }}>
        <span style={{ ...row, marginRight: 6 }}>{glyph}</span>
        <span style={row}>{valueText}</span>
      </div>
    </div>
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ origin: string; destination: string }> }
) {
  const { origin, destination } = await params;
  const parsed = paramsSchema.safeParse({ origin, destination });
  if (!parsed.success) {
    return fallbackCard('Fare Terminal', 'Invalid route.');
  }

  const originCode = parsed.data.origin.toUpperCase();
  const destCode = parsed.data.destination.toUpperCase();
  const routeLabel = `${originCode} → ${destCode}`;

  const summary = getMarketSummary(parsed.data.origin, parsed.data.destination);
  if (!summary) {
    return fallbackCard(routeLabel, 'Not currently a tracked market on Fare Terminal.');
  }
  if (!summary.priceReliable) {
    return fallbackCard(routeLabel, 'Price data unreliable — not enough valid offers in the latest observation.');
  }

  const history = getMarketHistory(summary.definition.slug, '30d');
  const sparkValues = history.map((p) => p.benchmarkPriceMinor);
  const pathD = sparkValues.length >= 2 ? sparklinePathD(sparkValues, SPARK_W, SPARK_H, 10) : null;

  const { snapshot, change, percentile, definition } = summary;
  const dateLabel = formatAbsoluteDate(summary.datasetAnchorAt);
  const priceMajor = Math.round(snapshot.benchmarkPriceMinor / 100);
  const percentileText =
    percentile !== null
      ? `Cheaper than ${percentile.toFixed(0)}% of observed history`
      : `${definition.originCity} to ${definition.destinationCity}`;

  return baseCard(
    <>
      <Wordmark />

      <div style={{ ...column, width: CONTENT_W, flexGrow: 1, minHeight: 0, justifyContent: 'center' }}>
        <div style={{ ...row, fontSize: 56, fontWeight: 700, color: OG_COLORS.textPrimary, marginBottom: 20 }}>
          {routeLabel}
        </div>

        <div style={{ ...row, alignItems: 'flex-end', marginBottom: 16 }}>
          <div
            style={{
              ...row,
              fontSize: 116,
              fontWeight: 700,
              color: OG_COLORS.textPrimary,
              lineHeight: 1,
              marginRight: 40,
            }}
          >
            ${priceMajor.toLocaleString('en-US')}
          </div>
          <div style={{ ...row, paddingBottom: 14 }}>
            <DeltaBlock label="24H" pct={change?.pct24h ?? null} />
            <DeltaBlock label="7D" pct={change?.pct7d ?? null} />
          </div>
        </div>

        <div style={{ ...row, fontSize: 28, color: OG_COLORS.textSecondary, width: CONTENT_W, marginBottom: 20 }}>
          {percentileText}
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
