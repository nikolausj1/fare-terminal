// Client-safe URL state for the market page (PRD §10.3):
// ?mode=exact&depart=YYYY-MM-DD&return=YYYY-MM-DD — absence of `mode` (or an
// invalid combination) means the FLEXIBLE benchmark view. Canonical
// serialization always orders params mode, depart, return and omits
// defaults (a flexible view serializes to an empty query string).
//
// Both app/market/[origin]/[destination]/page.tsx (server, via
// searchParams) and client islands (mode toggle, share button) import this
// so parsing/serialization only happens in one place.

import { z } from 'zod';

export type UrlSearchMode = 'flexible' | 'exact';

export interface MarketUrlState {
  mode: UrlSearchMode;
  /** Only set when mode === 'exact'. */
  depart?: string;
  /** Only set when mode === 'exact' and a return date was present/valid. */
  return?: string;
}

/** Shape Next.js hands page components for `searchParams` (each value may
 * be a single string, an array if repeated, or absent). */
export type RawSearchParams = Record<string, string | string[] | undefined>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateSchema = z.string().regex(DATE_RE, 'expected YYYY-MM-DD');

const rawShape = z.object({
  mode: z.enum(['exact', 'flexible']).optional(),
  depart: z.string().optional(),
  return: z.string().optional(),
});

function firstValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const FLEXIBLE_STATE: MarketUrlState = { mode: 'flexible' };

/** Parses+validates raw searchParams into canonical MarketUrlState. Any
 * unknown params are ignored; any invalid/incomplete combination falls back
 * to the flexible default rather than throwing — a malformed URL should
 * degrade to the safe default, not break the page. */
export function parseMarketUrlState(searchParams: RawSearchParams): MarketUrlState {
  const parsed = rawShape.safeParse({
    mode: firstValue(searchParams.mode),
    depart: firstValue(searchParams.depart),
    return: firstValue(searchParams.return),
  });
  if (!parsed.success) return FLEXIBLE_STATE;

  const { mode, depart, return: returnDate } = parsed.data;
  if (mode !== 'exact') return FLEXIBLE_STATE;

  const departValid = depart !== undefined && dateSchema.safeParse(depart).success;
  if (!departValid) return FLEXIBLE_STATE;

  const returnValid = returnDate !== undefined && dateSchema.safeParse(returnDate).success;

  return returnValid ? { mode: 'exact', depart, return: returnDate } : { mode: 'exact', depart };
}

/** Canonical query string (no leading "?"), e.g. "mode=exact&depart=2026-09-15&return=2026-09-22".
 * The flexible default serializes to "". */
export function serializeMarketUrlState(state: MarketUrlState): string {
  if (state.mode !== 'exact' || !state.depart) return '';
  const params = new URLSearchParams();
  params.set('mode', 'exact');
  params.set('depart', state.depart);
  if (state.return) params.set('return', state.return);
  return params.toString();
}

/** Builds a canonical path + query string for a market's URL given the
 * lowercase origin/destination path segments. */
export function buildMarketUrl(origin: string, destination: string, state: MarketUrlState): string {
  const base = `/market/${origin.toLowerCase()}/${destination.toLowerCase()}`;
  const qs = serializeMarketUrlState(state);
  return qs ? `${base}?${qs}` : base;
}

/** Converts UI URL state into the { mode: 'FLEXIBLE'|'EXACT', depart?, return? }
 * shape lib/markets/queries.ts#MarketLookupParams / resolveDefinition expect. */
export function toQueryLookupParams(state: MarketUrlState): {
  mode: 'FLEXIBLE' | 'EXACT';
  depart?: string;
  return?: string;
} {
  if (state.mode === 'exact') {
    return { mode: 'EXACT', depart: state.depart, return: state.return };
  }
  return { mode: 'FLEXIBLE' };
}
