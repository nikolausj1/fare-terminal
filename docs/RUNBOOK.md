# Runbook

Short operational reference. For architecture/data-flow background see
[`ARCHITECTURE.md`](ARCHITECTURE.md); for provider adapter details see
[`PROVIDERS.md`](PROVIDERS.md).

## Reseeding the demo with a fresh anchor date

The demo dataset is anchored to whichever instant `DEMO_NOW` resolved to
(or real `Date.now()` if unset) at the last `npm run seed` /
`npm run pipeline` run — see `lib/demo-time.ts`. The UI itself never
compares against the real wall clock (`getDatasetAnchor()` in
`lib/markets/queries.ts` uses the newest `observed_at` in the DB instead),
so a demo deployment doesn't visibly "go stale" over time on its own. You'd
reseed to:

- refresh event windows (SHARP_DROP_SURGE, VOLATILITY_SPIKE, etc. are
  defined relative to the anchor) so they read as "recent" again in a demo
  or screenshot,
- or after a schema/methodology change, so all snapshots share the current
  `methodologyVersion`.

**Locally:**

```bash
rm -f data/fare-terminal.db*
DEMO_NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)" npm run db:setup
DEMO_NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)" npm run seed
DEMO_NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)" npm run pipeline
```

(Set `DEMO_NOW` to a fixed ISO timestamp instead of `date -u ...` if you
want a reproducible, non-"now" anchor — e.g. to match a specific
screenshot or bug report.) Then commit/redeploy however `data/` is
distributed for your environment (it's gitignored locally — see
[Deployment](#vercel-layout) below for how it reaches Vercel).

**On Vercel, without a local reseed:** set the `SEED_ON_BUILD=1`
environment variable for the project (or for a one-off redeploy) and
trigger a redeploy. `scripts/build.mjs` sees `SEED_ON_BUILD=1`, wipes ahead
and reruns `db:setup && seed && pipeline` (with `DB_FORCE_WRITABLE=1`, see
below) before `next build`, so the freshly built deployment ships a
newly-anchored dataset. Unset `SEED_ON_BUILD` afterward (or leave it — the
guard only re-seeds when it's `1`) so routine redeploys don't re-seed every
time.

## Rotating to the TravelPayouts provider

1. Get a Data API token: travelpayouts.com → sign up → API tab → Data API
   token. Also grab your affiliate marker from the same dashboard if
   you're enrolled in the affiliate program.
2. Set `DATA_PROVIDER=travelpayouts` and `TRAVELPAYOUTS_TOKEN=<token>`
   (and `TRAVELPAYOUTS_MARKER=<marker>` if you want outbound booking links
   to carry attribution — without it, `buildOutboundUrl()` returns `null`
   rather than an unmarked link).
3. Redeploy / restart the dev server. `lib/providers/index.ts` reads
   `DATA_PROVIDER` at call time; if the token is missing it logs a warning
   and silently falls back to `demo` rather than crashing.
4. Run `npm run ingest` (single pass) or `npm run pipeline` (full
   derivation) to populate real observations. The demo banner
   (`components/ui/DemoBanner.tsx`) disappears automatically once
   `DATA_PROVIDER` isn't `demo`.
5. Read [`PROVIDERS.md`](PROVIDERS.md) in full before trusting the output
   for anything real — TravelPayouts data is cached/aggregated (up to
   ~48h old), not a live quote, and several offer fields are
   synthesized/estimated to fit the shared offer shape. `TP_MAX_REQUESTS_PER_HOUR`
   (default 100, ceiling ~200/hr/IP per TravelPayouts' own docs) governs
   how aggressively you can poll — see PROVIDERS.md's "Ingestion cadence
   recommendation" for sizing guidance against the ~14-market seed catalog.

There is currently no scheduled/cron ingestion configured in this repo —
`npm run pipeline` (or `npm run ingest`) needs to be triggered externally
(a cron job, a Vercel Cron/GitHub Actions schedule, etc.) for a
`travelpayouts` deployment to stay current. Wiring that up is a deployment
concern outside this codebase.

## Reading pipeline logs

`npm run pipeline` (`jobs/pipeline.ts`) runs five stages in order —
backfill → snapshots → events → recommendations → analyst-notes — and logs
one line per stage:

```
[pipeline] backfill: 812ms { ... summary object ... }
[pipeline] snapshots: 340ms { ... }
[pipeline] events: 128ms { ... }
[pipeline] recommendations: 95ms { ... }
[pipeline] analyst-notes: 2104ms { ... }
```

- **Duration** — wall-clock time for that stage. `analyst-notes` is
  usually the slowest stage when `ANALYST_LLM=1` (real API calls); it's
  fast when falling back to template generation (the default).
- **Summary object** — stage-specific counts (e.g.
  `DeriveAnalystNotesSummary`: `definitionsProcessed`, `notesCreated`,
  `llmUsed`, `templateUsed`, `skippedNoRecommendation`). A stage that
  processed 0 rows when you expected activity usually means an upstream
  stage produced nothing new (e.g. no new snapshots → nothing for events
  to compare against) — check the upstream stage's summary first rather
  than assuming the current stage is broken.
- Any `SqliteError` or unhandled exception aborts the run — the pipeline
  does not swallow DB errors. LLM failures inside `analyst-notes` are the
  one deliberate exception: they're caught and fall back to a template
  note per-definition rather than aborting the whole run (see
  `jobs/analyst-notes.ts`'s module docstring).

Run a single stage directly (each job file also has a CLI entry via
`isMainModule`/`runCli` in `jobs/_shared.ts`) if you only need to
re-derive one layer, e.g. `npx tsx jobs/recommendations.ts`.

## Where things live on Vercel

- **Build**: `npm run build` → `scripts/build.mjs`. Seeds the DB only if
  `data/fare-terminal.db` is missing or `SEED_ON_BUILD=1`, then always
  runs `scripts/finalize-db.mjs` (WAL checkpoint + `journal_mode=DELETE`,
  required because Vercel's production filesystem is read-only and can't
  create SQLite's `-wal`/`-shm` sidecar files), then `next build`.
- **Runtime**: `data/fare-terminal.db` ships as a build artifact (see
  `next.config.ts`'s `outputFileTracingIncludes`, which explicitly
  includes it for every route since Next's default tracing only follows
  import/require/fs usage, not a runtime-opened DB file path). `db/index.ts`
  opens it read-only whenever `VERCEL=1` is set (i.e. always, on Vercel)
  unless `DB_FORCE_WRITABLE=1` overrides it.
- **Write paths at runtime** (the refresh API route, any job invoked
  on-demand) must check `isDatabaseReadonly()` (`db/index.ts`) themselves
  and degrade gracefully — Vercel's production filesystem rejects writes
  outside `/tmp`.
- **Env vars**: set via the Vercel project's Environment Variables UI —
  see `.env.example` for the full list with descriptions. At minimum for a
  demo deployment, none are required; for a `travelpayouts` deployment,
  `DATA_PROVIDER` + `TRAVELPAYOUTS_TOKEN` (+ `TRAVELPAYOUTS_MARKER`).
