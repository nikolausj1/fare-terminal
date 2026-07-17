// Client-safe formatting helpers for the UI layer. Pure functions only (no
// DB, no fs) so they can be imported from both server and client components.

import type { EventType } from '@/domain/types';

/** Minimal classnames joiner — avoids pulling in a dependency for this. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** Minor units (cents) -> "$X,XXX" (no decimals — airfare display convention
 * for this app; PRD §25). Falls back gracefully for unknown currencies. */
export function formatPriceMinor(minor: number, currency = 'USD'): string {
  const major = minor / 100;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(major);
  } catch {
    return `$${Math.round(major).toLocaleString('en-US')}`;
  }
}

/** Signed absolute price delta in minor units, e.g. "+$42" / "-$18". */
export function formatSignedPriceMinor(minor: number, currency = 'USD'): string {
  const sign = minor > 0 ? '+' : minor < 0 ? '-' : '';
  return `${sign}${formatPriceMinor(Math.abs(minor), currency)}`;
}

/** Signed percent, one decimal place, explicit +/-, e.g. "+4.2%" / "-8.0%". */
export function formatSignedPct(pct: number, digits = 1): string {
  const sign = pct > 0 ? '+' : pct < 0 ? '-' : '';
  return `${sign}${Math.abs(pct).toFixed(digits)}%`;
}

export type PriceDirection = 'up' | 'down' | 'flat';

export function priceDirection(pct: number | null | undefined): PriceDirection {
  if (pct === null || pct === undefined || pct === 0) return 'flat';
  return pct > 0 ? 'up' : 'down';
}

/** A price DROP is user-favorable, so drops render green/▼ and increases
 * render red/▲ — the inverse of a typical stock ticker. Returns the CSS
 * variable name (without var()) and the glyph to pair with it so color is
 * never the only signal. */
export function priceChangeVisual(pct: number | null | undefined): {
  colorVar: '--pos' | '--neg' | '--text-secondary';
  glyph: '▼' | '▲' | '—';
} {
  const dir = priceDirection(pct);
  if (dir === 'down') return { colorVar: '--pos', glyph: '▼' };
  if (dir === 'up') return { colorVar: '--neg', glyph: '▲' };
  return { colorVar: '--text-secondary', glyph: '—' };
}

/** Relative time from `fromMs` to `toMs` (default: now), e.g. "2h ago",
 * "just now", "in 3d". Coarse buckets, not a full i18n relative formatter. */
export function formatRelativeTime(ms: number, nowMs: number = Date.now()): string {
  const diffMs = nowMs - ms;
  const future = diffMs < 0;
  const abs = Math.abs(diffMs);
  const sec = Math.round(abs / 1000);
  const min = Math.round(sec / 60);
  const hr = Math.round(min / 60);
  const day = Math.round(hr / 24);

  let label: string;
  if (sec < 45) label = 'just now';
  else if (min < 60) label = `${min}m`;
  else if (hr < 24) label = `${hr}h`;
  else if (day < 30) label = `${day}d`;
  else label = new Date(ms).toISOString().slice(0, 10);

  if (label === 'just now') return label;
  return future ? `in ${label}` : `${label} ago`;
}

export function formatAbsoluteTime(ms: number): string {
  return new Date(ms).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

export function formatAbsoluteDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDurationMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Groups the 13 EventType values into the 5 filter categories used by the
 * event timeline UI (PRD §25 taxonomy: Price / Carrier / Fare product /
 * Volume / Anomaly). */
export const EVENT_CATEGORY: Record<EventType, 'Price' | 'Carrier' | 'Fare product' | 'Volume' | 'Anomaly'> = {
  PRICE_DROP: 'Price',
  PRICE_INCREASE: 'Price',
  NEW_HISTORICAL_LOW: 'Price',
  LOW_FARE_SET_CHANGED: 'Price',
  CARRIER_ENTERED_LOW_SET: 'Carrier',
  CARRIER_LEFT_LOW_SET: 'Carrier',
  POSSIBLE_CARRIER_MATCH: 'Carrier',
  FARE_PRODUCT_APPEARED: 'Fare product',
  FARE_PRODUCT_DISAPPEARED: 'Fare product',
  OFFER_COUNT_SURGE: 'Volume',
  OFFER_COUNT_CONTRACTION: 'Volume',
  VOLATILITY_SPIKE: 'Anomaly',
  DATA_ANOMALY: 'Anomaly',
};

export const EVENT_CATEGORIES = ['Price', 'Carrier', 'Fare product', 'Volume', 'Anomaly'] as const;

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}
