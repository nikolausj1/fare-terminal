// A tiny in-module sliding-window token bucket, sized to Travelpayouts'
// documented ~200 req/hour/IP limit (default budget kept below that; see
// TP_MAX_REQUESTS_PER_HOUR in .env.example). Deliberately simple: it rejects
// over-budget requests rather than queuing them, since queuing indefinitely
// inside a request/response cycle (Next.js route handler, cron job) is
// rarely what's wanted — the caller decides whether to retry later.
//
// State is per-process (an in-memory array), not shared across serverless
// instances or restarts — see docs/PROVIDERS.md for the operational
// implication.

import { ProviderError } from './client';

export interface RateLimiter {
  /** Throws ProviderError('RATE_LIMITED', ...) if the budget is exhausted; otherwise records the call and allows it. */
  check(endpoint: string): void;
}

export function createRateLimiter(maxPerHour: number, now: () => number = Date.now): RateLimiter {
  const windowMs = 60 * 60_000;
  const timestamps: number[] = [];

  return {
    check(endpoint: string) {
      const currentTime = now();
      while (timestamps.length > 0 && currentTime - timestamps[0] >= windowMs) {
        timestamps.shift();
      }

      if (timestamps.length >= maxPerHour) {
        throw new ProviderError(
          'RATE_LIMITED',
          endpoint,
          undefined,
          `Travelpayouts client-side rate limit reached (${maxPerHour}/hour); rejecting request to avoid a 429.`
        );
      }

      timestamps.push(currentTime);
    },
  };
}
