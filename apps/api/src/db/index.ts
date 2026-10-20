/**
 * Database access. Production: Supabase Postgres through postgres.js (transaction
 * pooler, so no prepared statements). Tests and zero-setup local play: PGlite.
 * Pending migrations are applied once per process, under a transaction lock.
 */
import { sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import * as schema from './schema';
import { MIGRATIONS } from './migrations.gen';
import { GameError } from '../lib/errors';

export { schema };
export type Db = PgDatabase<any, typeof schema>;

let ready: Promise<Db> | null = null;
let injected: Db | null = null;

/** Tests and the local dev server hand in their own database. */
export function useDb(db: Db) {
  injected = db;
  ready = migrate(db).then(() => db);
}

export function databaseUrl() {
  return (process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL || process.env.NETLIFY_DATABASE_URL || '').trim();
}

async function connect(): Promise<Db> {
  if (injected) return injected;
  const url = databaseUrl();
  if (!url) throw new GameError(503, 'no_database', 'The game has no database yet: set DATABASE_URL in Netlify (Site configuration > Environment variables) to your Supabase connection string, then redeploy.');
  const { default: postgres } = await import('postgres');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const client = postgres(url, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });
  return drizzle(client, { schema }) as unknown as Db;
}

export function getDb(): Promise<Db> {
  if (!ready) {
    ready = connect().then(async (db) => {
      await migrate(db);
      return db;
    });
    ready.catch(() => (ready = null));
  }
  return ready;
}

/** Rows from db.execute, whichever driver is underneath. */
export function rows<T = Record<string, unknown>>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  return ((res as { rows?: T[] })?.rows ?? []) as T[];
}

async function migrate(db: Db) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(724301)`);
    await tx.execute(sql`CREATE TABLE IF NOT EXISTS public._dw_migrations (name text PRIMARY KEY, applied_at bigint NOT NULL)`);
    const done = new Set(rows<{ name: string }>(await tx.execute(sql`SELECT name FROM public._dw_migrations`)).map((r) => r.name));
    let applied = 0;
    for (const m of MIGRATIONS) {
      if (done.has(m.name)) continue;
      for (const stmt of m.sql.split('--> statement-breakpoint')) {
        if (stmt.trim()) await tx.execute(sql.raw(stmt));
      }
      await tx.execute(sql`INSERT INTO public._dw_migrations (name, applied_at) VALUES (${m.name}, ${Date.now()})`);
      applied++;
    }
    if (applied) await lockDown(tx as unknown as Db);
  });
}

/** Keep the game tables away from Supabase's public API: RLS on, no grants for anon/authenticated. */
async function lockDown(db: Db) {
  const tables = rows<{ t: string }>(await db.execute(sql`SELECT tablename AS t FROM pg_tables WHERE schemaname = 'live'`));
  for (const { t } of tables) await db.execute(sql.raw(`ALTER TABLE live."${t}" ENABLE ROW LEVEL SECURITY`));
  await db.execute(sql.raw(`ALTER TABLE public._dw_migrations ENABLE ROW LEVEL SECURITY`));
  const roles = rows<{ r: string }>(await db.execute(sql`SELECT rolname AS r FROM pg_roles WHERE rolname IN ('anon', 'authenticated')`));
  for (const { r } of roles) {
    await db.execute(sql.raw(`REVOKE ALL ON SCHEMA live FROM ${r}`));
    await db.execute(sql.raw(`REVOKE ALL ON ALL TABLES IN SCHEMA live FROM ${r}`));
  }
}
