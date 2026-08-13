# Providers

Fare Terminal's provider layer (`lib/providers/`) is the only place raw,
source-specific data enters the app; everything downstream (normalization,
snapshots, events, recommendations, analyst, API, UI) only ever sees the
shared `NormalizedOffer` / `NormalizedOfferBatch` shape from `domain/types.ts`.
See `docs/ARCHITECTURE.md` for the full module map.

Three providers exist today:

- **`demo`** (`lib/providers/demo.ts`) — fully synthetic, deterministic data.
  Default; requires no configuration.
- **`travelpayouts`** (`lib/providers/travelpayouts/`) — real data from the
  TravelPayouts / Aviasales Data API (`https://api.travelpayouts.com`).
- **`serpapi`** (`lib/providers/serpapi/`) — real data from SerpApi's Google
  Flights engine (`https://serpapi.com/google-flights-api`), routed to a
  small personal roster of 8 SEA routes the free travelpayouts cache barely
  covers. See the dedicated "SerpApi" section below.

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

## Real-world response notes (WP-B, live testing 2026-07-24)

Everything above was written against the Travelpayouts docs and hand-written
fixtures before this adapter had ever been pointed at a real token. WP-B
activated a real `TRAVELPAYOUTS_TOKEN`, ran real ingestion sweeps into a
dedicated `data/real.db` (see `scripts/bootstrap-real.ts` /
`npm run bootstrap:real` — never the demo `data/fare-terminal.db`), and found
two real quirks the original fixtures didn't cover, both now fixed and
fixture-tested with fixtures captured from live responses (see
`tests/unit/fixtures/travelpayouts/*-real-2026-07-24.json`, and the new
`describe(...against a real captured response...)` blocks in
`tests/unit/travelpayouts.test.ts`).

### 1. `origin`/`destination` are CITY codes, not airport codes — and the adapter was ignoring the fields that are

`priceForDatesItemSchema` already declared `origin_airport`/
`destination_airport` as optional fields, but `mapPricesForDates` never
actually read them — it built every offer from the plain `origin`/
`destination` fields instead. Those turn out to be **city** codes (e.g. a
real JFK→LHR response reports `"origin": "NYC"`, `"destination": "LON"`),
while `origin_airport`/`destination_airport` carry the actual airport flown
(`"JFK"`, `"LHR"`). For a single-airport city (DEN, ATL, LAX, ...) the two
happen to coincide, which is why this went unnoticed against routes like
that; a multi-airport city (New York, London, Tokyo — real captured example:
LAX→HND reported `destination: "TYO"` vs. `destination_airport: "HND"`)
exposes it immediately.

Fix (`lib/providers/travelpayouts/mapping.ts`): both `mapPricesForDates` and
`mapCalendar` now resolve origin/destination via a shared
`resolveAirportCode()` helper that prefers `origin_airport`/
`destination_airport` and only falls back to the city code when the airport
field is absent, in which case the offer is tagged with the new quality flag
**`CITY_CODE_FALLBACK`** and a batch warning is emitted (this fallback path
is unit-tested but has not yet been observed live — the *_airport fields
were present on every real offer captured so far).

### 2. `/v1/prices/calendar` uses `departure_at`/`return_at`, not `depart_date`/`return_date`

The original `calendarItemSchema` and `mapCalendar` only recognized
`depart_date`/`return_date`, per older Travelpayouts docs/examples. A real
calendar response (`origin=MSP&destination=CUN&depart_date=2026-08`)
returned `departure_at`/`return_at` instead — matching `prices_for_dates`'
naming, not the documented calendar-specific names. Because `mapCalendar`
falls back to the response's own date-string object key when `depart_date`
is absent, this didn't crash or even warn — it silently mapped every
calendar-sourced offer as one-way (the real `return_at` value was being
dropped by the schema, since zod strips unrecognized keys), discarding a
real return leg.

Fix: `calendarItemSchema` now accepts both `depart_date`/`return_date` and
`departure_at`/`return_at`; `mapCalendar` prefers the latter
(`item.departure_at ?? item.depart_date ?? dateKey`, similarly for the
return field) since that's what live traffic has actually shown.

### 3. `prices_for_dates` at month granularity is honestly very sparse for round-trip searches on non-marquee routes

This one is real-world data scarcity, not a bug — recorded here because it
directly explains the offer counts in a real sweep. The FLEXIBLE search
mode's month-level `prices_for_dates` query
(`departure_at=YYYY-MM&return_at=YYYY-MM`, both the same month, matching the
5–9 night stay window used by the demo market catalog) returned **zero**
offers for 7 of the 12 demo markets (`msp-cun`, `den-kef`, `atl-lis`,
`bos-dub`, `aus-mex`, `pdx-yvr`, `den-atl`) across all 3 sampled months, in
two separate live sweeps. Only busier international routes (`jfk-lhr`,
`lax-hnd`, `ord-cdg`, `sfo-bcn`, `sea-fco`) had round-trip cache hits at
month granularity. This was confirmed to be real cache sparsity, not a
request-shape mistake, by cross-checking with `/v1/prices/calendar` (which
aggregates "cheapest price per day" more broadly): it *does* have real
cached round-trip fares for some of these routes (e.g. `DEN→ATL`: a real
F9 $298 round trip, `MSP→CUN`: real F9 $653 and AA $548 round trips) — but
for dates outside the demo market's 21–90-day search window (a few days out,
or over a year out), so they're correctly excluded by the existing
window/stay-length filter rather than fabricated into the result.

Mitigation added (`lib/providers/travelpayouts/index.ts#searchFlexible`):
when the primary `prices_for_dates` sampling comes back completely empty
across all sampled months, the adapter makes **one** additional
`/v1/prices/calendar` call (for the first sampled month only, to bound the
extra request cost) and merges in anything real found there, tagging those
offers with the new quality flag **`CALENDAR_FALLBACK_SOURCE`**. This is a
genuine improvement (it recovers real data when the calendar cache has
something prices_for_dates didn't), but it did not flip any of the 7 thin
demo markets to non-empty in live testing on 2026-07-24 — their calendar
data, where it existed at all, fell outside the search window. Two real
sweeps (see the ingestion log in `STATUS.md`/final report) both landed at
**5 of 12 markets with real offers** (28 offers each time, reproducible).
This is the honest state of Travelpayouts' cache for these specific
routes/dates as of this writing, not an adapter defect — see the "What data
this actually is" section above.

### 4. Extra real-world fields tolerated without any schema change

Real responses carry several fields beyond what either schema declares —
`gate` (the OTA/booking partner name, e.g. `"Kiwi.com"`, `"Skytripfare"`),
`duration_to`/`duration_back` (the real outbound/return leg durations —
notably, `prices_for_dates` *does* sometimes report the true split rather
than only a combined `duration`, but this adapter does not yet use them;
see the Ideas Shelf in `STATUS.md`), and a much longer `link` value than the
original fixtures modeled (a full search-session path with `search_date`,
`expected_price_uuid`, `static_fare_key`, etc.). All of these pass through
harmlessly today because zod's default object parsing strips unrecognized
keys instead of failing — exactly the design the original fixtures'
comments called out, now confirmed against live traffic.

### Operational note: Dropbox and SQLite don't mix well for *new* files

Unrelated to the API itself, but cost real time during WP-B: this repo lives
inside a Dropbox-synced folder. Opening a **brand-new** (just-created)
sqlite file with `better-sqlite3` from inside that folder can hang
indefinitely — Dropbox's client briefly holds an exclusive lock on a
just-created/just-modified file while it hashes and syncs it, and
`better-sqlite3`'s blocking OS-level file-lock acquisition has no timeout.
An **existing, already-synced** file (like `data/fare-terminal.db`) opens
instantly; only first-time creation of a new file is affected.
`scripts/bootstrap-real.ts` works around this itself (pre-creates an empty
file and waits ~8s before opening a connection to it), but any other tooling
that creates a brand-new sqlite file in this repo should do the same or
expect an indefinite hang. This is distinct from the previously-documented
`node_modules` dehydration gotcha (`Unknown system error -70`).

---

# SerpApi (WP-P3)

`lib/providers/serpapi/` talks to SerpApi's Google Flights engine
(`https://serpapi.com/search?engine=google_flights`), which scrapes the real
Google Flights results page rather than aggregating a provider's own cached
search history the way travelpayouts does. It exists for one purpose: a
personal roster of 8 routes out of SEA (`domain/config.ts#serpapi.routes` —
FCO, CDG, OGG, LIH, PHX, MSP, MKE, NCE) that the free travelpayouts Data API
cache has little or no real coverage for (see `scripts/bootstrap-real.ts`'s
`REAL_MARKETS` comments and the WP-F2 audit it references). SerpApi's free
tier (250 searches/month) is enough to sweep exactly these 8 routes once a
day with headroom to spare — see "Budget model" below. TUS is deliberately
**not** in this roster (owner decision) — it stays watch-level only via the
"From Seattle" home board / city-directions (`domain/config.ts#homeBoard`,
WP-P1), never a tracked `search_definitions` row here.

**sea-mke is a special case: it switches providers on an existing
definition.** `sea-mke-flex-v1` already exists as an **active travelpayouts**
full-tracking definition (WP-P1's roster) before WP-P3 ever runs.
`scripts/bootstrap-serpapi.ts` recognizes the existing slug and reuses it
(idempotent select-then-skip — never a duplicate). Once `SERPAPI_KEY` is set,
`jobs/ingest.ts`'s per-definition routing (below) means that SAME
definition's ingestion switches from travelpayouts to serpapi, with no
migration and no new row. This produces intentionally **mixed-provider
history on one definition** — accepted by design: both travelpayouts and
serpapi observations are real, `search_runs.provider_id` records which
produced each one, and the jump in itinerary depth/quality metadata at the
switchover is itself informative (visible via each observation's
`qualityFlags` — travelpayouts' vs. serpapi's differ, see "What data this
actually is" below), not something to hide or backfill away.

## Activating it

Set:

```
SERPAPI_KEY=<your SerpApi private API key>
```

**Getting a key**: sign up at https://serpapi.com, then go to "Your Account"
and copy the "Private API Key" field. No affiliate/marker concept exists
here (unlike Travelpayouts) — `buildOutboundUrl()` just returns Google's own
`google_flights_url` when SerpApi provides one, with nothing appended.

**Where the key goes** (three places, since this app runs in three
contexts):

1. **Local `.env`** — `SERPAPI_KEY=...`, same as any other local env var
   (see `.env.example`).
2. **Vercel** — Project Settings → Environment Variables → add
   `SERPAPI_KEY` for the environments that run `npm run ingest` (or
   whatever cron/job invokes it).
3. **GitHub Actions secret** — if ingestion runs via a GH Actions workflow/
   cron rather than (or in addition to) Vercel, add `SERPAPI_KEY` as a
   repository secret and reference it as `env: SERPAPI_KEY:
   ${{ secrets.SERPAPI_KEY }}` in that workflow.

**This is NOT gated by `DATA_PROVIDER`.** Travelpayouts and demo are chosen
globally via `DATA_PROVIDER`; serpapi is instead routed **per
search_definitions row** by `jobs/ingest.ts`, independent of whatever
`DATA_PROVIDER` is set to — see "Per-definition routing" below. Setting
`DATA_PROVIDER=serpapi` directly is also supported (`lib/providers/index.ts`
registers it, with the same missing-key-falls-back-to-demo behavior
travelpayouts has), but that would route *every* definition through serpapi,
which is not how this app actually uses it day to day; it's there mainly for
ad-hoc/manual testing of the provider in isolation.

| Condition | Result |
|---|---|
| `SERPAPI_KEY` unset | serpapi-routed definitions are skipped every ingest run (logged once, no error); every other definition is unaffected |
| `SERPAPI_KEY` set | serpapi-routed definitions are searched via serpapi, subject to the budget gate below |

## Per-definition routing (`jobs/ingest.ts`)

`search_definitions` has no provider column — provider selection is entirely
config-driven, computed fresh on every ingest run:

1. For each active definition, `isSerpApiRouteSlug(def.slug)` strips the
   `-flex-vN`/`-exact-vN` suffix (`lib/providers/serpapi/index.ts#routeIdFromSlug`)
   and checks the resulting route id against `domain/config.ts#serpapi.routes`.
2. If it matches and `SERPAPI_KEY` is set, the budget gate (below) decides
   whether to actually search this run; if allowed, the definition is
   searched via `serpapiProvider` directly (bypassing `getActiveProvider()`
   entirely) and the resulting `search_runs.provider_id` is `"serpapi"`.
3. If it matches and `SERPAPI_KEY` is unset, the definition is skipped this
   run (counted in `IngestSummary.serpapiSkippedNoKey`, logged once per run,
   not per definition).
4. Every other definition uses `getActiveProvider()` exactly as before
   WP-P3 — nothing about travelpayouts/demo selection changed.

One consequence: a route can be "created by bootstrap-real.ts" (travelpayouts
roster) and later become serpapi-routed purely by being added to
`domain/config.ts#serpapi.routes` — no migration, no re-creation. This
actually happens for SEA-FCO: `scripts/bootstrap-real.ts`'s `REAL_MARKETS`
already contains `sea-fco` (thin travelpayouts coverage, kept as a flagship
example), and `scripts/bootstrap-serpapi.ts` recognizes the existing
`sea-fco-flex-v1` definition and reuses it rather than creating a duplicate.
From the moment `sea-fco` is in `config.serpapi.routes` (it always is) AND
`SERPAPI_KEY` is set, that one definition's ingestion switches from
travelpayouts to serpapi — the row itself never changes, only which provider
`jobs/ingest.ts` picks for it that run.

## Budget model

SerpApi's free plan is **250 searches/month**; a search only counts against
this quota when it queries the `google_flights` engine — the Account API
(used by `healthCheck()`) is explicitly free and quota-exempt per SerpApi's
docs.

This app self-limits to **240 searches/month**
(`domain/config.ts#serpapi.monthlySearchBudget`), leaving 10 as headroom for
manual/ad-hoc searches sharing the same key. Two independent gates, both
enforced by `lib/providers/serpapi/budget.ts#evaluateSerpApiBudget` (a pure
function — see its tests for the injected-counts approach) and applied by
`jobs/ingest.ts` immediately before it would otherwise call
`serpapiProvider.search()`:

1. **Monthly cap**: `COUNT(*)` of `search_runs` rows with
   `provider_id='serpapi'` and `started_at` in the current UTC calendar
   month must be below 240. This is a plain query against the *existing*
   `search_runs` table — **no new usage-counter table or column was added**;
   counting real search_runs rows was judged simpler and can't drift out of
   sync with reality the way a separately-maintained counter could.
2. **Daily gate**: at most one serpapi search per `search_definitions` row
   per UTC calendar day (`domain/config.ts#serpapi.sweepsPerDay`, always `1`
   today), checked against `MAX(started_at)` for that definition's own prior
   serpapi runs.

**Arithmetic, and why the last day(s) of long months may skip**: 8 routes ×
1 sweep/day × up to 31 days = **up to 248** searches in the longest months —
above the 240 cap. This is a deliberate simplicity tradeoff (a hard cap, not
a per-day-prorated budget): once the monthly cap is hit, every remaining
serpapi-routed definition is skipped (logged, `IngestSummary.serpapiSkippedBudget`)
for the rest of that calendar month, resuming automatically at the next UTC
month boundary. In a 28-31 day month this means roughly the last 0-8 sweeps
of the month are skipped, never the first ones — worst case, the very end of
a 31-day month goes a few days without a fresh serpapi observation for these
8 routes. Given this is a personal-use feature (not the app's primary data
source), that tradeoff was chosen over the complexity of a prorated/
lookahead budget.

## Search modes and date sampling

- **EXACT** (`query.mode === 'EXACT'`): one call with the exact
  `outbound_date`/`return_date` (round trip) or just `outbound_date`
  (one-way) — maps directly, no sampling needed.
- **FLEXIBLE** (`query.mode === 'FLEXIBLE'`): unlike travelpayouts (which can
  cheaply sample a whole month via `prices_for_dates`), every SerpApi call
  spends a real search-budget credit — there is no cheaper "search a date
  range" shape for Google Flights. So FLEXIBLE mode samples **exactly one**
  representative date pair per search
  (`lib/providers/serpapi/index.ts#pickRepresentativeDates`, pure and
  deterministic): the departure date is the **midpoint** of
  `[departureWindowStart, departureWindowEnd]`, and (for round trips) the
  return date is that midpoint plus the **midpoint stay length** of
  `[stayMinNights, stayMaxNights]` (or the definition's own values). A batch
  warning always documents which date pair was actually sampled. Treat
  FLEXIBLE serpapi results as one directional data point per sweep, not an
  exhaustive scan of the window.

## What data this actually is, and how it differs from travelpayouts

SerpApi's Google Flights engine scrapes the same results page a user would
see browsing Google Flights directly — real, currently-priced itineraries,
not a cached "cheapest seen" aggregate. Every offer this adapter produces
carries **`LIVE_SEARCH_SOURCE`** in `qualityFlags` to reflect that: this is
the closest thing to a live quote anywhere in this app, and — unlike
travelpayouts — segments are **real per-leg itinerary data** (actual
connection airports, flight numbers, travel class per leg), never
synthesized. No `SYNTHETIC_SEGMENTS` flag exists on serpapi offers.

That said, two real limitations surfaced building against a live captured
response (`tests/unit/fixtures/serpapi-real-sea-fco-2026-08-02.json`, a real
SEA→FCO round-trip search) mean this data isn't flawless either — both
flagged rather than silently absorbed:

1. **`NAIVE_LOCAL_TIMESTAMPS`** — every offer. SerpApi's
   `departure_airport.time`/`arrival_airport.time` are local-airport clock
   strings (`"2026-09-15 18:05"`) with **no UTC offset or timezone name**.
   This adapter has no airport→timezone resolver, so it treats each leg's
   *departure* time as if it were a UTC instant (a labeling choice, not a
   real UTC instant) and derives that leg's *arrival* from the leg's own
   `duration` field (which Google computes correctly regardless of
   timezone) — it deliberately does **not** separately re-parse
   `arrival_airport.time` the same naive way, because that airport is
   usually in a different real timezone than the departure airport, and
   naively diffing two different-timezone naive timestamps silently
   corrupts elapsed time for almost every itinerary. Per-leg durations and
   the overall `total_duration` (when present) stay correct either way;
   what's *not* trustworthy is the absolute wall-clock instant on any single
   segment timestamp.
2. **`OUTBOUND_ONLY_SEGMENTS`** — round-trip queries only. A round-trip
   Google Flights search is a two-step flow: the response this adapter
   fetches (its *only* call, to conserve budget) returns outbound-direction
   itinerary options only, each carrying a `departure_token` a *second*
   search would need to fetch the matching return-leg options. `price` is
   already the full round-trip total, but `segments` covers only the
   outbound direction. Confirmed directly against the real captured
   SEA→FCO fixture: only `SEA→FRA→FCO` legs are present, nothing for the
   `FCO→SEA` return. This adapter does not make the second, token-keyed call
   (it would double the budget cost per search), so round-trip serpapi
   offers should be read as "this outbound itinerary, priced at the
   round-trip total" rather than a complete two-direction itinerary. A
   ONE_WAY query's single direction is genuinely complete and never carries
   this flag.

Other honesty notes, mirroring travelpayouts' style:

- `fareBrand`, `bookingClasses`, `seatsRemaining` are always left
  `undefined`; `optionalFeesKnown` is always `false` — SerpApi doesn't
  surface fare-brand/refund-rule/seat-count data.
- `validatingCarrier`/`marketingCarriers`/`operatingCarriers` are derived
  from each leg's `flight_number` prefix (e.g. `"DE 2033"` → `"DE"`), not
  SerpApi's separate `airline` field (a full name like `"Condor"`) — kept as
  short IATA-style codes for consistency with how the rest of the app
  (carrier-match event detection, the demo carrier catalog) already treats
  this field.
- `outboundUrl` comes from the response's top-level
  `search_metadata.google_flights_url` when present — one URL per search,
  not per offer (Google doesn't expose a per-itinerary deep link the way
  travelpayouts' per-offer `link` does), so every offer from the same batch
  shares the same outbound URL.
- `providerOfferId` is a SHA-1 hash (truncated, prefixed `sp_`) of route,
  every segment's origin/destination/departure/flight-number, price, the
  option's `departure_token` (when present), and the request's
  `retrievedAt` — deterministic for identical inputs.

## Client behavior (`client.ts`)

- Auth via the `api_key` **query parameter** (SerpApi has no header-auth
  option) — never logged verbatim; error messages/URLs are redacted via
  `maskUrl()` before being included in any thrown error or log line.
- 15s request timeout via `AbortController`.
- One retry, with jittered backoff, on a 5xx response or a network/timeout
  error. Never retries a 429 or a non-429 4xx — same policy as the
  travelpayouts client.
- SerpApi returns **HTTP 200 even for in-band failures** (bad key, invalid
  params, "Google hasn't returned any results..."), signaled via a
  top-level `error` string in the JSON body rather than an HTTP error
  status. The client does **not** special-case this (kept as a thin
  transport layer, matching travelpayouts/client.ts) — `mapGoogleFlights()`
  treats it exactly like an empty result: 0 offers plus a warning quoting
  the message. See `tests/unit/fixtures/serpapi/malformed-empty.json`.
- All failures surface as a typed `SerpApiError { code, status, endpoint }`
  (`code` is one of `RATE_LIMITED | SERVER_ERROR | HTTP_ERROR |
  NETWORK_ERROR | INVALID_QUERY | PARSE_ERROR | MISSING_KEY`).
- The fetch implementation is injectable (`fetchImpl` option) — every test
  in `tests/unit/serpapi-*.test.ts` runs against fixture JSON, never a live
  network call.

## Health check

`healthCheck()` calls SerpApi's Account API (`GET /account.json`) — free of
charge and explicitly quota-exempt, so it's safe to call regardless of the
search budget above. Status mapping:

- Success, latency ≤ 5s → `OK` (details include `total_searches_left` when
  present).
- Success, latency > 5s → `DEGRADED`.
- Failure due to the client-side/server-side rate limit → `DEGRADED`.
- `SERPAPI_KEY` unset, or any other failure (5xx after retry, network error,
  timeout) → `DOWN`.

## Terms of service note

SerpApi's Google Flights engine works by scraping Google Flights' results
page server-side, not by calling an official Google-published flights API —
this is SerpApi's whole business model and is explicit in their own
documentation/marketing. This adapter is scoped to **personal use** (8
routes the owner personally tracks, well within the free tier), consistent
with that. It should not be scaled up into a general-purpose, high-volume
flights backend without separately reviewing SerpApi's terms of service for
that kind of usage.

## Fixtures

`tests/unit/fixtures/serpapi/` holds hand-written fixtures (a minimal
one-way response, and a malformed/empty response covering skip-with-warning
paths). `tests/unit/fixtures/serpapi-real-sea-fco-2026-08-02.json` (repo
root of `fixtures/`, not the `serpapi/` subfolder — kept where it was
captured) is a REAL response captured against the live API for a SEA→FCO
round trip (2026-09-15/23) — 3 `best_flights` + 9 `other_flights`, cheapest
$690 Condor with 2 real legs via FRA — and is the primary happy-path fixture
for round-trip mapping, layovers, and the `OUTBOUND_ONLY_SEGMENTS`/
`NAIVE_LOCAL_TIMESTAMPS` flags. Its `api_key` value is redacted.
