// Minimal typed fetch wrapper for SerpApi's Google Flights engine
// (https://serpapi.com/google-flights-api) and its Account API
// (https://serpapi.com/account-api). Deliberately mirrors
// lib/providers/travelpayouts/client.ts's shape (timeout, single retry on
// 5xx, typed error, injectable fetch) so the two adapters read the same way
// — see that file's header comment for the rationale. The one structural
// difference: SerpApi authenticates via an `api_key` *query parameter*
// (there is no header-based auth option), so callers must be careful never
// to log a built URL verbatim — see maskUrl() below, used only for error
// messages/logging, never for the actual request.

const DEFAULT_BASE_URL = 'https://serpapi.com';
const DEFAULT_TIMEOUT_MS = 15_000;
// Initial attempt + one retry. Only 5xx and network/timeout failures are
// retried; 429 and 4xx are terminal on the first attempt (see get() below).
const MAX_ATTEMPTS = 2;

export type SerpApiErrorCode =
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'HTTP_ERROR'
  | 'NETWORK_ERROR'
  | 'INVALID_QUERY'
  | 'PARSE_ERROR'
  | 'MISSING_KEY';

/** Typed error for every failure mode surfaced by the SerpApi adapter. */
export class SerpApiError extends Error {
  readonly code: SerpApiErrorCode;
  readonly status?: number;
  readonly endpoint: string;

  constructor(code: SerpApiErrorCode, endpoint: string, status?: number, message?: string) {
    super(message ?? `serpapi ${code} at ${endpoint}${status !== undefined ? ` (status ${status})` : ''}`);
    this.name = 'SerpApiError';
    this.code = code;
    this.status = status;
    this.endpoint = endpoint;
  }
}

export type QueryParams = Record<string, string | number | boolean | undefined>;

function buildUrl(baseUrl: string, path: string, params: QueryParams): string {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/** Redacts the api_key query param — used only when a URL might end up in a
 * log line or error message, never for the actual request. */
function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.searchParams.has('api_key')) {
      u.searchParams.set('api_key', 'REDACTED');
    }
    return u.toString();
  } catch {
    return url;
  }
}

// Jittered linear backoff: attempt is the 1-based count of the attempt that
// just failed (1 on the first failure).
function backoffMs(attempt: number): number {
  const base = 250 * attempt;
  const jitter = Math.random() * 150;
  return base + jitter;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface SerpApiClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export interface SerpApiClient {
  get<T>(path: string, params?: QueryParams): Promise<T>;
}

export function createSerpApiClient(options: SerpApiClientOptions): SerpApiClient {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiKey = options.apiKey;

  async function doFetch(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function get<T>(path: string, params: QueryParams = {}): Promise<T> {
    const url = buildUrl(baseUrl, path, { ...params, api_key: apiKey });
    const safeUrl = maskUrl(url);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await doFetch(url);

        if (response.status === 429) {
          // Never retried: retrying into a rate limit only makes it worse.
          throw new SerpApiError('RATE_LIMITED', safeUrl, 429, 'SerpApi rate limit exceeded (429)');
        }

        if (!response.ok) {
          const retryable = response.status >= 500;
          if (retryable && attempt < MAX_ATTEMPTS) {
            await delay(backoffMs(attempt));
            continue;
          }
          throw new SerpApiError(
            retryable ? 'SERVER_ERROR' : 'HTTP_ERROR',
            safeUrl,
            response.status,
            `SerpApi request failed with status ${response.status}`
          );
        }

        // Note: SerpApi returns HTTP 200 even for in-band failures (bad
        // api_key, invalid params, "Google hasn't returned any results...");
        // those are signaled via a top-level `error` string in the JSON body
        // rather than an HTTP error status. Deliberately NOT special-cased
        // here — same choice travelpayouts/client.ts makes — so this stays a
        // thin transport layer; mapping.ts (which already declares `error`
        // as an optional schema field) treats it as "0 offers" plus a
        // warning quoting the message, exactly like an empty result. See
        // mapGoogleFlights() and the malformed/empty fixture in
        // tests/unit/fixtures/serpapi/malformed-empty.json.
        try {
          return (await response.json()) as T;
        } catch {
          throw new SerpApiError('PARSE_ERROR', safeUrl, response.status, 'Failed to parse SerpApi JSON response');
        }
      } catch (err) {
        if (err instanceof SerpApiError) {
          throw err;
        }
        // Network error (fetch rejected) or abort/timeout — retried once.
        if (attempt < MAX_ATTEMPTS) {
          await delay(backoffMs(attempt));
          continue;
        }
        const message = err instanceof Error ? err.message : String(err);
        throw new SerpApiError('NETWORK_ERROR', safeUrl, undefined, `SerpApi request failed: ${message}`);
      }
    }

    // Unreachable — the loop above always returns or throws — but keeps
    // TypeScript's control-flow analysis happy about the return type.
    throw new SerpApiError('NETWORK_ERROR', safeUrl, undefined, 'SerpApi request failed after retries');
  }

  return { get };
}
