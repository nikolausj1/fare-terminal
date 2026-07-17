#!/usr/bin/env node
// Guarded production build: `npm run build` == `npm run build:next` (plain
// `next build`) most of the time — it only runs db:setup/seed/pipeline
// first when there's no DB file to build against yet, or when the caller
// explicitly asks for a fresh one via SEED_ON_BUILD=1.
//
// This matters for Vercel deploys: the SQLite file ships as a build
// artifact (see next.config.ts's outputFileTracingIncludes), so the first
// build (or any build where SEED_ON_BUILD=1 is set, e.g. to refresh the
// demo dataset's anchor time) needs to create + populate + derive it before
// `next build` traces and bundles data/fare-terminal.db. Subsequent builds
// with the file already present just run the fast `next build` path.
//
// Local dev doesn't go through this at all — `npm run dev` doesn't build,
// and `npm run db:setup && npm run seed && npm run pipeline` remain
// available directly for anyone who wants to reseed by hand.

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const databasePath = process.env.DATABASE_PATH ?? './data/fare-terminal.db';
const forceReseed = process.env.SEED_ON_BUILD === '1';
const dbMissing = !existsSync(databasePath);

function run(command, args, extraEnv = {}) {
  console.log(`[build] $ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (dbMissing || forceReseed) {
  console.log(
    `[build] ${dbMissing ? `no DB file at ${databasePath}` : 'SEED_ON_BUILD=1'} — running db:setup + seed + pipeline before next build.`
  );
  // Vercel sets VERCEL=1 during the build too, which would make db/index.ts
  // open the (not-yet-existing) DB read-only. These three steps are the ones
  // that CREATE it, so they get an explicit writable override.
  const writable = { DB_FORCE_WRITABLE: '1' };
  run('npm', ['run', 'db:setup'], writable);
  run('npm', ['run', 'seed'], writable);
  run('npm', ['run', 'pipeline'], writable);
}

// Always finalize: a WAL-mode SQLite file cannot be opened on Vercel's
// read-only filesystem (SQLITE_CANTOPEN creating -wal/-shm sidecars).
run('node', ['scripts/finalize-db.mjs'], { DB_FORCE_WRITABLE: '1' }); else {
  console.log(`[build] DB file present at ${databasePath} and SEED_ON_BUILD is not set — skipping seed/pipeline.`);
}

run('npm', ['run', 'build:next']);
