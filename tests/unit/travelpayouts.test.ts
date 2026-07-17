import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { itineraryFingerprint } from '@/domain/normalization/fingerprint';
import type { NormalizedSearchQuery } from '@/domain/types';

import { ProviderError, createTravelpayoutsClient } from '@/lib/providers/travelpayouts/client';
import { mapCalendar, mapPricesForDates } from '@/lib/providers/travelpayouts/mapping';
import { createRateLimiter } from '@/lib/providers/travelpayouts/rateLimiter';
import { createTravelpayoutsProvider, travelpayoutsProvider } from '@/lib/providers/travelpayouts';
import { demoProvider, getActiveProvider } from '@/lib/providers';

import happyFixture from './fixtures/travelpayouts/prices-for-dates-happy.json';
import edgeFixture from './fixtures/travelpayouts/prices-for-dates-edge-cases.json';
import emptyFixture from './fixtures/travelpayouts/prices-for-dates-empty.json';
import calendarHappyFixture from './fixtures/travelpayouts/calendar-happy.json';
import calendarEmptyFixture from './fixtures/travelpayouts/calendar-empty.json';

const RETRIEVED_AT = Date.parse('2026-07-17T12:00:00.000Z');

function exactQuery(overrides: Partial<NormalizedSearchQuery> = {}): NormalizedSearchQuery {
  return {
    origin: 'SEA',
    destination: 'FCO',
    mode: 'EXACT',
    departureDate: '2026-08-10',
    returnDate: '2026-08-18',
    tripType: 'ROUND_TRIP',
    cabin: 'ECONOMY',
    adults: 1,
    maxStops: 1,
    currency: 'USD',
    ...overrides,
  };
}

function flexQuery(overrides: Partial<NormalizedSearchQuery> = {}): NormalizedSearchQuery {
  return {
    origin: 'SEA',
    destination: 'FCO',
    mode: 'FLEXIBLE',
    departureWindowStart: '2026-08-01',
    departureWindowEnd: '2026-09-15',
    stayMinNights: 5,
    stayMaxNights: 9,
    tripType: 'ROUND_TRIP',
    cabin: 'ECONOMY',
    adults: 1,
    maxStops: 1,
    currency: 'USD',
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// mapping.ts
// ---------------------------------------------------------------------------

describe('mapPricesForDates', () => {
  it('builds a round-trip offer with two synthetic segments and a one-way offer with one', () => {
    const result = mapPricesForDates(happyFixture, exactQuery(), RETRIEVED_AT);
    expect(result.offers).toHaveLength(3);

    const tk = result.offers.find((o) => o.validatingCarrier === 'TK');
    const dl = result.offers.find((o) => o.validatingCarrier === 'DL');
    const af = result.offers.find((o) => o.validatingCarrier === 'AF');

    expect(tk).toBeDefined();
    expect(dl).toBeDefined();
    expect(af).toBeDefined();

    expect(tk!.segments).toHaveLength(2);
    expect(dl!.segments).toHaveLength(2);
    expect(af!.segments).toHaveLength(1); // fixture item has no return_at

    expect(tk!.totalPriceMinor).toBe(51240); // 512.4 * 100
    expect(tk!.segments[0].operatingFlightNumber).toBe('TK1978');
    expect(tk!.segments[1].origin).toBe('FCO');
    expect(tk!.segments[1].destination).toBe('SEA');
    expect(tk!.currency).toBe('USD'); // normalized to query.currency, not the fixture's lowercase "usd"
    expect(tk!.outboundUrl).toBe('https://www.aviasales.com/searches/SEA1008FCO1808TK1');
    expect(tk!.stopCount).toBe(1);
  });

  it('tolerates unknown extra fields on an item without affecting mapping', () => {
    const result = mapPricesForDates(happyFixture, exactQuery(), RETRIEVED_AT);
    const dl = result.offers.find((o) => o.validatingCarrier === 'DL');
    // fixture item for DL carries extra "meal_service"/"baggage" fields.
    expect(dl!.totalPriceMinor).toBe(60100);
    expect(dl!.stopCount).toBe(0);
  });

  it('estimates duration and flags it when missing, and placeholders a missing flight_number', () => {
    const result = mapPricesForDates(edgeFixture, exactQuery(), RETRIEVED_AT);

    const lh = result.offers.find((o) => o.validatingCarrier === 'LH');
    expect(lh).toBeDefined();
    expect(lh!.qualityFlags).toContain('ESTIMATED_DURATION');
    expect(
      result.warnings.some((w) => w.includes('duration missing from source'))
    ).toBe(true);

    const az = result.offers.find((o) => o.validatingCarrier === 'AZ');
    expect(az).toBeDefined();
    expect(az!.segments[0].operatingFlightNumber).toBe('AZ0000');
    expect(
      result.warnings.some((w) => w.includes('flight_number missing, using placeholder "0000"'))
    ).toBe(true);
  });

  it('skips malformed items (bad price, missing origin, missing airline) with warnings, keeping recoverable ones', () => {
    const result = mapPricesForDates(edgeFixture, exactQuery(), RETRIEVED_AT);
    // 5 fixture items: LH (ok, no duration), BA (bad price -> skip),
    // (missing origin -> skip), (missing airline -> skip), AZ (ok, no flight_number).
    expect(result.offers).toHaveLength(2);
    const skipWarnings = result.warnings.filter((w) => w.includes('skipped'));
    expect(skipWarnings).toHaveLength(3);
    expect(skipWarnings.some((w) => w.includes('price'))).toBe(true);
    expect(skipWarnings.some((w) => w.includes('origin'))).toBe(true);
    expect(skipWarnings.some((w) => w.includes('airline'))).toBe(true);
  });

  it('returns no offers and an informational warning for an empty data array', () => {
    const result = mapPricesForDates(emptyFixture, exactQuery(), RETRIEVED_AT);
    expect(result.offers).toEqual([]);
    expect(result.warnings.some((w) => w.includes('0 offers'))).toBe(true);
  });

  it('every offer carries the mandatory AGGREGATED_CACHED_SOURCE and SYNTHETIC_SEGMENTS quality flags', () => {
    const happy = mapPricesForDates(happyFixture, exactQuery(), RETRIEVED_AT).offers;
    const edge = mapPricesForDates(edgeFixture, exactQuery(), RETRIEVED_AT).offers;
    for (const offer of [...happy, ...edge]) {
      expect(offer.qualityFlags).toContain('AGGREGATED_CACHED_SOURCE');
      expect(offer.qualityFlags).toContain('SYNTHETIC_SEGMENTS');
    }
  });

  it('every segment has non-empty fingerprint-relevant fields and hashes without throwing', () => {
    const offers = mapPricesForDates(happyFixture, exactQuery(), RETRIEVED_AT).offers;
    for (const offer of offers) {
      for (const segment of offer.segments) {
        expect(segment.operatingFlightNumber.length).toBeGreaterThan(0);
        expect(segment.origin.length).toBeGreaterThan(0);
        expect(segment.destination.length).toBeGreaterThan(0);
        expect(Number.isNaN(Date.parse(segment.departureAt))).toBe(false);
        expect(Number.isNaN(Date.parse(segment.arrivalAt))).toBe(false);
        expect(segment.cabin).toBe('ECONOMY');
      }
      expect(() => itineraryFingerprint(offer.segments)).not.toThrow();
    }
  });

  it('produces a deterministic providerOfferId for identical inputs', () => {
    const a = mapPricesForDates(happyFixture, exactQuery(), RETRIEVED_AT);
    const b = mapPricesForDates(happyFixture, exactQuery(), RETRIEVED_AT);
    expect(a.offers.map((o) => o.providerOfferId)).toEqual(b.offers.map((o) => o.providerOfferId));
  });

  it('changes providerOfferId when the underlying price changes', () => {
    const a = mapPricesForDates(happyFixture, exactQuery(), RETRIEVED_AT);
    const mutated = JSON.parse(JSON.stringify(happyFixture));
    mutated.data[0].price = 999;
    const b = mapPricesForDates(mutated, exactQuery(), RETRIEVED_AT);
    expect(a.offers[0].providerOfferId).not.toBe(b.offers[0].providerOfferId);
  });
});

describe('mapCalendar', () => {
  it('maps valid entries, preserves expires_at, and skips the non-positive-price entry', () => {
    const result = mapCalendar(calendarHappyFixture, exactQuery({ origin: 'JFK', destination: 'LAX' }), RETRIEVED_AT);
    expect(result.offers).toHaveLength(2);

    const aa = result.offers.find((o) => o.validatingCarrier === 'AA');
    expect(aa).toBeDefined();
    expect(aa!.expiresAt).toBe(Date.parse('2026-08-25T02:00:00Z'));
    expect(aa!.segments).toHaveLength(2); // has return_date

    const b6 = result.offers.find((o) => o.validatingCarrier === 'B6');
    expect(b6).toBeDefined();
    expect(b6!.expiresAt).toBeUndefined();
    expect(b6!.observedAt).toBe(RETRIEVED_AT);

    const skipWarnings = result.warnings.filter((w) => w.includes('skipped'));
    expect(skipWarnings).toHaveLength(1);
    expect(skipWarnings[0]).toContain('price');
  });

  it('returns no offers for an empty calendar', () => {
    const result = mapCalendar(calendarEmptyFixture, exactQuery(), RETRIEVED_AT);
    expect(result.offers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// client.ts
// ---------------------------------------------------------------------------

describe('createTravelpayoutsClient', () => {
  it('retries exactly once on a 5xx and returns the successful second response', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return jsonResponse(500, { error: 'boom' });
      return jsonResponse(200, { success: true, data: [] });
    }) as unknown as typeof fetch;

    const client = createTravelpayoutsClient({ token: 'test-token', fetchImpl });
    const result = await client.get('/aviasales/v3/prices_for_dates', { origin: 'SEA' });

    expect(result).toEqual({ success: true, data: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up after a second consecutive 5xx with a terminal ProviderError', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(502, {})) as unknown as typeof fetch;
    const client = createTravelpayoutsClient({ token: 'test-token', fetchImpl });

    await expect(client.get('/x', {})).rejects.toMatchObject({ code: 'SERVER_ERROR', status: 502 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry on 429 and surfaces a RATE_LIMITED ProviderError', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(429, {})) as unknown as typeof fetch;
    const client = createTravelpayoutsClient({ token: 'test-token', fetchImpl });

    await expect(client.get('/x', {})).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not retry on a 4xx client error', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {})) as unknown as typeof fetch;
    const client = createTravelpayoutsClient({ token: 'test-token', fetchImpl });

    await expect(client.get('/x', {})).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 404 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sends the token via header, not the URL', async () => {
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers['x-access-token']).toBe('secret-token');
      return jsonResponse(200, { success: true });
    });

    const client = createTravelpayoutsClient({
      token: 'secret-token',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await client.get('/x', {});

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).not.toContain('secret-token');
  });
});

// ---------------------------------------------------------------------------
// rateLimiter.ts
// ---------------------------------------------------------------------------

describe('createRateLimiter', () => {
  it('allows up to the budget then rejects with a RATE_LIMITED ProviderError', () => {
    const limiter = createRateLimiter(3, () => 0);
    limiter.check('/a');
    limiter.check('/a');
    limiter.check('/a');

    expect(() => limiter.check('/a')).toThrow(ProviderError);

    let caught: unknown;
    try {
      limiter.check('/a');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProviderError);
    expect((caught as ProviderError).code).toBe('RATE_LIMITED');
  });

  it('frees up budget once the hour-long window slides past old requests', () => {
    let now = 0;
    const limiter = createRateLimiter(2, () => now);
    limiter.check('/a');
    limiter.check('/a');
    expect(() => limiter.check('/a')).toThrow(ProviderError);

    now += 60 * 60_000 + 1;
    expect(() => limiter.check('/a')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// travelpayoutsProvider (search / healthCheck / buildOutboundUrl), fixture-driven
// ---------------------------------------------------------------------------

describe('travelpayoutsProvider', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('EXACT search calls prices_for_dates once and returns a batch with the cache-caveat warning', async () => {
    vi.stubEnv('TRAVELPAYOUTS_TOKEN', 'test-token');
    const fetchImpl = vi.fn(async () => jsonResponse(200, happyFixture)) as unknown as typeof fetch;
    const provider = createTravelpayoutsProvider({ fetchImpl, clock: () => RETRIEVED_AT });

    const batch = await provider.search(exactQuery());

    expect(batch.providerId).toBe('travelpayouts');
    expect(batch.retrievedAt).toBe(RETRIEVED_AT);
    expect(batch.offers.length).toBeGreaterThan(0);
    expect(batch.warnings.some((w) => w.includes('cached'))).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('FLEXIBLE search samples at most 3 months and filters offers to the window', async () => {
    vi.stubEnv('TRAVELPAYOUTS_TOKEN', 'test-token');
    const fetchImpl = vi.fn(async () => jsonResponse(200, happyFixture)) as unknown as typeof fetch;
    const provider = createTravelpayoutsProvider({ fetchImpl, clock: () => RETRIEVED_AT });

    // Window spans 6 months; sampling must cap at 3 calls.
    const batch = await provider.search(
      flexQuery({ departureWindowStart: '2026-08-01', departureWindowEnd: '2027-01-31' })
    );

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(batch.warnings.some((w) => w.includes('only the first 3 were sampled'))).toBe(true);
  });

  it('healthCheck reports OK on a successful cheap calendar call', async () => {
    vi.stubEnv('TRAVELPAYOUTS_TOKEN', 'test-token');
    const fetchImpl = vi.fn(async () => jsonResponse(200, calendarHappyFixture)) as unknown as typeof fetch;
    const provider = createTravelpayoutsProvider({ fetchImpl, clock: () => RETRIEVED_AT });

    const health = await provider.healthCheck();
    expect(health.providerId).toBe('travelpayouts');
    expect(health.status).toBe('OK');
  });

  it('healthCheck reports DOWN when the calendar call fails', async () => {
    vi.stubEnv('TRAVELPAYOUTS_TOKEN', 'test-token');
    const fetchImpl = vi.fn(async () => jsonResponse(500, {})) as unknown as typeof fetch;
    const provider = createTravelpayoutsProvider({ fetchImpl, clock: () => RETRIEVED_AT });

    const health = await provider.healthCheck();
    expect(health.status).toBe('DOWN');
  });

  it('buildOutboundUrl returns null without TRAVELPAYOUTS_MARKER and an annotated link with it', async () => {
    vi.stubEnv('TRAVELPAYOUTS_TOKEN', 'test-token');
    const fetchImpl = vi.fn(async () => jsonResponse(200, happyFixture)) as unknown as typeof fetch;
    const provider = createTravelpayoutsProvider({ fetchImpl, clock: () => RETRIEVED_AT });
    const batch = await provider.search(exactQuery());
    const offer = batch.offers[0];

    vi.stubEnv('TRAVELPAYOUTS_MARKER', '');
    expect(provider.buildOutboundUrl?.(offer)).toBeNull();

    vi.stubEnv('TRAVELPAYOUTS_MARKER', 'my-marker-123');
    const url = provider.buildOutboundUrl?.(offer);
    expect(url).toContain('marker=my-marker-123');
    expect(url).toContain('aviasales.com');
  });
});

// ---------------------------------------------------------------------------
// registry fallback (lib/providers/index.ts)
// ---------------------------------------------------------------------------

describe('getActiveProvider registry fallback', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('defaults to demo when DATA_PROVIDER is unset', () => {
    vi.stubEnv('DATA_PROVIDER', undefined);
    expect(getActiveProvider()).toBe(demoProvider);
  });

  it('returns demo when DATA_PROVIDER=demo', () => {
    vi.stubEnv('DATA_PROVIDER', 'demo');
    expect(getActiveProvider()).toBe(demoProvider);
  });

  it('returns travelpayouts when DATA_PROVIDER=travelpayouts and TRAVELPAYOUTS_TOKEN is set', () => {
    vi.stubEnv('DATA_PROVIDER', 'travelpayouts');
    vi.stubEnv('TRAVELPAYOUTS_TOKEN', 'a-real-token');
    expect(getActiveProvider()).toBe(travelpayoutsProvider);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to demo with a warning when DATA_PROVIDER=travelpayouts but TRAVELPAYOUTS_TOKEN is missing', () => {
    vi.stubEnv('DATA_PROVIDER', 'travelpayouts');
    vi.stubEnv('TRAVELPAYOUTS_TOKEN', undefined);
    expect(getActiveProvider()).toBe(demoProvider);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('TRAVELPAYOUTS_TOKEN');
  });

  it('throws on an unknown DATA_PROVIDER', () => {
    vi.stubEnv('DATA_PROVIDER', 'not-a-real-provider');
    expect(() => getActiveProvider()).toThrow(/Unknown DATA_PROVIDER/);
  });
});
