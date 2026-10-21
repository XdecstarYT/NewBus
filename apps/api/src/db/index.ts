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

/**
 * Built-in connection for the Supabase project, so the game works on Netlify with no
 * settings at all. The login (dw_game) can only use this game's tables. Set
 * DATABASE_URL to use a different database instead.
 */
const PROJECT = 'rkrxszigtrjmboesxvhn';
const GAME_LOGIN = `dw_game.${PROJECT}:XUbF7Agw9DNRpG36BaRBKcYeM3KyzEvR`;
const BUILT_IN = ['aws-0-us-east-1', 'aws-1-us-east-1'].flatMap((h) => [6543, 5432].map((port) => `postgresql://${GAME_LOGIN}@${h}.pooler.supabase.com:${port}/postgres`));

async function open(url: string) {
  const { default: postgres } = await import('postgres');
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || /sslmode=disable/.test(url);
  // Supabase wants SSL; 'require' encrypts without needing their certificate chain installed.
  const client = postgres(url, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 5, ssl: local ? false : 'require', onnotice: () => {} });
  try {
    await client`SELECT 1`;
    return client;
  } catch (e) {
    await client.end({ timeout: 1 }).catch(() => {});
    throw e;
  }
}

async function connect(): Promise<Db> {
  if (injected) return injected;
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const own = databaseUrl();
  const candidates = own ? [own, ...BUILT_IN] : BUILT_IN;
  let firstError: unknown = null;
  for (const url of candidates) {
    try {
      const client = await open(url);
      return drizzle(client, { schema }) as unknown as Db;
    } catch (e) {
      firstError ??= e;
      console.error(`database: could not connect via ${url.replace(/:[^:@/]+@/, ':***@')}:`, (e as Error)?.message);
    }
  }
  throw firstError ?? new GameError(503, 'no_database', 'Could not reach the database.');
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
    const has = rows<{ t: string | null }>(await tx.execute(sql`SELECT to_regclass('public._dw_migrations')::text AS t`))[0]?.t;
    if (!has) await tx.execute(sql`CREATE TABLE public._dw_migrations (name text PRIMARY KEY, applied_at bigint NOT NULL)`);
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
  // only tables this login owns can be altered (older ones belong to the project owner)
  const tables = rows<{ t: string }>(await db.execute(sql`SELECT tablename AS t FROM pg_tables WHERE schemaname IN ('live', 'public') AND tableowner = current_user AND (schemaname = 'live' OR tablename = '_dw_migrations')`));
  for (const { t } of tables) await db.execute(sql.raw(t === '_dw_migrations' ? `ALTER TABLE public._dw_migrations ENABLE ROW LEVEL SECURITY` : `ALTER TABLE live."${t}" ENABLE ROW LEVEL SECURITY`));
  const roles = rows<{ r: string }>(await db.execute(sql`SELECT rolname AS r FROM pg_roles WHERE rolname IN ('anon', 'authenticated')`));
  for (const { r } of roles) {
    await db.execute(sql.raw(`REVOKE ALL ON SCHEMA live FROM ${r}`));
    await db.execute(sql.raw(`REVOKE ALL ON ALL TABLES IN SCHEMA live FROM ${r}`));
  }
}
