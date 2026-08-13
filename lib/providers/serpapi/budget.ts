// Pure budget/day-gate logic for the serpapi provider. Deliberately DB-free
// (counts are computed by the caller — jobs/ingest.ts — and passed in) so
// this stays fully unit-testable without a database, matching the "pure
// function with injected counts" testing approach used elsewhere in this
// repo (e.g. domain/normalization/anomaly.ts).
//
// Design (WP-P3): SerpApi's free tier is 250 searches/month. This app
// reserves 240 of them (domain/config.ts#serpapi.monthlySearchBudget) for
// the 8-route personal roster, leaving headroom for the health check and any
// ad-hoc/manual searches sharing the same account. There is NO new database
// table for tracking usage — see evaluateSerpApiBudget's docstring for why
// counting existing search_runs rows is sufficient.

export interface SerpApiBudgetLimits {
  /** Hard cap on serpapi search_runs rows per calendar month (UTC). */
  monthlySearchBudget: number;
  /** How many serpapi searches a single search_definitions row may make per
   * UTC calendar day. WP-P3 only ever configures this to 1 — the gate below
   * is only correct (as documented) for that value; see the module comment
   * on lastRunAtForDefinition. */
  sweepsPerDay: number;
}

export interface SerpApiBudgetState {
  /** COUNT(*) of search_runs rows where provider_id='serpapi' AND
   * started_at falls within the current UTC calendar month, as of `now`. */
  monthlySearchCount: number;
  /** MAX(started_at) of search_runs rows where provider_id='serpapi' AND
   * search_definition_id = <this definition>, or undefined if this
   * definition has never had a serpapi search_runs row. Only the single
   * latest run is needed because sweepsPerDay is always 1 in this app's
   * configuration — a same-UTC-day check against the single latest run is
   * exactly equivalent to "count of today's runs >= 1" in that case. A
   * future sweepsPerDay > 1 would need an actual count of today's runs
   * instead; this function documents but does not implement that case (see
   * the JSDoc below on evaluateSerpApiBudget's `sweepsPerDay > 1` note). */
  lastRunAtForDefinition?: number;
}

export interface SerpApiBudgetDecision {
  allowed: boolean;
  /** Populated when allowed is false; explains which gate rejected. */
  reason?: string;
}

function utcDateKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

/**
 * Decides whether a serpapi search for one search_definitions row is allowed
 * right now, given already-computed usage counts (see SerpApiBudgetState).
 *
 * Two independent gates, both must pass:
 *  1. Monthly budget: monthlySearchCount must be strictly below
 *     monthlySearchBudget. A hard cap, not a rolling/prorated one — 8 routes
 *     x 1 sweep/day x up to 31 days = up to 248 searches, which exceeds a
 *     240 budget in the longest months; the last day(s) of a 31-day month
 *     may therefore see definitions skipped once the cap is hit. This is a
 *     deliberate simplicity tradeoff over a per-day-prorated budget — see
 *     docs/PROVIDERS.md.
 *  2. Daily gate: this definition must not have already had a serpapi run
 *     today (UTC calendar day, i.e. lastRunAtForDefinition falling on the
 *     same UTC Y-M-D as `now`) — enforces sweepsPerDay=1. If
 *     limits.sweepsPerDay is ever configured above 1, this function still
 *     only allows exactly one run per UTC day per definition (it does not
 *     implement a >1 "sweeps per day" gate); callers should treat that
 *     configuration as unsupported until this function is extended with a
 *     same-day run COUNT rather than just the latest run.
 *
 * No DB access, no wall-clock reads — `now` and every count are supplied by
 * the caller, which is what makes this deterministically testable.
 */
export function evaluateSerpApiBudget(
  state: SerpApiBudgetState,
  now: number,
  limits: SerpApiBudgetLimits
): SerpApiBudgetDecision {
  if (state.monthlySearchCount >= limits.monthlySearchBudget) {
    return {
      allowed: false,
      reason: `monthly serpapi search budget reached (${state.monthlySearchCount}/${limits.monthlySearchBudget} this UTC calendar month)`,
    };
  }

  if (
    limits.sweepsPerDay <= 1 &&
    state.lastRunAtForDefinition !== undefined &&
    utcDateKey(state.lastRunAtForDefinition) === utcDateKey(now)
  ) {
    return {
      allowed: false,
      reason: 'already swept this search_definitions row today (UTC); sweepsPerDay=1',
    };
  }

  return { allowed: true };
}

/** Start of the current UTC calendar month, in epoch ms — the boundary
 * jobs/ingest.ts uses when counting this month's serpapi search_runs rows. */
export function utcMonthStartMs(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0);
}
