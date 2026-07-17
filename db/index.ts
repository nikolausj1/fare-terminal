// better-sqlite3 + drizzle client. The DB file path comes from the
// DATABASE_PATH env var (default ./data/fare-terminal.db); the containing
// directory is created if it doesn't exist yet (when writable — see below).
//
// Vercel/read-only strategy (WP4): on Vercel, the deployed filesystem is
// read-only except /tmp, and the SQLite file ships as a build artifact (see
// next.config.ts's outputFileTracingIncludes) rather than being written to
// at runtime. Opening the connection `readonly` there avoids "attempt to
// write a readonly database" crashes. Write paths (jobs/**, the refresh API
// route) must check `isDatabaseReadonly()` themselves and degrade
// gracefully instead of calling into a job that would throw. Locally, and
// in tests (which always set DATABASE_PATH to a writable temp file), the DB
// is opened writable as before.

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import * as schema from './schema';

const DEFAULT_DATABASE_PATH = './data/fare-terminal.db';

export function resolveDatabasePath(): string {
  return process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH;
}

/** True when the DB connection should be opened read-only: on Vercel
 * (VERCEL=1, set automatically by the platform) or when DB_READONLY=1 is
 * set explicitly (useful for local testing of the read-only code paths). */
export function isDatabaseReadonly(): boolean {
  return process.env.VERCEL === '1' || process.env.DB_READONLY === '1';
}

const databasePath = resolveDatabasePath();
const readonly = isDatabaseReadonly();

if (!readonly) {
  const databaseDir = path.dirname(databasePath);
  if (!fs.existsSync(databaseDir)) {
    fs.mkdirSync(databaseDir, { recursive: true });
  }
}

export const sqlite = readonly
  ? new Database(databasePath, { readonly: true, fileMustExist: true })
  : new Database(databasePath);

if (!readonly) {
  sqlite.pragma('journal_mode = WAL');
}
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

export type DbClient = typeof db;
