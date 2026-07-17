// better-sqlite3 + drizzle client. The DB file path comes from the
// DATABASE_PATH env var (default ./data/fare-terminal.db); the containing
// directory is created if it doesn't exist yet.

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import * as schema from './schema';

const DEFAULT_DATABASE_PATH = './data/fare-terminal.db';

export function resolveDatabasePath(): string {
  return process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH;
}

const databasePath = resolveDatabasePath();
const databaseDir = path.dirname(databasePath);
if (!fs.existsSync(databaseDir)) {
  fs.mkdirSync(databaseDir, { recursive: true });
}

export const sqlite = new Database(databasePath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

export type DbClient = typeof db;
