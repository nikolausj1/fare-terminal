#!/usr/bin/env node
// Prepares the SQLite build artifact for a read-only filesystem (Vercel):
// a WAL-mode database cannot be opened read-only when SQLite can't create
// its -wal/-shm sidecar files, so checkpoint everything into the main file
// and switch the journal mode to DELETE before `next build` traces it.

import Database from 'better-sqlite3';

const databasePath = process.env.DATABASE_PATH ?? './data/fare-terminal.db';

const db = new Database(databasePath);
db.pragma('wal_checkpoint(TRUNCATE)');
db.pragma('journal_mode = DELETE');
db.close();
console.log(`[finalize-db] ${databasePath}: WAL checkpointed, journal_mode=DELETE.`);
