// WP-F5 shareability layer: pure, DB-free helpers shared by the OG image
// routes (app/api/og/**), the public JSON routes (app/api/public/**), the
// RSS feed (app/feed/market-pulse.xml), and the ShareButton popover. Kept
// separate from lib/markets/queries.ts (the DB read layer, owned by other
// concurrent work packages) so none of this needs DB access to be unit
// tested — every function here takes already-fetched VM data and returns a
// plain value/string.

import { formatPriceMinor } from '@/lib/format';
import type { DataSourceMode, HistoryPointVM, MarketEventVM, MarketSummaryVM } from './view-models';

// ---------------------------------------------------------------------------
// Site URL
// ---------------------------------------------------------------------------

/** Mirrors app/layout.tsx's local siteUrl() helper. Duplicated rather than
 * imported: layout.tsx is outside this work package's file ownership (only
 * its `metadata` object may be edited), and the logic is a few stable lines
 * with no DB dependency. Keep both in sync if the fallback chain changes. */
export function resolveSiteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3111';
}

export function marketPageUrl(siteUrl: string, origin: string, destination: string): string {
  return `${siteUrl}/market/${origin.toLowerCase()}/${destination.toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Share markdown (ShareButton "Copy markdown")
// ---------------------------------------------------------------------------

export interface ShareMarkdownInput {
  origin: string;
  destination: string;
  url: string;
  priceReliable: boolean;
  benchmarkPriceMinor: number;
  currency: string;
  /** Preferred delta to surface — 24h change (falls back to null gracefully
   * when unavailable, e.g. no comparable prior snapshot yet). */
  changePct24h: number | null;
}

/** "▼12%" / "▲4%" — glyph carries direction, magnitude is unsigned (matches
 * the terminal's convention of pairing color/glyph with the number rather
 * than a redundant +/- prefix, adapted here for a plain-text/no-color
 * context). Returns null when there's no comparable delta to show. */
function formatDeltaGlyph(pct: number | null): string | null {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return null;
  const glyph = pct < 0 ? '▼' : pct > 0 ? '▲' : '—';
  return `${glyph}${Math.round(Math.abs(pct))}%`;
}

/** Builds `[JFK→LHR $417 ▼12%](url)` — degrades to a bare
 * `[JFK→LHR](url)` when the price isn't reliable (WP-F1's
 * priceReliable gate: never publish a $0/near-$0 benchmark), and drops the
 * delta segment when there's no comparable prior snapshot. */
export function buildShareMarkdown(input: ShareMarkdownInput): string {
  const route = `${input.origin}→${input.destination}`;
  if (!input.priceReliable) {
    return `[${route}](${input.url})`;
  }
  const price = formatPriceMinor(input.benchmarkPriceMinor, input.currency);
  const delta = formatDeltaGlyph(input.changePct24h);
  const label = delta ? `${route} ${price} ${delta}` : `${route} ${price}`;
  return `[${label}](${input.url})`;
}

// ---------------------------------------------------------------------------
// Public JSON shape (app/api/public/markets/**)
// ---------------------------------------------------------------------------

export interface PublicMarketCard {
  origin: string;
  destination: string;
  originCity: string;
  destinationCity: string;
  slug: string;
  url: string;
  currency: string;
  windowDescription: string;
  /** False when the benchmark shouldn't be trusted/displayed — see
   * MarketSummaryVM.priceReliable. All price/delta/percentile fields below
   * are null in that case rather than a misleading $0 or -100%. */
  priceReliable: boolean;
  benchmarkPriceMinor: number | null;
  changePct24h: number | null;
  changePct7d: number | null;
  percentile: number | null;
  dataQuality: number;
  freshness: { ageSeconds: number; isStale: boolean };
  dataSourceMode: DataSourceMode;
}

/** Maps the internal MarketSummaryVM (which also carries recommendation/
 * analyst-note/fair-value detail not meant for the public feed) down to the
 * citable subset documented in docs/API.md. */
export function toPublicMarketCard(summary: MarketSummaryVM, siteUrl: string): PublicMarketCard {
  const { definition, snapshot, change, percentile, freshness, dataQuality, dataSourceMode, priceReliable } = summary;
  return {
    origin: definition.origin,
    destination: definition.destination,
    originCity: definition.originCity,
    destinationCity: definition.destinationCity,
    slug: definition.slug,
    url: marketPageUrl(siteUrl, definition.origin, definition.destination),
    currency: definition.currency,
    windowDescription: definition.windowDescription,
    priceReliable,
    benchmarkPriceMinor: priceReliable ? snapshot.benchmarkPriceMinor : null,
    changePct24h: change?.pct24h ?? null,
    changePct7d: change?.pct7d ?? null,
    percentile,
    dataQuality,
    freshness,
    dataSourceMode,
  };
}

export interface PublicHistoryPoint {
  snapshotAt: number;
  benchmarkPriceMinor: number;
  dataQualityScore: number;
}

export function toPublicHistory(points: HistoryPointVM[]): PublicHistoryPoint[] {
  return points.map((p) => ({
    snapshotAt: p.snapshotAt,
    benchmarkPriceMinor: p.benchmarkPriceMinor,
    dataQualityScore: p.dataQualityScore,
  }));
}

// ---------------------------------------------------------------------------
// OG card palette
// ---------------------------------------------------------------------------

/** Hex mirror of app/globals.css's CSS custom properties. next/og's
 * ImageResponse (Satori) renders outside the app's normal CSS cascade — no
 * Tailwind, no `var(--x)` — so the dark-terminal palette has to be
 * duplicated here as literal hex values to keep the OG cards visually
 * consistent with the rest of the site. Keep in sync with app/globals.css
 * `:root` if that palette changes. */
export const OG_COLORS = {
  bg: '#0a0c10',
  panel: '#12151c',
  border: '#262b36',
  textPrimary: '#f4f6f8',
  textSecondary: '#9aa4b2',
  textTertiary: '#6b7383',
  pos: '#22c55e',
  neg: '#ef4444',
  warn: '#f59e0b',
  accent: '#3b82f6',
} as const;

// ---------------------------------------------------------------------------
// Sparkline (OG card SVG polyline, rendered as an SVG <path>)
// ---------------------------------------------------------------------------

/** Builds an SVG path `d` attribute tracing `values` left-to-right,
 * normalized into a `width` x `height` box with `padding` px of vertical
 * headroom. Pure/DB-free so it's independently testable; the OG routes pass
 * it straight into a Satori-rendered `<path>` (next/og's ImageResponse only
 * supports a subset of SVG — `<path>` is supported, `<polyline>` is not). */
export function sparklinePathD(values: number[], width: number, height: number, padding = 4): string {
  if (values.length === 0) return '';
  if (values.length === 1) {
    const y = height / 2;
    return `M0,${y} L${width},${y}`;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const innerH = height - padding * 2;
  const stepX = width / (values.length - 1);

  return values
    .map((v, i) => {
      const x = i * stepX;
      const y = padding + innerH - ((v - min) / range) * innerH;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

// ---------------------------------------------------------------------------
// RSS 2.0 (app/feed/market-pulse.xml)
// ---------------------------------------------------------------------------

/** Escapes the five XML predefined entities. Every user/DB-derived string
 * (event facts, city names, analyst text) MUST pass through this before
 * landing in the feed — market events and airport data are seeded/ingested
 * content, not hand-authored copy, so treat it as untrusted for XML
 * purposes. */
export function escapeXml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface RssItem {
  title: string;
  link: string;
  guid: string;
  pubDateMs: number;
  description: string;
}

export interface RssChannel {
  title: string;
  link: string;
  description: string;
  selfUrl: string;
  items: RssItem[];
  generatedAtMs: number;
}

/** Renders a valid RSS 2.0 document. Pure string building (no XML DOM
 * dependency) — every dynamic value is escaped via escapeXml, and dates use
 * RFC-822 (Date#toUTCString()) as RSS 2.0 requires. */
export function buildRssXml(channel: RssChannel): string {
  const itemsXml = channel.items
    .map(
      (item) => `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.link)}</link>
      <guid isPermaLink="false">${escapeXml(item.guid)}</guid>
      <pubDate>${new Date(item.pubDateMs).toUTCString()}</pubDate>
      <description>${escapeXml(item.description)}</description>
    </item>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(channel.title)}</title>
    <link>${escapeXml(channel.link)}</link>
    <description>${escapeXml(channel.description)}</description>
    <language>en-us</language>
    <lastBuildDate>${new Date(channel.generatedAtMs).toUTCString()}</lastBuildDate>
    <atom:link xmlns:atom="http://www.w3.org/2005/Atom" href="${escapeXml(channel.selfUrl)}" rel="self" type="application/rss+xml"/>
${itemsXml}
  </channel>
</rss>
`;
}

/** Regex-extracts "N.N%" and "CUR XXXX.XX" from an event's observedFacts —
 * domain/events/detectEvents.ts formats these deterministically (e.g.
 * "Benchmark fell 12.3% (USD 417.00) in 26h.", "New historical low:
 * benchmark USD 417.00 is 12.3% below..."), so a plain regex is reliable
 * without importing the events module. Returns nulls when a fact set
 * doesn't carry a price signal (e.g. CARRIER_ENTERED_LOW_SET). */
function extractPriceSignal(facts: string[]): { pct: number | null; priceMinor: number | null; currency: string | null } {
  const text = facts.join(' ');
  const pctMatch = text.match(/(\d+(?:\.\d+)?)%/);
  const moneyMatch = text.match(/([A-Z]{3})\s?([\d,]+\.\d{2})/);
  return {
    pct: pctMatch ? Number(pctMatch[1]) : null,
    priceMinor: moneyMatch ? Math.round(Number(moneyMatch[2].replace(/,/g, '')) * 100) : null,
    currency: moneyMatch ? moneyMatch[1] : null,
  };
}

/** "JFK→LHR: Price drop -12% ($417)" when the event's observedFacts
 * carry a parseable price signal, else "JFK→LHR: {label} —
 * {first fact}". */
export function buildEventTitle(
  origin: string,
  destination: string,
  event: Pick<MarketEventVM, 'eventType' | 'label' | 'observedFacts'>
): string {
  const route = `${origin}→${destination}`;
  const { pct, priceMinor, currency } = extractPriceSignal(event.observedFacts);

  if (pct !== null && priceMinor !== null && currency !== null) {
    const sign = event.eventType === 'PRICE_DROP' || event.eventType === 'NEW_HISTORICAL_LOW' ? '-' : '+';
    return `${route}: ${event.label} ${sign}${pct.toFixed(0)}% (${formatPriceMinor(priceMinor, currency)})`;
  }

  const firstFact = event.observedFacts[0];
  return firstFact ? `${route}: ${event.label} — ${firstFact}` : `${route}: ${event.label}`;
}

export function buildEventDescription(
  event: Pick<MarketEventVM, 'observedFacts' | 'inference' | 'severity' | 'confidence'>
): string {
  const parts = [...event.observedFacts];
  if (event.inference) {
    parts.push(`Inference (${event.inference.confidence.toLowerCase()} confidence): ${event.inference.text}`);
  }
  parts.push(`Severity: ${event.severity.toLowerCase()}.`);
  return parts.join(' ');
}
