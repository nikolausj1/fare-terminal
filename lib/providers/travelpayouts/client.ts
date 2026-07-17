// Minimal typed fetch wrapper for the TravelPayouts / Aviasales Data API
// (https://api.travelpayouts.com). Kept deliberately small: auth header,
// timeout, a single retry on transient failures, and a typed error. The
// fetch implementation is injectable so tests never hit the network — see
// tests/unit/travelpayouts.test.ts.

const DEFAULT_BASE_URL = 'https://api.travelpayouts.com';
const DEFAULT_TIMEOUT_MS = 10_000;
// Initial attempt + one retry. Only 5xx and network/timeout failures are
// retried; 429 and 4xx are terminal on the first attempt (see get() below).
const MAX_ATTEMPTS = 2;

export type ProviderErrorCode =
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'HTTP_ERROR'
  | 'NETWORK_ERROR'
  | 'INVALID_QUERY'
  | 'PARSE_ERROR'
  | 'MISSING_TOKEN';

/** Typed error for every failure mode surfaced by the Travelpayouts adapter. */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status?: number;
  readonly endpoint: string;

  constructor(code: ProviderErrorCode, endpoint: string, status?: number, message?: string) {
    super(
      message ?? `travelpayouts ${code} at ${endpoint}${status !== undefined ? ` (status ${status})` : ''}`
    );
    this.name = 'ProviderError';
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

export interface TravelpayoutsClientOptions {
  token: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export interface TravelpayoutsClient {
  get<T>(path: string, params?: QueryParams): Promise<T>;
}

export function createTravelpayoutsClient(options: TravelpayoutsClientOptions): TravelpayoutsClient {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const token = options.token;

  async function doFetch(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url, {
        method: 'GET',
        headers: {
          'x-access-token': token,
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function get<T>(path: string, params: QueryParams = {}): Promise<T> {
    const url = buildUrl(baseUrl, path, params);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await doFetch(url);

        if (response.status === 429) {
          // Never retried: retrying into a rate limit only makes it worse.
          // The caller's own token-bucket limiter (see index.ts) is meant
          // to keep us from getting here at all.
          throw new ProviderError('RATE_LIMITED', path, 429, 'Travelpayouts rate limit exceeded (429)');
        }

        if (!response.ok) {
          const retryable = response.status >= 500;
          if (retryable && attempt < MAX_ATTEMPTS) {
            await delay(backoffMs(attempt));
            continue;
          }
          throw new ProviderError(
            retryable ? 'SERVER_ERROR' : 'HTTP_ERROR',
            path,
            response.status,
            `Travelpayouts request failed with status ${response.status}`
          );
        }

        try {
          return (await response.json()) as T;
        } catch {
          throw new ProviderError(
            'PARSE_ERROR',
            path,
            response.status,
            'Failed to parse Travelpayouts JSON response'
          );
        }
      } catch (err) {
        if (err instanceof ProviderError) {
          throw err;
        }
        // Network error (fetch rejected) or abort/timeout — retried once.
        if (attempt < MAX_ATTEMPTS) {
          await delay(backoffMs(attempt));
          continue;
        }
        const message = err instanceof Error ? err.message : String(err);
        throw new ProviderError('NETWORK_ERROR', path, undefined, `Travelpayouts request failed: ${message}`);
      }
    }

    // Unreachable — the loop above always returns or throws — but keeps
    // TypeScript's control-flow analysis happy about the return type.
    throw new ProviderError('NETWORK_ERROR', path, undefined, 'Travelpayouts request failed after retries');
  }

  return { get };
}
