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

Scheduled ingestion **is** configured — see "Real data operations" below
for the GitHub Action that keeps a dedicated real-data database current.

## Real data operations

This section covers the real-data database (`data/real.db`), which is
kept entirely separate from the synthetic demo database
(`data/fare-terminal.db`) — see `scripts/bootstrap-real.ts`'s module
docstring for why the two must never share a file.

### The three commands

Run in this order, always with `DATABASE_PATH=data/real.db` so nothing
touches the demo DB:

```bash
DATABASE_PATH=data/real.db DATA_PROVIDER=travelpayouts npm run bootstrap:real
DATABASE_PATH=data/real.db DATA_PROVIDER=travelpayouts npm run ingest
DATABASE_PATH=data/real.db DATA_PROVIDER=travelpayouts npm run pipeline
```

- **`bootstrap:real`** — idempotent. Creates/migrates `data/real.db` and
  upserts airports/market_scopes/search_definitions for the tracked
  roster. Never inserts observations; safe to re-run any time (e.g. after
  editing the roster) without losing history. Deactivates any definition
  no longer in the roster so `ingest` stops spending budget on it.
- **`ingest`** — one sweep: calls the live TravelPayouts provider for
  every active search definition and persists whatever real offers come
  back.
- **`pipeline`** — derives snapshots -> events -> recommendations ->
  analyst notes from whatever observations exist so far.

### The roster

The tracked markets live in `REAL_MARKETS` in
`scripts/bootstrap-real.ts` — currently 10 markets, chosen by *measured*
Aviasales cache coverage rather than the demo's scenario needs (the
cached Data API is dense on international trunk routes and thin-to-empty
on many US domestic/secondary routes). Each entry's comment records the
probed offer count at the time it was added.

**Coverage-probe method** — before adding a candidate route to the
roster, confirm TravelPayouts actually has cached data for it with a
direct `curl` call (never print the token or marker themselves — pull
them from `.env` into a shell variable first so they never appear in your
terminal history/scrollback as literal text):

```bash
source <(grep -E '^TRAVELPAYOUTS_TOKEN=' .env)
curl -s -H "x-access-token: $TRAVELPAYOUTS_TOKEN" \
  "https://api.travelpayouts.com/aviasales/v3/prices_for_dates?origin=JFK&destination=LHR&departure_at=2026-09&one_way=false&currency=usd" \
  | head -c 2000
```

Swap `origin`/`destination`/`departure_at` for the candidate route and a
near-term month. A `"success": true` response with a non-empty `"data"`
array means the route has cache coverage; an empty array (or several
empty months in a row) means skip it — see `docs/PROVIDERS.md`'s
"Real-world response notes" section for how sparse this cache is on
non-marquee routes. Unset the shell variable (`unset TRAVELPAYOUTS_TOKEN`)
when you're done probing.

### The Action

`.github/workflows/real-data-refresh.yml` runs the three commands above
on a **6-hour cron** (plus `workflow_dispatch` for a manual run), using
the `TRAVELPAYOUTS_TOKEN`/`TRAVELPAYOUTS_MARKER` repo secrets, then
commits `data/real.db` back to `main` **only if it changed**
(`git diff --staged --quiet` guard) with message
`chore: refresh real airfare data [skip ci]`. A `concurrency` group
ensures overlapping runs queue rather than race each other against the
same DB file.

**This file cannot be pushed from this machine yet** — the local `gh`
token lacks the `workflow` scope required to push anything under
`.github/workflows/`, and that same line is currently in `.gitignore` as
a result. See the cutover checklist below for the unlock steps.

Because `data/*` is gitignored with an explicit `!data/real.db`
exception (see `.gitignore`), the Action's commit doesn't need any
special force-push machinery — `real.db` is trackable like any other
file; the demo DB and both DBs' `-wal`/`-shm` sidecars stay ignored.
Nothing about this repo auto-stages `data/real.db` outside that Action —
the lead decides when the first real DB lands in git.

### Production cutover checklist

1. **Unlock the workflow push scope**: `gh auth refresh -h github.com -s workflow`,
   then remove the `.github/workflows/` line from `.gitignore`, commit,
   and push `real-data-refresh.yml` (and `ci.yml`) to `main`. Confirm
   `TRAVELPAYOUTS_TOKEN`/`TRAVELPAYOUTS_MARKER` are present under repo
   Settings -> Secrets and variables -> Actions (already set, per WP-D).
2. **Let history accumulate**: leave the Action running on its 6-hour
   cron for **2-3 days** before flipping production over. Recommendations
   require `minHistoryForRecommendation` (`domain/config.ts`) = **10
   snapshots** per market before they activate (`INSUFFICIENT_DATA`
   otherwise) — at one snapshot per 6-hour run, that's ~60 hours (2.5
   days) of unattended runs to clear the gate across the whole roster.
3. **Flip production to real data**: in the Vercel project's Environment
   Variables (Production), set `DATABASE_PATH=data/real.db`, then
   redeploy (a redeploy is required — this only takes effect on the next
   build, since the DB ships as a build artifact per
   [Deployment](#where-things-live-on-vercel) below).
4. **Verify**: load the production site and confirm the demo banner
   ("Synthetic demo data. Not current airfare.") is gone, replaced by the
   cached-data disclosure (`AGGREGATED_CACHED_SOURCE` /
   `DataSourceMode.AGGREGATED_CACHED`, derived automatically from
   `search_runs.provider_id` — see `lib/markets/dataSourceMode.ts`, no
   separate flag to flip). Spot-check a market page shows real carriers
   and a live recommendation, not `INSUFFICIENT_DATA`.

### Rollback

Unset `DATABASE_PATH` in Vercel's production Environment Variables (or
set it back to unset/`./data/fare-terminal.db`) and redeploy. The build
reverts to shipping the synthetic demo DB and the demo banner reappears —
no code change or data loss involved; `data/real.db` keeps accumulating
history via the Action in the background regardless of what production is
currently pointed at.

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
