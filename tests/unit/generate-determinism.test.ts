import { describe, expect, it } from 'vitest';

import {
  computeRunTimestamps,
  generateMarketHistory,
  generateOfferBatch,
  resolveFlexibleQuery,
} from '@/db/seed/generate';
import { MARKETS_BY_ID } from '@/db/seed/markets';

const NOW = Date.parse('2026-07-17T12:00:00.000Z');

describe('generator determinism', () => {
  it('produces byte-identical offer batches for the same inputs', () => {
    const market = MARKETS_BY_ID.get('sea-fco')!;
    const query = resolveFlexibleQuery(market, NOW);

    const batchA = generateOfferBatch(market, query, NOW, NOW);
    const batchB = generateOfferBatch(market, query, NOW, NOW);

    expect(JSON.stringify(batchA)).toBe(JSON.stringify(batchB));
  });

  it('produces byte-identical first offer across independent calls', () => {
    const market = MARKETS_BY_ID.get('jfk-lhr')!;
    const runAt = NOW - 5 * 86_400_000;
    const query = resolveFlexibleQuery(market, runAt);

    const a = generateOfferBatch(market, query, runAt, NOW)[0];
    const b = generateOfferBatch(market, query, runAt, NOW)[0];

    expect(a).toEqual(b);
  });

  it('produces different batches for different run timestamps', () => {
    const market = MARKETS_BY_ID.get('sea-fco')!;
    const t1 = NOW - 10 * 86_400_000;
    const t2 = NOW - 20 * 86_400_000;
    const batch1 = generateOfferBatch(market, resolveFlexibleQuery(market, t1), t1, NOW);
    const batch2 = generateOfferBatch(market, resolveFlexibleQuery(market, t2), t2, NOW);
    expect(JSON.stringify(batch1)).not.toBe(JSON.stringify(batch2));
  });

  it('computeRunTimestamps is deterministic and sorted ascending', () => {
    const market = MARKETS_BY_ID.get('den-kef')!;
    const a = computeRunTimestamps(market, NOW);
    const b = computeRunTimestamps(market, NOW);
    expect(a).toEqual(b);
    for (let i = 1; i < a.length; i++) {
      expect(a[i]).toBeGreaterThan(a[i - 1]);
    }
  });

  it('generateMarketHistory is fully deterministic end-to-end', () => {
    const market = MARKETS_BY_ID.get('aus-mex')!;
    const historyA = generateMarketHistory(market, NOW);
    const historyB = generateMarketHistory(market, NOW);
    expect(JSON.stringify(historyA)).toBe(JSON.stringify(historyB));
  });
});
