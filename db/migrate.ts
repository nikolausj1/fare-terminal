// Runs drizzle migrations programmatically. Invoked via `npm run db:setup`.

import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import { db, resolveDatabasePath, sqlite } from './index';

function main() {
  console.log(`Migrating database at ${resolveDatabasePath()}...`);
  migrate(db, { migrationsFolder: './db/migrations' });
  console.log('Migrations complete.');
  sqlite.close();
}

main();
