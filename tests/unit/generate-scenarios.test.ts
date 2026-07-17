import { describe, expect, it } from 'vitest';

import {
  computeRunTimestamps,
  generateMarketHistory,
  type GeneratedRun,
} from '@/db/seed/generate';
import { MARKETS_BY_ID } from '@/db/seed/markets';

const NOW = Date.parse('2026-07-17T12:00:00.000Z');
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function meanPrice(runs: GeneratedRun[]): number {
  const prices = runs.flatMap((r) => r.offers.map((o) => o.totalPriceMinor));
  expect(prices.length).toBeGreaterThan(0);
  return prices.reduce((a, b) => a + b, 0) / prices.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

describe('scenario shapes', () => {
  it('sharp-drop market: last-48h mean price is well below the prior week', () => {
    const market = MARKETS_BY_ID.get('jfk-lhr')!;
    expect(market.scenario).toBe('SHARP_DROP_SURGE');
    const history = generateMarketHistory(market, NOW);

    const last48h = history.filter((r) => NOW - r.runAt <= 48 * HOUR_MS);
    const priorWeek = history.filter(
      (r) => NOW - r.runAt > 9 * DAY_MS && NOW - r.runAt <= 16 * DAY_MS
    );

    expect(meanPrice(last48h)).toBeLessThan(meanPrice(priorWeek) * 0.95);
  });

  it('sharp-drop market: offer counts surge in the last 48h vs. baseline', () => {
    const market = MARKETS_BY_ID.get('jfk-lhr')!;
    const history = generateMarketHistory(market, NOW);
    const last48h = history.filter((r) => NOW - r.runAt <= 48 * HOUR_MS);
    const baseline = history.filter(
      (r) => NOW - r.runAt > 9 * DAY_MS && NOW - r.runAt <= 16 * DAY_MS
    );
    const avgCount = (runs: GeneratedRun[]) =>
      runs.reduce((sum, r) => sum + r.offers.length, 0) / runs.length;
    expect(avgCount(last48h)).toBeGreaterThan(avgCount(baseline));
  });

  it('carrier-match market: both carriers show a price dip inside the 72h window', () => {
    const market = MARKETS_BY_ID.get('lax-hnd')!;
    expect(market.scenario).toBe('CARRIER_MATCH');
    const history = generateMarketHistory(market, NOW);
    const [carrierA, carrierB] = market.carriers;

    for (const carrier of [carrierA, carrierB]) {
      const recent = history.filter(
        (r) => NOW - r.runAt <= 60 * HOUR_MS
      );
      const older = history.filter(
        (r) => NOW - r.runAt > 90 * HOUR_MS && NOW - r.runAt <= 110 * HOUR_MS
      );
      const recentPrices = recent.flatMap((r) =>
        r.offers.filter((o) => o.validatingCarrier === carrier).map((o) => o.totalPriceMinor)
      );
      const olderPrices = older.flatMap((r) =>
        r.offers.filter((o) => o.validatingCarrier === carrier).map((o) => o.totalPriceMinor)
      );
      expect(recentPrices.length).toBeGreaterThan(0);
      expect(olderPrices.length).toBeGreaterThan(0);
      const recentMean = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
      const olderMean = olderPrices.reduce((a, b) => a + b, 0) / olderPrices.length;
      expect(recentMean).toBeLessThan(olderMean);
    }
  });

  it('fare-brand-vanish market: "Basic" appears in old history but not in the last 5 days', () => {
    const market = MARKETS_BY_ID.get('ord-cdg')!;
    expect(market.scenario).toBe('FARE_BRAND_VANISH');
    const history = generateMarketHistory(market, NOW);

    const old = history.filter((r) => NOW - r.runAt > 20 * DAY_MS);
    const recent = history.filter((r) => NOW - r.runAt <= 5 * DAY_MS);

    const oldHasBasic = old.some((r) => r.offers.some((o) => o.fareBrand === 'Basic'));
    const recentHasBasic = recent.some((r) => r.offers.some((o) => o.fareBrand === 'Basic'));

    expect(oldHasBasic).toBe(true);
    expect(recentHasBasic).toBe(false);
  });

  it('inventory-up market: seatsRemaining rises in the last 10 days with only a modest price move', () => {
    const market = MARKETS_BY_ID.get('msp-cun')!;
    expect(market.scenario).toBe('INVENTORY_UP');
    const history = generateMarketHistory(market, NOW);

    const recent = history.filter((r) => NOW - r.runAt <= 10 * DAY_MS);
    const older = history.filter((r) => NOW - r.runAt > 30 * DAY_MS && NOW - r.runAt <= 60 * DAY_MS);

    const seats = (runs: GeneratedRun[]) => {
      const values = runs.flatMap((r) =>
        r.offers.map((o) => o.seatsRemaining).filter((s): s is number => s !== undefined)
      );
      return values.reduce((a, b) => a + b, 0) / values.length;
    };

    expect(seats(recent)).toBeGreaterThan(seats(older));

    const priceMove = Math.abs(meanPrice(recent) / meanPrice(older) - 1);
    expect(priceMove).toBeLessThan(0.15); // "modest" price response
  });

  it('volatility-spike market: price dispersion is much higher in the last 14 days', () => {
    const market = MARKETS_BY_ID.get('den-kef')!;
    expect(market.scenario).toBe('VOLATILITY_SPIKE');
    const history = generateMarketHistory(market, NOW);

    const stddev = (runs: GeneratedRun[]) => {
      const prices = runs.flatMap((r) => r.offers.map((o) => o.totalPriceMinor));
      const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
      const variance =
        prices.reduce((sum, p) => sum + (p - mean) ** 2, 0) / prices.length;
      return Math.sqrt(variance);
    };

    const recent = history.filter((r) => NOW - r.runAt <= 14 * DAY_MS);
    const older = history.filter((r) => NOW - r.runAt > 30 * DAY_MS);

    expect(stddev(recent)).toBeGreaterThan(stddev(older) * 1.5);
  });

  it('new-low market: the latest run undercuts every prior historical minimum', () => {
    const market = MARKETS_BY_ID.get('sfo-bcn')!;
    expect(market.scenario).toBe('NEW_LOW');
    const history = generateMarketHistory(market, NOW);

    const latestRun = history[history.length - 1];
    expect(latestRun.runAt).toBe(NOW);
    const latestMin = Math.min(...latestRun.offers.map((o) => o.totalPriceMinor));

    const priorMin = Math.min(
      ...history.slice(0, -1).flatMap((r) => r.offers.map((o) => o.totalPriceMinor))
    );

    expect(latestMin).toBeLessThan(priorMin);
  });

  it('stale/outage market: no observations within 8h of now, but history is otherwise intact', () => {
    const market = MARKETS_BY_ID.get('atl-lis')!;
    expect(market.scenario).toBe('STALE_OUTAGE');
    const timestamps = computeRunTimestamps(market, NOW);

    expect(timestamps.length).toBeGreaterThan(50);
    for (const t of timestamps) {
      expect(NOW - t).toBeGreaterThan(8 * HOUR_MS);
    }
  });

  it('short-history market: observation span is at most 8 days', () => {
    const market = MARKETS_BY_ID.get('bos-dub')!;
    expect(market.scenario).toBe('SHORT_HISTORY');
    const timestamps = computeRunTimestamps(market, NOW);

    expect(timestamps.length).toBeGreaterThan(0);
    const spanDays = (timestamps[timestamps.length - 1] - timestamps[0]) / DAY_MS;
    expect(spanDays).toBeLessThanOrEqual(8);
  });

  it('anomaly market: the latest batch contains exactly one offer >=35% below its median', () => {
    const market = MARKETS_BY_ID.get('aus-mex')!;
    expect(market.scenario).toBe('ANOMALY_OFFER');
    const history = generateMarketHistory(market, NOW);
    const latest = history[history.length - 1];
    expect(latest.runAt).toBe(NOW);

    const prices = latest.offers.map((o) => o.totalPriceMinor);
    const med = median(prices);
    const outliers = prices.filter((p) => (med - p) / med >= 0.35);

    expect(outliers.length).toBe(1);
  });

  it('every generated offer carries qualityFlags: [] (flagging happens downstream)', () => {
    const market = MARKETS_BY_ID.get('aus-mex')!;
    const history = generateMarketHistory(market, NOW);
    for (const run of history) {
      for (const offer of run.offers) {
        expect(offer.qualityFlags).toEqual([]);
      }
    }
  });

  it('stable markets stay within a tight band around fair value', () => {
    const market = MARKETS_BY_ID.get('sea-fco')!;
    expect(market.scenario).toBe('STABLE');
    const history = generateMarketHistory(market, NOW);
    const prices = history.flatMap((r) => r.offers.map((o) => o.totalPriceMinor));
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    expect(mean).toBeGreaterThan(market.basePriceMinor * 0.75);
    expect(mean).toBeLessThan(market.basePriceMinor * 1.25);
  });
});
