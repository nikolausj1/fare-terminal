import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NormalizedSearchQuery } from '@/domain/types';

import { createSerpApiClient, SerpApiError } from '@/lib/providers/serpapi/client';
import { evaluateSerpApiBudget, utcMonthStartMs } from '@/lib/providers/serpapi/budget';
import {
  createSerpApiProvider,
  pickRepresentativeDates,
  routeIdFromSlug,
  serpapiProvider,
} from '@/lib/providers/serpapi';
import { demoProvider, getActiveProvider } from '@/lib/providers';

import happyFixture from './fixtures/serpapi-real-sea-fco-2026-08-02.json';
import oneWayNoUrlFixture from './fixtures/serpapi/one-way-minimal.json';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function exactQuery(overrides: Partial<NormalizedSearchQuery> = {}): NormalizedSearchQuery {
  return {
    origin: 'SEA',
    destination: 'FCO',
    mode: 'EXACT',
    departureDate: '2026-09-15',
    returnDate: '2026-09-23',
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
    departureWindowStart: '2026-09-01',
    departureWindowEnd: '2026-09-11',
    stayMinNights: 4,
    stayMaxNights: 8,
    tripType: 'ROUND_TRIP',
    cabin: 'ECONOMY',
    adults: 1,
    maxStops: 1,
    currency: 'USD',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// client.ts
// ---------------------------------------------------------------------------

describe('createSerpApiClient', () => {
  it('retries exactly once on a 5xx and returns the successful second response', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return jsonResponse(500, { error: 'boom' });
      return jsonResponse(200, { best_flights: [] });
    }) as unknown as typeof fetch;

    const client = createSerpApiClient({ apiKey: 'test-key', fetchImpl });
    const result = await client.get('/search', { engine: 'google_flights' });

    expect(result).toEqual({ best_flights: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up after a second consecutive 5xx with a terminal SerpApiError', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(502, {})) as unknown as typeof fetch;
    const client = createSerpApiClient({ apiKey: 'test-key', fetchImpl });

    await expect(client.get('/search', {})).rejects.toMatchObject({ code: 'SERVER_ERROR', status: 502 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry on 429 and surfaces a RATE_LIMITED SerpApiError', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(429, {})) as unknown as typeof fetch;
    const client = createSerpApiClient({ apiKey: 'test-key', fetchImpl });

    await expect(client.get('/search', {})).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not retry on a 4xx client error', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {})) as unknown as typeof fetch;
    const client = createSerpApiClient({ apiKey: 'test-key', fetchImpl });

    await expect(client.get('/search', {})).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 404 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries once on a network error, then surfaces NETWORK_ERROR if it never recovers', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('fetch failed');
    }) as unknown as typeof fetch;
    const client = createSerpApiClient({ apiKey: 'test-key', fetchImpl });

    await expect(client.get('/search', {})).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('surfaces PARSE_ERROR when the response body is not valid JSON', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('unexpected token');
      },
    })) as unknown as typeof fetch;
    const client = createSerpApiClient({ apiKey: 'test-key', fetchImpl });

    await expect(client.get('/search', {})).rejects.toMatchObject({ code: 'PARSE_ERROR' });
  });

  it('sends api_key as a query parameter and never leaks it into a thrown error message', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      expect(String(url)).toContain('api_key=super-secret-key');
      return jsonResponse(404, {});
    });

    const client = createSerpApiClient({ apiKey: 'super-secret-key', fetchImpl: fetchMock as unknown as typeof fetch });

    let caught: unknown;
    try {
      await client.get('/search', {});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SerpApiError);
    expect((caught as SerpApiError).message).not.toContain('super-secret-key');
    expect((caught as SerpApiError).endpoint).not.toContain('super-secret-key');
    expect((caught as SerpApiError).endpoint).toContain('api_key=REDACTED');
  });
});

// ---------------------------------------------------------------------------
// budget.ts — pure function, injected counts (no DB, no wall clock)
// ---------------------------------------------------------------------------

describe('evaluateSerpApiBudget', () => {
  const LIMITS = { monthlySearchBudget: 240, sweepsPerDay: 1 };
  const NOW = Date.parse('2026-08-15T12:00:00.000Z');

  it('allows a search when under the monthly budget and never run before', () => {
    const decision = evaluateSerpApiBudget({ monthlySearchCount: 0 }, NOW, LIMITS);
    expect(decision.allowed).toBe(true);
  });

  it('rejects once the monthly budget is reached', () => {
    const decision = evaluateSerpApiBudget({ monthlySearchCount: 240 }, NOW, LIMITS);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('monthly serpapi search budget reached');
  });

  it('rejects above the monthly budget too (defensive, not just ==)', () => {
    const decision = evaluateSerpApiBudget({ monthlySearchCount: 500 }, NOW, LIMITS);
    expect(decision.allowed).toBe(false);
  });

  it('allows right up to (but not including) the budget', () => {
    const decision = evaluateSerpApiBudget({ monthlySearchCount: 239 }, NOW, LIMITS);
    expect(decision.allowed).toBe(true);
  });

  it('rejects a second search for the same definition on the same UTC calendar day', () => {
    const earlierToday = Date.parse('2026-08-15T01:00:00.000Z');
    const decision = evaluateSerpApiBudget(
      { monthlySearchCount: 10, lastRunAtForDefinition: earlierToday },
      NOW,
      LIMITS
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('already swept');
  });

  it('allows a search once the UTC calendar day has rolled over, even minutes later', () => {
    const lateLastNight = Date.parse('2026-08-14T23:59:59.000Z');
    const justAfterMidnightUtc = Date.parse('2026-08-15T00:00:01.000Z');
    const decision = evaluateSerpApiBudget(
      { monthlySearchCount: 10, lastRunAtForDefinition: lateLastNight },
      justAfterMidnightUtc,
      LIMITS
    );
    expect(decision.allowed).toBe(true);
  });

  it('the monthly gate takes precedence — both reasons could apply, but the reason returned is monthly', () => {
    const decision = evaluateSerpApiBudget(
      { monthlySearchCount: 240, lastRunAtForDefinition: NOW },
      NOW,
      LIMITS
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('monthly');
  });
});

describe('utcMonthStartMs', () => {
  it('returns midnight UTC on the 1st of the given month', () => {
    const now = Date.parse('2026-08-15T18:30:00.000Z');
    expect(new Date(utcMonthStartMs(now)).toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('handles December correctly (year does not roll incorrectly)', () => {
    const now = Date.parse('2026-12-31T23:59:00.000Z');
    expect(new Date(utcMonthStartMs(now)).toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// routeIdFromSlug
// ---------------------------------------------------------------------------

describe('routeIdFromSlug', () => {
  it('strips the -flex-vN / -exact-vN suffix to recover the bare route id', () => {
    expect(routeIdFromSlug('sea-fco-flex-v1')).toBe('sea-fco');
    expect(routeIdFromSlug('sea-fco-exact-v2')).toBe('sea-fco');
    expect(routeIdFromSlug('jfk-lhr-flex-v1')).toBe('jfk-lhr');
  });

  it('leaves a slug with no matching suffix unchanged', () => {
    expect(routeIdFromSlug('sea-fco')).toBe('sea-fco');
  });
});

// ---------------------------------------------------------------------------
// pickRepresentativeDates — deterministic FLEXIBLE-mode date sampling
// ---------------------------------------------------------------------------

describe('pickRepresentativeDates', () => {
  it('picks the window midpoint as departure, and midpoint-stay-length as the return date, for round trips', () => {
    const result = pickRepresentativeDates(
      {
        departureWindowStart: '2026-09-01',
        departureWindowEnd: '2026-09-11',
        stayMinNights: 4,
        stayMaxNights: 8,
        tripType: 'ROUND_TRIP',
      },
      5,
      9
    );
    // 10-day window, midpoint = 2026-09-06 (floor(10/2)=5 days after start).
    expect(result.departureDate).toBe('2026-09-06');
    // stay midpoint = floor((4+8)/2) = 6 nights.
    expect(result.returnDate).toBe('2026-09-12');
  });

  it('falls back to the provided defaults when the definition has no stay bounds', () => {
    const result = pickRepresentativeDates(
      {
        departureWindowStart: '2026-09-01',
        departureWindowEnd: '2026-09-11',
        tripType: 'ROUND_TRIP',
      },
      5,
      9
    );
    // default midpoint = floor((5+9)/2) = 7 nights.
    expect(result.returnDate).toBe('2026-09-13');
  });

  it('omits returnDate entirely for ONE_WAY queries', () => {
    const result = pickRepresentativeDates(
      { departureWindowStart: '2026-09-01', departureWindowEnd: '2026-09-11', tripType: 'ONE_WAY' },
      5,
      9
    );
    expect(result.returnDate).toBeUndefined();
    expect(result.departureDate).toBe('2026-09-06');
  });

  it('is deterministic — same inputs always produce the same output', () => {
    const query = {
      departureWindowStart: '2026-11-01',
      departureWindowEnd: '2026-12-15',
      stayMinNights: 5,
      stayMaxNights: 9,
      tripType: 'ROUND_TRIP' as const,
    };
    expect(pickRepresentativeDates(query, 5, 9)).toEqual(pickRepresentativeDates(query, 5, 9));
  });

  it('throws INVALID_QUERY when the window is missing', () => {
    expect(() => pickRepresentativeDates({ tripType: 'ROUND_TRIP' }, 5, 9)).toThrow(SerpApiError);
  });
});

// ---------------------------------------------------------------------------
// serpapiProvider (search / healthCheck / buildOutboundUrl), fixture-driven
// ---------------------------------------------------------------------------

describe('serpapi provider', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('EXACT search calls /search once with the right params and returns a mapped batch', async () => {
    vi.stubEnv('SERPAPI_KEY', 'test-key');
    let calledUrl: string | undefined;
    const fetchImpl = vi.fn(async (url: string | URL) => {
      calledUrl = String(url);
      return jsonResponse(200, happyFixture);
    }) as unknown as typeof fetch;
    const provider = createSerpApiProvider({ fetchImpl, clock: () => 1000 });

    const batch = await provider.search(exactQuery());

    expect(batch.providerId).toBe('serpapi');
    expect(batch.retrievedAt).toBe(1000);
    expect(batch.offers.length).toBeGreaterThan(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(calledUrl).toContain('departure_id=SEA');
    expect(calledUrl).toContain('arrival_id=FCO');
    expect(calledUrl).toContain('outbound_date=2026-09-15');
    expect(calledUrl).toContain('return_date=2026-09-23');
    expect(calledUrl).toContain('type=1');
  });

  it('FLEXIBLE search samples exactly one date pair and documents it in a warning', async () => {
    vi.stubEnv('SERPAPI_KEY', 'test-key');
    let calledUrl: string | undefined;
    const fetchImpl = vi.fn(async (url: string | URL) => {
      calledUrl = String(url);
      return jsonResponse(200, happyFixture);
    }) as unknown as typeof fetch;
    const provider = createSerpApiProvider({ fetchImpl, clock: () => 1000 });

    const batch = await provider.search(flexQuery());

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(calledUrl).toContain('outbound_date=2026-09-06');
    expect(batch.warnings.some((w) => w.includes('sampled ONE representative date pair'))).toBe(true);
  });

  it('one-way EXACT search omits return_date', async () => {
    vi.stubEnv('SERPAPI_KEY', 'test-key');
    let calledUrl: string | undefined;
    const fetchImpl = vi.fn(async (url: string | URL) => {
      calledUrl = String(url);
      return jsonResponse(200, { best_flights: [] });
    }) as unknown as typeof fetch;
    const provider = createSerpApiProvider({ fetchImpl, clock: () => 1000 });

    await provider.search(exactQuery({ mode: 'EXACT', tripType: 'ONE_WAY', returnDate: undefined }));

    expect(calledUrl).not.toContain('return_date=');
    expect(calledUrl).toContain('type=2');
  });

  it('throws MISSING_KEY when SERPAPI_KEY is unset', async () => {
    vi.stubEnv('SERPAPI_KEY', undefined);
    const provider = createSerpApiProvider({ fetchImpl: vi.fn() as unknown as typeof fetch });

    await expect(provider.search(exactQuery())).rejects.toMatchObject({ code: 'MISSING_KEY' });
  });

  it('healthCheck: OK on a fast successful account call, with searches-left detail', async () => {
    vi.stubEnv('SERPAPI_KEY', 'test-key');
    const fetchImpl = vi.fn(async () => jsonResponse(200, { total_searches_left: 123 })) as unknown as typeof fetch;
    const provider = createSerpApiProvider({ fetchImpl, clock: () => 0 });

    const health = await provider.healthCheck();
    expect(health.status).toBe('OK');
    expect(health.details).toContain('123');
  });

  it('healthCheck: DOWN when SERPAPI_KEY is unset, without attempting a request', async () => {
    vi.stubEnv('SERPAPI_KEY', undefined);
    const fetchImpl = vi.fn();
    const provider = createSerpApiProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const health = await provider.healthCheck();
    expect(health.status).toBe('DOWN');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('healthCheck: DOWN on a persistent failure, DEGRADED on rate limiting', async () => {
    vi.stubEnv('SERPAPI_KEY', 'test-key');
    const downProvider = createSerpApiProvider({
      fetchImpl: vi.fn(async () => jsonResponse(500, {})) as unknown as typeof fetch,
    });
    expect((await downProvider.healthCheck()).status).toBe('DOWN');

    const degradedProvider = createSerpApiProvider({
      fetchImpl: vi.fn(async () => jsonResponse(429, {})) as unknown as typeof fetch,
    });
    expect((await degradedProvider.healthCheck()).status).toBe('DEGRADED');
  });

  it('buildOutboundUrl returns the batch-level google_flights_url for a real mapped offer', async () => {
    vi.stubEnv('SERPAPI_KEY', 'test-key');
    const fetchImpl = vi.fn(async () => jsonResponse(200, happyFixture)) as unknown as typeof fetch;
    const provider = createSerpApiProvider({ fetchImpl, clock: () => 1000 });
    const batch = await provider.search(exactQuery());
    const offer = batch.offers[0];

    expect(provider.buildOutboundUrl?.(offer)).toBe(offer.outboundUrl);
    expect(provider.buildOutboundUrl?.(offer)).toContain('google.com/travel/flights');
  });

  it('buildOutboundUrl returns null for an offer with no outboundUrl (e.g. no search_metadata.google_flights_url)', async () => {
    vi.stubEnv('SERPAPI_KEY', 'test-key');
    const fetchImpl = vi.fn(async () => jsonResponse(200, oneWayNoUrlFixture)) as unknown as typeof fetch;
    const provider = createSerpApiProvider({ fetchImpl, clock: () => 1000 });
    const batch = await provider.search(exactQuery({ tripType: 'ONE_WAY', destination: 'PHX', returnDate: undefined }));

    expect(batch.offers).toHaveLength(1);
    expect(provider.buildOutboundUrl?.(batch.offers[0])).toBeNull();
  });

  it('the exported singleton has providerId "serpapi"', () => {
    expect(serpapiProvider.providerId).toBe('serpapi');
  });
});

// ---------------------------------------------------------------------------
// registry (lib/providers/index.ts)
// ---------------------------------------------------------------------------

describe('getActiveProvider — serpapi registry entry', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('returns serpapi when DATA_PROVIDER=serpapi and SERPAPI_KEY is set', () => {
    vi.stubEnv('DATA_PROVIDER', 'serpapi');
    vi.stubEnv('SERPAPI_KEY', 'a-real-key');
    expect(getActiveProvider()).toBe(serpapiProvider);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('falls back to demo with a warning when DATA_PROVIDER=serpapi but SERPAPI_KEY is missing', () => {
    vi.stubEnv('DATA_PROVIDER', 'serpapi');
    vi.stubEnv('SERPAPI_KEY', undefined);
    expect(getActiveProvider()).toBe(demoProvider);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('SERPAPI_KEY');
  });
});
