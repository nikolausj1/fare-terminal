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

import { ImageResponse } from 'next/og';
import type { ReactNode } from 'react';
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

const SPARK_W = 1072;
const SPARK_H = 130;

function Wordmark() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div
        style={{
          display: 'flex',
          width: 14,
          height: 14,
          borderRadius: 3,
          backgroundColor: OG_COLORS.accent,
        }}
      />
      <div style={{ display: 'flex', fontSize: 24, fontWeight: 700, letterSpacing: 2, color: OG_COLORS.textSecondary }}>
        FARE TERMINAL
      </div>
    </div>
  );
}

function Footer({ dateLabel }: { dateLabel: string }) {
  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderTop: `1px solid ${OG_COLORS.border}`,
        paddingTop: 20,
      }}
    >
      <div style={{ display: 'flex', fontSize: 20, color: OG_COLORS.textTertiary }}>fare-terminal.vercel.app</div>
      <div style={{ display: 'flex', fontSize: 20, color: OG_COLORS.textTertiary }}>Cached market data · {dateLabel}</div>
    </div>
  );
}

function baseCard(children: ReactNode) {
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
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center', gap: 20 }}>
        <div style={{ display: 'flex', fontSize: 64, fontWeight: 700, color: OG_COLORS.textPrimary }}>{routeLabel}</div>
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
          {message}
        </div>
      </div>
      <Footer dateLabel={dateLabel} />
    </>
  );
}

function DeltaBlock({ label, pct }: { label: string; pct: number | null }) {
  if (pct === null) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', fontSize: 20, color: OG_COLORS.textSecondary }}>{label}</div>
        <div style={{ display: 'flex', fontSize: 32, color: OG_COLORS.textTertiary }}>—</div>
      </div>
    );
  }
  const visual = priceChangeVisual(pct);
  const color = visual.colorVar === '--pos' ? OG_COLORS.pos : visual.colorVar === '--neg' ? OG_COLORS.neg : OG_COLORS.textSecondary;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', fontSize: 20, color: OG_COLORS.textSecondary }}>{label}</div>
      <div style={{ display: 'flex', fontSize: 32, fontWeight: 600, color }}>
        {visual.glyph} {formatSignedPct(pct)}
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

  return baseCard(
    <>
      <Wordmark />

      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center', gap: 24 }}>
        <div style={{ display: 'flex', fontSize: 56, fontWeight: 700, color: OG_COLORS.textPrimary }}>{routeLabel}</div>

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 40 }}>
          <div style={{ display: 'flex', fontSize: 120, fontWeight: 700, color: OG_COLORS.textPrimary, lineHeight: 1 }}>
            ${priceMajor.toLocaleString('en-US')}
          </div>
          <div style={{ display: 'flex', gap: 32, paddingBottom: 16 }}>
            <DeltaBlock label="24H" pct={change?.pct24h ?? null} />
            <DeltaBlock label="7D" pct={change?.pct7d ?? null} />
          </div>
        </div>

        <div style={{ display: 'flex', fontSize: 28, color: OG_COLORS.textSecondary }}>
          {percentile !== null
            ? `Cheaper than ${percentile.toFixed(0)}% of observed history`
            : `${definition.originCity} to ${definition.destinationCity}`}
        </div>

        {pathD && (
          <svg width={SPARK_W} height={SPARK_H} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} style={{ display: 'flex' }}>
            <path d={pathD} fill="none" stroke={OG_COLORS.accent} strokeWidth={4} />
          </svg>
        )}
      </div>

      <Footer dateLabel={dateLabel} />
    </>
  );
}
