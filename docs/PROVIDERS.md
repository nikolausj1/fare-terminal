# Providers

Fare Terminal's provider layer (`lib/providers/`) is the only place raw,
source-specific data enters the app; everything downstream (normalization,
snapshots, events, recommendations, analyst, API, UI) only ever sees the
shared `NormalizedOffer` / `NormalizedOfferBatch` shape from `domain/types.ts`.
See `docs/ARCHITECTURE.md` for the full module map.

Two providers exist today:

- **`demo`** (`lib/providers/demo.ts`) — fully synthetic, deterministic data.
  Default; requires no configuration.
- **`travelpayouts`** (`lib/providers/travelpayouts/`) — real data from the
  TravelPayouts / Aviasales Data API (`https://api.travelpayouts.com`). This
  document is about that adapter.

## Activating it

Set:

```
DATA_PROVIDER=travelpayouts
TRAVELPAYOUTS_TOKEN=<your token>
TRAVELPAYOUTS_MARKER=<your affiliate marker>   # optional, see below
TP_MAX_REQUESTS_PER_HOUR=100                    # optional, default 100
```

**Getting a token**: sign up at https://www.travelpayouts.com, then go to the
API tab in your dashboard and generate a Data API token. The same dashboard
has your affiliate "marker" (a numeric id) if you're also enrolled in the
affiliate program — see the "Affiliate links and attribution" section below
for why you'd want one.

**Fallback behavior**: `lib/providers/index.ts#getActiveProvider()` checks
`TRAVELPAYOUTS_TOKEN` at call time. If `DATA_PROVIDER=travelpayouts` but the
token is unset, it logs a warning to the console and returns the `demo`
provider instead — the app never crashes or silently makes unauthenticated
requests because of a missing token.

| `DATA_PROVIDER` | `TRAVELPAYOUTS_TOKEN` | Result |
|---|---|---|
| unset | — | `demo` |
| `demo` | — | `demo` |
| `travelpayouts` | set | `travelpayouts` |
| `travelpayouts` | unset | `demo` (+ console warning) |
| anything else | — | throws `Unknown DATA_PROVIDER` |

## What data this actually is (read this before trusting it)

TravelPayouts' Data API does **not** give you a live GDS/NDC quote. The
endpoints this adapter calls —

- `GET /aviasales/v3/prices_for_dates` — cheapest cached fare(s) for a
  specific date or date pair.
- `GET /v1/prices/calendar` — cheapest cached fare per day across a month.

— return **cached, aggregated "cheapest price seen" observations**, sourced
from real Aviasales user searches, not a query the adapter itself triggers
against an airline in real time. Per TravelPayouts' own documentation, cache
entries can be up to ~48 hours old and are retained for 2-7 days. There is no
guarantee the fare is still bookable at that price, or at all.

Consequences for the offer model:

1. **`AGGREGATED_CACHED_SOURCE`** is added to `qualityFlags` on every offer
   this adapter produces. Nothing from `travelpayouts` should ever be treated
   as "verified available now" — it's a signal about the market, not a
   bookable quote.
2. **No segment-level data.** The API returns one airline code, one flight
   number, and one total duration per result — never a real per-leg
   itinerary (connection airports, layover times, actual stop-by-stop
   segments). To fit the `NormalizedOffer.segments` shape, this adapter
   *synthesizes* segments:
   - One-way (or no `return_at`): a single segment, `origin` -> `destination`,
     using the reported `duration` as flight time.
   - Round trip (`return_at` present): two segments (outbound and inbound).
     The API's `duration` field for round trips is the *combined* outbound +
     return flight time — there is no way to recover the true split from
     this endpoint, so the adapter assumes an even 50/50 split and flags the
     offer with `ESTIMATED_LEG_SPLIT`.
   - If `duration` is missing entirely, the adapter falls back to a fixed
     300-minute placeholder and flags `ESTIMATED_DURATION`.
   Every offer also carries **`SYNTHETIC_SEGMENTS`** for this reason — the
   segments exist so the shared `NormalizedOffer` contract is satisfied and
   `itineraryFingerprint()` has something real to hash, not because the API
   gave us verified leg data.
3. **No fare brand, booking class, or seat count.** `fareBrand`,
   `bookingClasses`, and `seatsRemaining` are always left `undefined`, and
   `optionalFeesKnown` is always `false` — the API tells you nothing about
   change/refund rules, cabin sub-product, or bag fees.
4. **`observedAt` is the adapter's retrieval time, not the original
   observation time.** `prices_for_dates` and `/v1/prices/calendar` don't
   reliably expose *when* the underlying cache entry was written (that
   timestamp, `found_at`, lives on the separate `/v2/prices/latest`
   endpoint, which this adapter does not call). Rather than fabricate
   precision we don't have, `observedAt` is set to the time the adapter made
   the request. The calendar endpoint's `expires_at`, when present, *is*
   preserved on `NormalizedOffer.expiresAt` — so downstream freshness logic
   at least knows when the cached price is due to expire, even though it
   doesn't know exactly when it was cached.
5. **`providerOfferId`** is a SHA-1 hash (truncated, prefixed `tp_`) of
   route, dates, airline, flight number, price, and either the source's
   `expires_at` (calendar) or the request's `retrievedAt` (prices_for_dates,
   which has no per-item timestamp) — deterministic for identical inputs,
   distinct when the price or any identifying field changes.

None of this makes the data useless — it's a real signal about what fares
have recently been seen on a route, at scale, for free/cheap — but the UI's
data-quality surfacing (via `qualityFlags`, `NormalizedOfferBatch.warnings`,
and the eventual snapshot `dataQualityScore`) exists specifically so a user
never mistakes a `travelpayouts` offer for a live, bookable, fully-specified
fare the way a GDS/NDC integration would provide.

## Search modes

- **EXACT** (`query.mode === 'EXACT'`): one call to `prices_for_dates` with
  the exact `departureDate`/`returnDate` (or just `departureDate` for
  one-way), `one_way` set from `tripType`, `direct` set from
  `maxStops === 0`.
- **FLEXIBLE** (`query.mode === 'FLEXIBLE'`): `prices_for_dates` doesn't
  support a date *range* query, so the adapter samples it at **month
  granularity** — one call per calendar month touched by
  `[departureWindowStart, departureWindowEnd]`, capped at **3 calls** per
  search to keep a single search cheap relative to the account-wide hourly
  budget. If the window spans more than 3 months, only the first 3 are
  sampled and a warning says so. Results are then filtered to offers whose
  outbound date falls inside the window and — when both segments and
  `stayMinNights`/`stayMaxNights` are present — whose stay length falls
  inside those bounds. `NormalizedOfferBatch.warnings` always documents the
  sampling (which months) and the aggregated-cache caveat.

## Rate limiting

TravelPayouts documents a limit of roughly **200 requests/hour per IP**.
`lib/providers/travelpayouts/rateLimiter.ts` implements a simple in-process
sliding-window token bucket, defaulting to **100 requests/hour**
(`TP_MAX_REQUESTS_PER_HOUR`) — well under the documented ceiling, leaving
headroom for the health check and any manual/ad-hoc calls sharing the same
process. When the budget is exhausted, the limiter throws
`ProviderError('RATE_LIMITED', ...)` immediately (it rejects rather than
queues — see the code comment for why). The HTTP client
(`lib/providers/travelpayouts/client.ts`) separately never retries an actual
429 response from the server, to avoid making a rate-limit situation worse.

**Operational note**: the limiter's state is an in-memory array scoped to
the Node process. It is *not* shared across serverless function instances or
process restarts, so in a horizontally-scaled or serverless deployment the
effective aggregate budget can exceed the configured per-process number.
Size `TP_MAX_REQUESTS_PER_HOUR` conservatively (or add a shared/external rate
limiter) if you deploy this adapter across multiple instances.

### Ingestion cadence recommendation

The PRD's target search-definition catalog is on the order of **~14 tracked
markets**. At 100 req/hour and up to 3 requests per FLEXIBLE search (1 for
EXACT), a full sweep of 14 flexible searches costs up to 42 requests — well
within budget for **hourly** polling, with plenty of headroom left for
health checks and any EXACT/ad-hoc lookups triggered by the UI in the same
window. If the catalog grows substantially, either lower the polling
frequency (e.g. every 2-4 hours) or raise `TP_MAX_REQUESTS_PER_HOUR` up
toward (not past) the documented 200/hour ceiling.

## Client behavior (`client.ts`)

- Auth via the `x-access-token` header (never in the URL/query string).
- 10s request timeout via `AbortController` (configurable via the client's
  `timeoutMs` option; no env var today).
- One retry, with jittered backoff, on a 5xx response or a network/timeout
  error. **Never** retries a 429 (respects the server's rate limit) or a
  non-429 4xx (a bad request won't fix itself on retry).
- All failures surface as a typed `ProviderError { code, status, endpoint }`
  (`code` is one of `RATE_LIMITED | SERVER_ERROR | HTTP_ERROR |
  NETWORK_ERROR | INVALID_QUERY | PARSE_ERROR | MISSING_TOKEN`).
- The fetch implementation is injectable (`fetchImpl` option), which is how
  `tests/unit/travelpayouts.test.ts` exercises retry/rate-limit behavior
  without any live network calls — every test in that file runs against
  hand-written fixture JSON in `tests/unit/fixtures/travelpayouts/`.

## Affiliate links and attribution

`buildOutboundUrl(offer)` turns the raw `link` path TravelPayouts returns
into `https://www.aviasales.com<link>`. TravelPayouts' program terms expect
booking traffic sent through their data to carry your affiliate marker, so:

- If `TRAVELPAYOUTS_MARKER` is set, the returned URL has `?marker=<value>`
  appended.
- If it is **not** set, `buildOutboundUrl()` returns `null` rather than an
  unmarked deep link — this adapter would rather surface no outbound link
  than send traffic in a way that's out of compliance with the program
  terms.

## Health check

`healthCheck()` makes one cheap `GET /v1/prices/calendar` call for the
current month on a fixed, reliably-busy canary route (JFK-LAX) — not a real
user search. Status mapping:

- Success, latency ≤ 3s → `OK`.
- Success, latency > 3s → `DEGRADED`.
- Failure due to the client-side or server-side rate limit → `DEGRADED`
  (transient — the account/IP is over budget, not down).
- Any other failure (5xx after retry, network error, timeout, missing
  token) → `DOWN`.
