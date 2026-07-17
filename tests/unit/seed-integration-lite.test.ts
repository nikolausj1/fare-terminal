// "Integration-lite": exercises the generator across every seeded market
// without touching the database, so it stays fast and doesn't depend on
// db:setup having been run. Full DB seeding is covered by `npm run seed`
// itself (see the Verify steps in the WP2 task).

import { describe, expect, it } from 'vitest';

import {
  computeRunTimestamps,
  generateMarketHistory,
  intradayWindowHours,
} from '@/db/seed/generate';
import { MARKETS } from '@/db/seed/markets';

const NOW = Date.parse('2026-07-17T12:00:00.000Z');
const HOUR_MS = 3_600_000;

describe('seed integration-lite (generator only, no DB)', () => {
  it('every run across every market produces an offer count in the expected range', () => {
    for (const market of MARKETS) {
      const history = generateMarketHistory(market, NOW);
      expect(history.length).toBeGreaterThan(0);
      for (const run of history) {
        // Base range is 12-35; scenario shocks (offer-count surge, forced
        // anomaly offer) can push slightly above 35, capped at 45.
        expect(run.offers.length).toBeGreaterThanOrEqual(12);
        expect(run.offers.length).toBeLessThanOrEqual(46);
      }
    }
  });

  it('every market has a non-empty, duplicate-free, non-future run schedule', () => {
    for (const market of MARKETS) {
      const history = generateMarketHistory(market, NOW);
      const runAts = history.map((r) => r.runAt);
      expect(runAts.length).toBeGreaterThan(0);
      expect(Math.max(...runAts)).toBeLessThanOrEqual(NOW);
      expect(new Set(runAts).size).toBe(runAts.length);
    }
  });

  it('windowed scenarios get at least 30 intraday runs across their event window', () => {
    for (const market of MARKETS) {
      const windowH = intradayWindowHours(market.scenario);
      if (!windowH) continue;
      const timestamps = computeRunTimestamps(market, NOW);
      const withinWindow = timestamps.filter((t) => NOW - t <= windowH * HOUR_MS);
      expect(withinWindow.length).toBeGreaterThanOrEqual(30);
    }
  });

  it('every offer batch validates against the NormalizedOfferBatch shape (spot check)', () => {
    const market = MARKETS[0];
    const history = generateMarketHistory(market, NOW);
    const run = history[history.length - 1];
    for (const offer of run.offers) {
      expect(offer.providerId).toBe('demo');
      expect(offer.currency).toBe('USD');
      expect(offer.cabin).toBe('ECONOMY');
      expect(offer.totalPriceMinor).toBeGreaterThan(0);
      expect(offer.segments.length).toBeGreaterThan(0);
      expect([0, 1]).toContain(offer.stopCount);
      expect(offer.observedAt).toBe(run.runAt);
    }
  });
});
