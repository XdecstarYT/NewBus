import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';
import { env, SERVER_ROOT } from '../env';

export type DB = BetterSQLite3Database<typeof schema>;

/**
 * Single shared connection. better-sqlite3 is synchronous, so every service call
 * runs to completion without interleaving; `atomic()` wraps work in a real
 * SQLite transaction (nested calls become savepoints) for all-or-nothing writes.
 */
export let sqlite: Database.Database;
export let db: DB;

export function openDb(file = env.databasePath): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  db = drizzle(sqlite, { schema });
  return db;
}

export function runMigrations() {
  migrate(db, { migrationsFolder: path.join(SERVER_ROOT, 'drizzle') });
}

export function closeDb() {
  try {
    sqlite?.close();
  } catch {}
}

/** Run `fn` inside a transaction. Throwing rolls everything back. */
export function atomic<T>(fn: () => T): T {
  return sqlite.transaction(fn)();
}

export { schema };
