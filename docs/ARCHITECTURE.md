# Fare Terminal — Architecture

## Module map

```
providers  →  normalization  →  snapshots  →  events  →  recommendations  →  analyst  →  API  →  UI
```

- **providers** (`lib/providers/`) — one adapter per external flight-data
  source, each implementing `FlightDataProvider` (`lib/providers/types.ts`).
  `lib/providers/index.ts` is the registry: it reads `DATA_PROVIDER` from env
  and returns the active provider. Only a stub `demoProvider` exists today
  (throws `not implemented (WP2)`); WP2 fills it in and adds
  `travelpayouts`.
- **normalization** — raw provider responses are converted into
  `NormalizedOfferBatch` / `NormalizedOffer` (`domain/types.ts`) inside each
  provider's `search()` implementation, so everything downstream only ever
  sees the normalized shape. This keeps provider-specific quirks (date
  formats, currency handling, fare rules) out of the rest of the app.
- **snapshots** — aggregates a window of `offer_observations` for a
  `search_definitions` row into a `market_snapshots` row / `SnapshotMetrics`
  (benchmark price, from-price, median, p25, offer counts, freshness, data
  quality). Reads `config.benchmark` for thresholds. Planned for a later
  work package.
- **events** — compares snapshots and observations over time to detect
  `MarketEvent`s (price drops, volatility spikes, carrier changes, etc. —
  the full `EventType` union lives in `domain/types.ts`). Reads
  `config.eventThresholds`. Planned for a later work package.
- **recommendations** — scores a snapshot + recent events into a
  `RecommendationOutput` (`BUY` / `LEAN_BUY` / `NEUTRAL` / `WAIT` /
  `INSUFFICIENT_DATA`) using the heuristic and thresholds in
  `domain/config.ts` (`recommendationThresholds`,
  `percentileToHistoricalValue`). Planned for a later work package.
- **analyst** — turns a `RecommendationOutput` into human-readable
  `analyst_notes`, either via an LLM (`ANTHROPIC_API_KEY` set) or a
  template fallback. Planned for a later work package.
- **API** — Next.js route handlers under `app/api/**` expose search
  definitions, snapshots, events, and recommendations to the UI. Planned for
  a later work package.
- **UI** — `app/` (pages/layout) and `components/{charts,market,search,ui}`
  render the data. Components should only ever consume the domain types,
  never raw DB rows or raw provider payloads.

## Data flow

1. A `search_definitions` row describes what to search (origin/destination
   scope, dates or flexible window, cabin, etc. — see `db/schema.ts` and the
   mirrored `NormalizedSearchQuery` type).
2. A scheduled or on-demand job (`jobs/`) calls the active provider's
   `search()`, gets back a `NormalizedOfferBatch`, and persists one
   `search_runs` row plus one `offer_observations` row per normalized offer.
3. The snapshot module aggregates recent `offer_observations` into a new
   `market_snapshots` row.
4. The events module compares the new snapshot (and its underlying
   observations) against history and writes any detected `market_events`.
5. The recommendations module scores the snapshot + events into a
   `recommendations` row.
6. The analyst module turns that recommendation into an `analyst_notes`
   row.
7. The API layer reads snapshots/events/recommendations/notes and serves
   them to the UI.

Each arrow above is a module boundary: the only way data crosses it is
through the shared types in `domain/types.ts` (validated at the boundary
with the Zod schemas in `domain/schemas.ts` where the data originates
outside the process, e.g. provider responses or API request bodies). No
module should reach into another module's internals or assume a specific
provider's raw response shape.

## Where later work packages plug in

- **WP2**: implement `demoProvider` (and any real provider) in
  `lib/providers/`, fill in `db/seed/`, add fixtures for `tests/`.
- **WP3+**: snapshot/event/recommendation/analyst modules (new top-level
  dirs alongside `lib/providers/`, e.g. `lib/snapshots/`, `lib/events/`,
  `lib/recommendations/`, `lib/analyst/`), `jobs/` implementations, and
  `app/api/**` route handlers.
- **UI work packages**: fill in `components/{charts,market,search,ui}` and
  the `app/` pages, importing only from `domain/types.ts` and the API layer.

## Configuration

All tunable numbers (benchmark settings, recommendation thresholds, event
thresholds, demo defaults, freshness thresholds) live in a single object,
`config`, exported from `domain/config.ts`. No module should hardcode one of
these values inline — import `config` and reference the field instead, so
every threshold has exactly one source of truth.

## Database

SQLite via `better-sqlite3`, accessed through the Drizzle ORM client in
`db/index.ts`. Schema lives in `db/schema.ts`; migrations are generated with
`drizzle-kit` into `db/migrations/` and applied programmatically by
`db/migrate.ts` (run via `npm run db:setup`). The DB file path is
configurable via `DATABASE_PATH` (default `./data/fare-terminal.db`).
