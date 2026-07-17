# Fare Terminal

Fare Terminal is airfare **market intelligence** — think "stock ticker meets
research terminal" for flight prices, not a booking site. For a set of
tracked airport-pair routes, it turns repeated observed offers into a
current benchmark price, price history, a fair-value range, detected market
events (price drops, carrier moves, volatility spikes, ...), and a
plain-language buy/wait recommendation.

Every claim the app makes is explicitly split into what was **observed**
(a plain factual statement pulled directly from the data — "current
benchmark is $403.00") versus what was **inferred** from it (an
interpretation, always carrying its own confidence level — "consistent with
a neutral signal, high confidence"). Recommendations expose their reasoning
the same way: an "Observed" list, an "Inferred" list, and a
"Counterevidence & limitations" list, so a decision never rests on an
unexplained badge. See the in-app [methodology](/methodology) page for the
full write-up of how every number is computed, and `/about` for what the
tool explicitly is not (a booking engine, a price predictor, or financial
advice).

## Screenshots

Reference screenshots live in `_review/wp5-screens/` one level above this
repo (gitignored — see `.gitignore`, they don't ship with the repo or
render on GitHub). For context, that set illustrates:

- `home-desktop-1440.png` — the Market Pulse home page: demo banner, AI
  market brief, and the "Biggest drops" / "Newly favorable" / "Unusual
  events" card grids.
- `market-jfk-lhr-desktop.png` — a full market page: header with the
  flexible/exact mode toggle, summary card, price history chart, side-by-side
  recommendation + analyst note panels, event timeline, and offer table.
- `market-jfk-lhr-mobile-390.png` — the same market page at a 390px
  viewport: sticky compact price header and the offer card list layout
  (see `tests/e2e/mobile.spec.ts`).
- `methodology-desktop-1440.png` — the methodology page's table of
  contents and worked-through calculation sections.
- `crop-top.png` / `crop-mobile-top.png` — close crops of the sticky
  header/banner treatment at desktop and mobile widths.

## Quickstart

```bash
npm install
npm run db:setup   # creates data/fare-terminal.db and applies migrations
npm run seed       # populates 12 scenario markets with synthetic offers
npm run pipeline   # derives snapshots, events, recommendations, analyst notes
npm run dev         # http://localhost:3000
```

No `.env` file is required for the default demo-data experience — see
`.env.example` for every variable the app reads and what it defaults to.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the Next.js dev server (Turbopack). |
| `npm run build` | Guarded production build (`scripts/build.mjs`) — seeds the DB first if it's missing, then runs `build:next`. See [Deployment](#deployment). |
| `npm run build:next` | Plain `next build`, no seeding. |
| `npm run start` | Start the production server (`next start`) against an already-built app. |
| `npm run lint` | ESLint. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run db:setup` | Create/migrate the SQLite database (`db/migrate.ts`). |
| `npm run seed` | Populate the 12 scenario markets (`db/seed/index.ts`). |
| `npm run pipeline` | Run the full derivation pipeline: backfill → snapshots → events → recommendations → analyst notes (`jobs/pipeline.ts`). |
| `npm run ingest` | Run a single provider ingest pass without the rest of the pipeline (`jobs/ingest.ts`). |
| `npm test` | Unit + integration tests (Vitest). |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run test:e2e` | End-to-end tests (Playwright, chromium) — see [Testing](#testing). |

## Architecture

```
providers  →  normalization  →  snapshots  →  events  →  recommendations  →  analyst  →  API  →  UI
```

- **providers** (`lib/providers/`) — one adapter per external flight-data
  source (`demo`, `travelpayouts`), normalized to a shared offer shape.
- **snapshots / events / recommendations / analyst** (`lib/`, `jobs/`) —
  aggregate observations into benchmark metrics, detect market events,
  score a recommendation, and render it as a human-readable note.
- **API** (`app/api/**`) — Next.js route handlers exposing search
  definitions, snapshots, events, and recommendations to the UI.
- **UI** (`app/`, `components/`) — pages and components that only ever
  consume the shared domain types, never raw DB rows or provider payloads.

Full module map, data flow, and configuration conventions:
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Demo data

By default (`DATA_PROVIDER=demo`, no configuration required) the app runs
entirely on synthetic, deterministic data: real airport codes, but
fictional carriers (Vantage Air, Nimbus, Crosswind, Pacific Fern,
Alpenlicht, Turbina — never a real airline). A persistent banner
("Synthetic demo data. Not current airfare.") is shown on every page
whenever demo mode is active, and freshness is computed relative to the
dataset's own newest observation rather than the real clock, so a demo
deployment never falsely appears to have gone stale.

The seed (`db/seed/markets.ts`) covers 12 routes, each engineered to
demonstrate a specific scenario:

| Route | Scenario | What it demonstrates |
|---|---|---|
| SEA → FCO | `STABLE` | Trading near fair value; also has an EXACT-date definition alongside the flexible one. |
| JFK → LHR | `SHARP_DROP_SURGE` | Sharp price drop + offer-count surge in the last 48h. |
| LAX → HND | `CARRIER_MATCH` | Two carriers drop within hours of each other — a "possible carrier match" event. |
| ORD → CDG | `FARE_BRAND_VANISH` | The lowest fare product ("Basic") disappears from recent observations. |
| MSP → CUN | `INVENTORY_UP` | Inventory (`seatsRemaining`) rises with only a modest price response. |
| DEN → KEF | `VOLATILITY_SPIKE` | Volatility spike in the last 14 days. |
| SFO → BCN | `NEW_LOW` | Current benchmark is a new historical low; also has an EXACT-date definition. |
| ATL → LIS | `STALE_OUTAGE` | Stale data / simulated provider outage: no observations in the last ~10h. |
| BOS → DUB | `SHORT_HISTORY` | Too little history (~6 days) — triggers the `INSUFFICIENT_DATA` recommendation gate. |
| AUS → MEX | `ANOMALY_OFFER` | A single anomalous cheap offer (~40% below batch median) in the latest batch. |
| PDX → YVR | `STABLE` (variant) | Short-haul, low price level, thin carrier mix. |
| DEN → ATL | `STABLE` (variant) | Domestic, higher price level, full carrier mix. |

`tests/e2e/states.spec.ts` exercises the `SHORT_HISTORY` and
`STALE_OUTAGE` scenarios directly (BOS-DUB, ATL-LIS) as the canonical
"insufficient data" and "stale" UI states.

## Switching to real data (TravelPayouts)

Set `DATA_PROVIDER=travelpayouts` and `TRAVELPAYOUTS_TOKEN=<your token>`
(get one at travelpayouts.com → API tab → Data API token). If the token is
unset, the provider registry logs a warning and falls back to `demo` rather
than crashing or making unauthenticated requests.

**Read this before trusting it as a live feed**: TravelPayouts' Data API
returns cached, aggregated "cheapest price seen" observations (up to ~48h
old), not a live GDS/NDC quote — no fare brand, booking class, seat count,
or verified per-leg segments. Every offer from this adapter is flagged
accordingly (`AGGREGATED_CACHED_SOURCE`, `SYNTHETIC_SEGMENTS`, etc.) and
surfaced through the UI's data-quality indicators. Full adapter behavior —
rate limiting, search-mode sampling, affiliate link handling, health
checks — is documented in [`docs/PROVIDERS.md`](docs/PROVIDERS.md).

## Deployment

`npm run build` (`scripts/build.mjs`) is a guarded wrapper around `next
build`:

- If `data/fare-terminal.db` doesn't exist yet, or `SEED_ON_BUILD=1` is
  set, it runs `db:setup` → `seed` → `pipeline` first (with
  `DB_FORCE_WRITABLE=1`, since Vercel sets `VERCEL=1` during the build too,
  which would otherwise make `db/index.ts` open the not-yet-existing DB
  read-only).
- It always finalizes the SQLite file afterward
  (`scripts/finalize-db.mjs`): checkpoints WAL into the main file and
  switches `journal_mode` to `DELETE`, because a WAL-mode database can't be
  opened on Vercel's read-only production filesystem (it can't create the
  `-wal`/`-shm` sidecar files there).
- The DB file then ships as a build artifact (see `next.config.ts`'s
  `outputFileTracingIncludes`) rather than being written to at runtime;
  `db/index.ts` opens it read-only in production (`VERCEL=1`) and writable
  locally.

To refresh the demo dataset's anchor time on a redeploy without a code
change, set `SEED_ON_BUILD=1` for that build. See
[`docs/RUNBOOK.md`](docs/RUNBOOK.md) for the full operational walkthrough.

## Testing

```bash
npm test          # unit + integration (Vitest) — 198+ tests
npm run test:e2e  # end-to-end (Playwright, chromium project only)
```

The e2e suite (`tests/e2e/`) runs against a local dev server on port 3111
(`playwright.config.ts` manages it) and expects `data/fare-terminal.db` to
already exist — run the quickstart's `db:setup && seed && pipeline` first.
It covers: the home/Market Pulse flow, autocomplete search, full market
page content (recommendation disclosure, event timeline, offer table
sorting), URL state round-tripping + Share, the insufficient-data/stale/
not-found states, the outbound booking control, a storage-free smoke check,
a 390px mobile layout check, and a dependency-free accessibility pass
(one `<h1>` per page, accessible names on every button/svg). The full suite
runs in under a minute locally.

## Reference

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — module map, data flow, configuration conventions.
- [`docs/PROVIDERS.md`](docs/PROVIDERS.md) — provider adapter details (demo + TravelPayouts).
- [`docs/RUNBOOK.md`](docs/RUNBOOK.md) — operational how-tos (reseeding, provider rotation, reading pipeline logs, Vercel layout).
- The PRD referenced throughout this codebase's comments (e.g. "PRD §25", "PRD §34.3") is the internal product spec this project was built against; it isn't included in this repository.

## License

All rights reserved. No license has been granted for reuse, modification,
or redistribution of this code at this time. (Placeholder — replace with an
actual license if/when this project is open-sourced.)
