import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderError } from '@/lib/providers/travelpayouts/client';
import {
  createTravelpayoutsExtras,
  mapCityDirections,
  mapLatestDeals,
  mapMonthMatrix,
} from '@/lib/providers/travelpayouts/extras';

import monthMatrixHappy from './fixtures/travelpayouts/month-matrix-happy.json';
import monthMatrixEdgeCases from './fixtures/travelpayouts/month-matrix-edge-cases.json';
import monthMatrixEmpty from './fixtures/travelpayouts/month-matrix-empty.json';
import monthMatrixReal from './fixtures/travelpayouts/month-matrix-real-2026-08-02.json';
import monthMatrixRealGappy from './fixtures/travelpayouts/month-matrix-real-2026-08-02-gappy.json';
import cityDirectionsHappy from './fixtures/travelpayouts/city-directions-happy.json';
import cityDirectionsEdgeCases from './fixtures/travelpayouts/city-directions-edge-cases.json';
import cityDirectionsEmpty from './fixtures/travelpayouts/city-directions-empty.json';
import cityDirectionsReal from './fixtures/travelpayouts/city-directions-real-2026-08-02.json';
import latestDealsHappy from './fixtures/travelpayouts/latest-deals-happy.json';
import latestDealsEdgeCases from './fixtures/travelpayouts/latest-deals-edge-cases.json';
import latestDealsReal from './fixtures/travelpayouts/latest-deals-real-2026-08-02.json';
import latestDealsEmptyFilteredReal from './fixtures/travelpayouts/latest-deals-empty-filtered-real-2026-08-02.json';

const RETRIEVED_AT = Date.parse('2026-08-02T12:00:00.000Z');

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// mapMonthMatrix
// ---------------------------------------------------------------------------

describe('mapMonthMatrix', () => {
  it('maps clean days, tolerates a string price, and always uses the queried origin/destination', () => {
    const result = mapMonthMatrix(monthMatrixHappy, 'JFK', 'LHR', '2026-09', RETRIEVED_AT);
    expect(result.origin).toBe('JFK');
    expect(result.destination).toBe('LHR');
    expect(result.days).toHaveLength(3);

    const day1 = result.days.find((d) => d.departDate === '2026-09-01');
    expect(day1).toBeDefined();
    expect(day1!.priceMajor).toBe(244);
    expect(day1!.transfers).toBe(1);
    expect(day1!.gate).toBe('Mytrip.com');
    expect(day1!.actual).toBe(true);
    expect(day1!.foundAt).toBe(Date.parse('2026-08-02T17:50:10Z'));

    const day3 = result.days.find((d) => d.departDate === '2026-09-03');
    expect(day3).toBeDefined();
    expect(day3!.priceMajor).toBe(233.5); // parsed from string "233.5"
    expect(day3!.actual).toBe(false);
  });

  it('skips a missing depart_date and a non-positive price, defaults transfers to 0, flags a month mismatch, and leaves foundAt/gate/actual undefined when absent', () => {
    const result = mapMonthMatrix(monthMatrixEdgeCases, 'JFK', 'LHR', '2026-09', RETRIEVED_AT);
    // 4 fixture items: 09-05 (ok), 09-06 (price 0 -> skip), no depart_date (-> skip), 10-01 (ok but wrong month).
    expect(result.days).toHaveLength(2);

    const clean = result.days.find((d) => d.departDate === '2026-09-05');
    expect(clean).toBeDefined();
    expect(clean!.transfers).toBe(0);
    expect(clean!.foundAt).toBeUndefined();
    expect(clean!.gate).toBeUndefined();
    expect(clean!.actual).toBeUndefined();

    const mismatched = result.days.find((d) => d.departDate === '2026-10-01');
    expect(mismatched).toBeDefined();

    const skipWarnings = result.warnings.filter((w) => w.includes('skipped'));
    expect(skipWarnings).toHaveLength(2);
    expect(skipWarnings.some((w) => w.includes('value'))).toBe(true);
    expect(skipWarnings.some((w) => w.includes('depart_date'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('falls outside the requested month'))).toBe(true);
  });

  it('returns no days and an informational warning for an empty data array', () => {
    const result = mapMonthMatrix(monthMatrixEmpty, 'JFK', 'LHR', '2026-09', RETRIEVED_AT);
    expect(result.days).toEqual([]);
    expect(result.warnings.some((w) => w.includes('0 days'))).toBe(true);
  });

  it('returns an empty result with a warning on a malformed response shape', () => {
    const result = mapMonthMatrix({ data: 'not-an-array' }, 'JFK', 'LHR', '2026-09', RETRIEVED_AT);
    expect(result.days).toEqual([]);
    expect(result.warnings[0]).toContain('did not match the expected shape');
  });

  describe('against real captured responses (2026-08-02)', () => {
    it('parses 29/30 days for a dense near-term month (JFK-LHR Sept 2026)', () => {
      const result = mapMonthMatrix(monthMatrixReal, 'JFK', 'LHR', '2026-09', RETRIEVED_AT);
      expect(result.days).toHaveLength(29);
      expect(result.days.every((d) => d.departDate.startsWith('2026-09'))).toBe(true);
      expect(result.days.every((d) => d.priceMajor > 0)).toBe(true);
      // Real item has no origin_airport/destination_airport at all -- the
      // mapped result must still carry the queried airport codes, not the
      // source's city codes (NYC/LON).
      expect(result.origin).toBe('JFK');
      expect(result.destination).toBe('LHR');
    });

    it('parses only 9/30 days for a gappy far-out month (JFK-LHR Nov 2026), matching the audit verdict', () => {
      const result = mapMonthMatrix(monthMatrixRealGappy, 'JFK', 'LHR', '2026-11', RETRIEVED_AT);
      expect(result.days).toHaveLength(9);
    });
  });
});

// ---------------------------------------------------------------------------
// mapCityDirections
// ---------------------------------------------------------------------------

describe('mapCityDirections', () => {
  it('maps clean fares, tolerates a string price, and falls back to the object key when destination is absent', () => {
    const result = mapCityDirections(cityDirectionsHappy, 'NYC', RETRIEVED_AT);
    expect(result.origin).toBe('NYC');
    expect(result.fares).toHaveLength(3);

    const par = result.fares.find((f) => f.destination === 'PAR');
    expect(par).toBeDefined();
    expect(par!.priceMajor).toBe(412);
    expect(par!.airline).toBe('DL');

    const tok = result.fares.find((f) => f.destination === 'TOK');
    expect(tok).toBeDefined();
    expect(tok!.priceMajor).toBe(915.75); // parsed from string "915.75"
  });

  it('skips a non-positive price and falls back to the key for a missing destination field, and skips a blank destination', () => {
    const result = mapCityDirections(cityDirectionsEdgeCases, 'NYC', RETRIEVED_AT);
    // MIA: price 0 -> skip. SDQ: no destination field -> falls back to key "SDQ". "": destination "" -> skip.
    expect(result.fares).toHaveLength(1);
    expect(result.fares[0].destination).toBe('SDQ');

    const skipWarnings = result.warnings.filter((w) => w.includes('skipped'));
    expect(skipWarnings).toHaveLength(2);
  });

  it('returns no fares and an informational warning for an empty data object', () => {
    const result = mapCityDirections(cityDirectionsEmpty, 'NYC', RETRIEVED_AT);
    expect(result.fares).toEqual([]);
    expect(result.warnings.some((w) => w.includes('0 destinations'))).toBe(true);
  });

  it('parses 30 destination fares from a real captured NYC city-directions response', () => {
    const result = mapCityDirections(cityDirectionsReal, 'NYC', RETRIEVED_AT);
    expect(result.fares).toHaveLength(30);
    const lax = result.fares.find((f) => f.destination === 'LAX');
    expect(lax).toBeDefined();
    expect(lax!.priceMajor).toBe(196);
    expect(lax!.airline).toBe('B6');
  });
});

// ---------------------------------------------------------------------------
// mapLatestDeals
// ---------------------------------------------------------------------------

describe('mapLatestDeals', () => {
  it('maps clean deals and parses both found_at formats (Z-suffixed and bare/UTC-implied)', () => {
    const result = mapLatestDeals(latestDealsHappy, RETRIEVED_AT);
    expect(result.deals).toHaveLength(2);

    const bare = result.deals.find((d) => d.destination === 'SKD');
    expect(bare).toBeDefined();
    // "2026-08-02T17:52:58" has no zone indicator -- must be treated as UTC.
    expect(bare!.foundAt).toBe(Date.parse('2026-08-02T17:52:58Z'));

    const zSuffixed = result.deals.find((d) => d.destination === 'IZM');
    expect(zSuffixed).toBeDefined();
    expect(zSuffixed!.foundAt).toBe(Date.parse('2026-08-02T17:53:14Z'));
    expect(zSuffixed!.priceMajor).toBe(59.9); // parsed from string "59.9"
    expect(zSuffixed!.returnDate).toBeUndefined(); // "" -> undefined
  });

  it('skips a missing origin, a non-positive price, and an unparseable price string', () => {
    const result = mapLatestDeals(latestDealsEdgeCases, RETRIEVED_AT);
    expect(result.deals).toEqual([]);
    const skipWarnings = result.warnings.filter((w) => w.includes('skipped'));
    expect(skipWarnings).toHaveLength(3);
    expect(skipWarnings.some((w) => w.includes('origin'))).toBe(true);
    expect(skipWarnings.some((w) => w.includes('value'))).toBe(true);
  });

  describe('against real captured responses (2026-08-02)', () => {
    it('parses 8 deals from an unfiltered network-wide sweep', () => {
      const result = mapLatestDeals(latestDealsReal, RETRIEVED_AT);
      expect(result.deals).toHaveLength(8);
      expect(result.deals.every((d) => d.origin.length > 0 && d.destination.length > 0)).toBe(true);
    });

    it('confirms the audit finding: filtering to a specific origin/destination returns empty', () => {
      const result = mapLatestDeals(latestDealsEmptyFilteredReal, RETRIEVED_AT);
      expect(result.deals).toEqual([]);
      expect(result.warnings.some((w) => w.includes('0 deals'))).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// createTravelpayoutsExtras (fetch wiring + rate limiting), fixture-driven
// ---------------------------------------------------------------------------

describe('createTravelpayoutsExtras', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('fetchMonthMatrix calls month-matrix with month=<monthISO>-01 and currency=usd', async () => {
    vi.stubEnv('TRAVELPAYOUTS_TOKEN', 'test-token');
    const fetchImpl = vi.fn(async () => jsonResponse(200, monthMatrixHappy)) as unknown as typeof fetch;
    const extras = createTravelpayoutsExtras({ fetchImpl, clock: () => RETRIEVED_AT });

    const result = await extras.fetchMonthMatrix('JFK', 'LHR', '2026-09');

    expect(result.days.length).toBeGreaterThan(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const calledUrl = String((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(calledUrl).toContain('/v2/prices/month-matrix');
    expect(calledUrl).toContain('origin=JFK');
    expect(calledUrl).toContain('destination=LHR');
    expect(calledUrl).toContain('month=2026-09-01');
    expect(calledUrl).toContain('currency=usd');
  });

  it('fetchCityDirections calls city-directions with the origin and currency=usd', async () => {
    vi.stubEnv('TRAVELPAYOUTS_TOKEN', 'test-token');
    const fetchImpl = vi.fn(async () => jsonResponse(200, cityDirectionsHappy)) as unknown as typeof fetch;
    const extras = createTravelpayoutsExtras({ fetchImpl, clock: () => RETRIEVED_AT });

    const result = await extras.fetchCityDirections('NYC');

    expect(result.fares.length).toBeGreaterThan(0);
    const calledUrl = String((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(calledUrl).toContain('/v1/city-directions');
    expect(calledUrl).toContain('origin=NYC');
    expect(calledUrl).toContain('currency=usd');
  });

  it('fetchLatestDeals defaults limit to 30 and never sends origin/destination (unfiltered)', async () => {
    vi.stubEnv('TRAVELPAYOUTS_TOKEN', 'test-token');
    const fetchImpl = vi.fn(async () => jsonResponse(200, latestDealsHappy)) as unknown as typeof fetch;
    const extras = createTravelpayoutsExtras({ fetchImpl, clock: () => RETRIEVED_AT });

    await extras.fetchLatestDeals();

    const calledUrl = String((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(calledUrl).toContain('/v2/prices/latest');
    expect(calledUrl).toContain('limit=30');
    expect(calledUrl).not.toContain('origin=');
    expect(calledUrl).not.toContain('destination=');
  });

  it('fetchLatestDeals honors a custom limit', async () => {
    vi.stubEnv('TRAVELPAYOUTS_TOKEN', 'test-token');
    const fetchImpl = vi.fn(async () => jsonResponse(200, latestDealsHappy)) as unknown as typeof fetch;
    const extras = createTravelpayoutsExtras({ fetchImpl, clock: () => RETRIEVED_AT });

    await extras.fetchLatestDeals(5);

    const calledUrl = String((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(calledUrl).toContain('limit=5');
  });

  it('throws MISSING_TOKEN when TRAVELPAYOUTS_TOKEN is unset', async () => {
    vi.stubEnv('TRAVELPAYOUTS_TOKEN', undefined);
    const extras = createTravelpayoutsExtras({ clock: () => RETRIEVED_AT });

    await expect(extras.fetchCityDirections('NYC')).rejects.toMatchObject({ code: 'MISSING_TOKEN' });
  });

  it('enforces its own client-side rate limit independent of the core search provider', async () => {
    vi.stubEnv('TRAVELPAYOUTS_TOKEN', 'test-token');
    vi.stubEnv('TP_MAX_REQUESTS_PER_HOUR', '2');
    const fetchImpl = vi.fn(async () => jsonResponse(200, cityDirectionsHappy)) as unknown as typeof fetch;
    const extras = createTravelpayoutsExtras({ fetchImpl, clock: () => RETRIEVED_AT });

    await extras.fetchCityDirections('NYC');
    await extras.fetchCityDirections('LAX');
    await expect(extras.fetchCityDirections('ORD')).rejects.toBeInstanceOf(ProviderError);
    await expect(extras.fetchCityDirections('ORD')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});
