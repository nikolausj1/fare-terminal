# Public API

Read-only, unauthenticated endpoints for citing or embedding Fare Terminal
market data. No API key, no auth header, no rate-limit tier — a modest
Vercel-level ceiling is the only backstop (see [Rate limits](#rate-limits)
below). Every endpoint here is additive to (not a replacement for) the
in-app pages at `/market/[origin]/[destination]` — those remain the
canonical, most-detailed view.

This document itself is not served by the app (it's a repo file, not a
route) — ShareButton's "Embed data" action links to the live JSON endpoint
for the market you're on, and this file explains that endpoint's contract.

## Endpoints

### `GET /api/public/markets`

Every actively tracked market, one row per route, its current benchmark,
percent change, percentile, and freshness.

```json
{
  "markets": [
    {
      "origin": "JFK",
      "destination": "LHR",
      "originCity": "New York",
      "destinationCity": "London",
      "slug": "jfk-lhr-flexible",
      "url": "https://fare-terminal.vercel.app/market/jfk/lhr",
      "currency": "USD",
      "windowDescription": "Anytime in 21-90 days, 5-9 night stay",
      "priceReliable": true,
      "benchmarkPriceMinor": 41700,
      "changePct24h": -3.2,
      "changePct7d": -8.1,
      "percentile": 86,
      "dataQuality": 0.92,
      "freshness": { "ageSeconds": 5321, "isStale": false },
      "dataSourceMode": "AGGREGATED_CACHED"
    }
  ],
  "count": 12,
  "generatedAt": 1767139200000,
  "datasetAnchorAt": 1767138900000
}
```

`Cache-Control: public, s-maxage=1800, stale-while-revalidate=3600` — treat
this as refreshing roughly every 30 minutes; don't poll faster than that.

### `GET /api/public/markets/[origin]/[destination]`

One market's public summary card (same shape as an entry in the list above,
under `market`) plus its last 90 days of benchmark-price history.

```json
{
  "market": { "origin": "JFK", "destination": "LHR", "...": "as above" },
  "history": [
    { "snapshotAt": 1764547200000, "benchmarkPriceMinor": 44200, "dataQualityScore": 0.91 },
    { "snapshotAt": 1764633600000, "benchmarkPriceMinor": 43100, "dataQualityScore": 0.93 }
  ]
}
```

`404` (`{"error":{"code":"NOT_FOUND","message":"..."}}`) when
`origin`/`destination` isn't a currently tracked route.
`Cache-Control: public, s-maxage=1800, stale-while-revalidate=3600`.

### `GET /feed/market-pulse.xml`

RSS 2.0. One `<item>` per market event of severity `MEDIUM` or `HIGH`
detected in the last 7 days, across every tracked market, plus (when index
data is available) one daily `<item>` for the Fare Terminal Index. Titles
look like `JFK→LHR: Price drop -12% ($417)` when the underlying event
carries a parseable price signal, else `JFK→LHR: {event label} — {first
observed fact}`.

`Content-Type: application/rss+xml; charset=utf-8`,
`Cache-Control: public, s-maxage=3600, stale-while-revalidate=7200`.

### `GET /api/og/market/[origin]/[destination]`

1200×630 PNG share card (`Content-Type: image/png`): route, current
benchmark, 24h/7d change, percentile line, and a 30-day sparkline. Renders a
neutral fallback card (no price shown) for an untracked route or when the
underlying benchmark is flagged `priceReliable: false` — this endpoint never
renders a bare `$0`.

### `GET /api/og/index`

1200×630 PNG share card for the Fare Terminal Index: current value, 1-day
change, and a 90-day sparkline.

## Fields

| Field | Meaning |
|---|---|
| `priceReliable` | `false` means the latest observation didn't clear the minimum data-quality bar to trust as a real price — `benchmarkPriceMinor`/`changePct*`/`percentile` are `null` in that case rather than a misleading `$0` or `-100%`. |
| `benchmarkPriceMinor` | Integer cents (minor units). Divide by 100 for a display price. |
| `changePct24h` / `changePct7d` | Signed percent change vs. the nearest snapshot ~24h / ~7d prior. `null` when no comparable snapshot exists yet. |
| `percentile` | "Cheaper than X% of observed history" — `null` when there's not enough compatible history yet. |
| `dataQuality` | 0-1 score behind the current snapshot; see the in-app [methodology](/methodology#data-quality) page. |
| `freshness.ageSeconds` / `.isStale` | Age of the current snapshot relative to the dataset's own newest observation (not real wall-clock time) — see `dataSourceMode` below for why. |
| `dataSourceMode` | `DEMO` (synthetic data), `AGGREGATED_CACHED` (real, cached/aggregated observations — not live quotes), or `MIXED` (should never happen; a data-integrity tripwire). |

## Freshness semantics

Every "how old is this" field is computed relative to the **dataset's own
newest observation**, not the real wall clock. A demo or cached-aggregate
deployment that hasn't ingested in a while should read as "N hours old
data", not silently drift into looking broken relative to real time. Always
check `freshness.isStale` (and `dataSourceMode`) before treating a number as
current.

## Attribution

If you cite or embed this data (a screenshot, a markdown link, an embedded
chart), please attribute **Fare Terminal** and link back to the relevant
`/market/[origin]/[destination]` page — that's also where the full
methodology, confidence bands, and "observed vs. inferred" breakdown live,
which a bare number out of context doesn't carry.

## No-guarantee disclaimer

This is **market intelligence, not a live quote**. Prices are derived from
periodically observed, cached/aggregated data (see `dataSourceMode`) — they
are not guaranteed bookable, may lag real-time availability, and are not
financial or travel-booking advice. Always verify the actual price on the
airline or OTA's own site before booking. See `/about` and `/methodology`
for the full scope of what this tool is (and explicitly isn't).

## Rate limits

No app-level rate limiting is implemented for these endpoints today — the
short `s-maxage` cache windows above are the practical throttle (repeat
requests within the window are served from Vercel's edge cache, not
re-computed). If you need a guaranteed, higher-volume feed, please reach out
rather than polling aggressively; a shared-store rate limiter (this app
already has a pattern for one — see the market refresh endpoint) is a
natural next step if usage warrants it.
