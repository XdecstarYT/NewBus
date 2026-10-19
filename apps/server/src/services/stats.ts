import { and, eq, like, sql } from 'drizzle-orm';
import { db, schema, sqlite } from '../db';
import { dayKey } from '../lib/time';

/**
 * Monotonic per-company counters. Keys:
 *   <name>                  lifetime counter (e.g. "earned", "pods", "trades")
 *   d:<YYYY-MM-DD>:<name>   daily counter (caps, quests)
 *   s:<seasonId>:<name>     season counter (leaderboards)
 */
let currentSeasonId: string | null = null;
export function setCurrentSeason(id: string | null) {
  currentSeasonId = id;
}
export function getCurrentSeasonId() {
  return currentSeasonId;
}

const upsert = () =>
  sqlite.prepare(`INSERT INTO stats (company_id, key, value) VALUES (?, ?, ?) ON CONFLICT(company_id, key) DO UPDATE SET value = value + excluded.value`);

let stmt: ReturnType<typeof upsert> | null = null;
let stmtFor: unknown = null;
function S() {
  if (!stmt || stmtFor !== sqlite) {
    stmt = upsert();
    stmtFor = sqlite;
  }
  return stmt;
}

/** Increment a lifetime counter plus its daily and season twins. */
export function bump(companyId: string, name: string, by = 1) {
  if (!by) return;
  const s = S();
  s.run(companyId, name, by);
  s.run(companyId, `d:${dayKey()}:${name}`, by);
  if (currentSeasonId) s.run(companyId, `s:${currentSeasonId}:${name}`, by);
}

/** Lifetime-only counter (no daily/season twins), e.g. collection entries. */
export function bumpLifetime(companyId: string, key: string, by = 1) {
  S().run(companyId, key, by);
}

export function getStat(companyId: string, key: string): number {
  const row = db
    .select({ v: schema.stats.value })
    .from(schema.stats)
    .where(and(eq(schema.stats.companyId, companyId), eq(schema.stats.key, key)))
    .get();
  return row?.v ?? 0;
}

export function today(companyId: string, name: string): number {
  return getStat(companyId, `d:${dayKey()}:${name}`);
}

export function allStats(companyId: string): Record<string, number> {
  const rows = db
    .select()
    .from(schema.stats)
    .where(and(eq(schema.stats.companyId, companyId), sql`${schema.stats.key} NOT LIKE 'd:%'`, sql`${schema.stats.key} NOT LIKE 's:%'`))
    .all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** Remove daily counters older than ~10 days. */
export function pruneDailyStats(keepDays = 10) {
  const cutoff = dayKey(Date.now() - keepDays * 86400_000);
  sqlite.prepare(`DELETE FROM stats WHERE key LIKE 'd:%' AND substr(key, 3, 10) < ?`).run(cutoff);
}

export function topByStat(key: string, limit = 20) {
  return db.select().from(schema.stats).where(eq(schema.stats.key, key)).orderBy(sql`${schema.stats.value} DESC`).limit(limit).all();
}

export { like };
