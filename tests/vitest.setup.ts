// Global test setup: force DATABASE_PATH to a per-process temp file unless a
// test explicitly set its own before importing '@/db'.
//
// Why this exists (CI outage, 2026-08-13): db/index.ts opens its sqlite
// connection at import time using DATABASE_PATH with a repo-relative default
// (./data/fare-terminal.db). Any test that transitively imports it without
// overriding the path CREATES an empty, zero-table DB file in the working
// tree as a side effect. Locally that file already exists (seeded), so
// nobody noticed — but in CI's fresh checkout the leftover empty file made
// scripts/build.mjs's "DB file present, skip seeding" guard pass, and
// `next build` then prerendered against a database with no tables
// (SqliteError: no such table: search_runs). Tests must never be able to
// write the repo's real demo-DB path.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (!process.env.DATABASE_PATH) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fare-terminal-test-'));
  process.env.DATABASE_PATH = path.join(dir, 'default-test.db');
}
