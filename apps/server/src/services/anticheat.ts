/**
 * Anti-cheat signals: suspicious transfers, wash trades, mini-game outliers,
 * multi-account hints and rapid-fire requests all land in the `flags` table
 * for the owner's dashboard.
 */
import { desc, eq, sql } from 'drizzle-orm';
import { db, schema, sqlite } from '../db';
import { newId } from '../lib/ids';
import { clock, DAY_MS } from '../lib/time';
import { toOwner } from '../lib/bus';

export function recordFlag(kind: string, companyId: string | null, detail: string, severity = 1, accountId: string | null = null) {
  const row = { id: newId('flg'), kind, companyId, accountId, detail, severity, resolved: false, createdAt: clock.now() };
  db.insert(schema.flags).values(row).run();
  if (severity >= 2) toOwner({ type: 'anticheat', item: row });
  return row;
}

export function listFlags(limit = 200) {
  return db.select().from(schema.flags).orderBy(desc(schema.flags.createdAt)).limit(limit).all();
}

export function resolveFlag(id: string) {
  db.update(schema.flags).set({ resolved: true }).where(eq(schema.flags.id, id)).run();
}

/** Accounts that logged in from the same IP recently (possible multi-accounting). */
export function sharedIps() {
  return sqlite
    .prepare(
      `SELECT s.ip, GROUP_CONCAT(DISTINCT a.account_number) AS accounts, COUNT(DISTINCT s.account_id) AS n
       FROM sessions s JOIN accounts a ON a.id = s.account_id
       WHERE s.ip IS NOT NULL AND a.role != 'OWNER' AND s.last_seen > ?
       GROUP BY s.ip HAVING n > 1 ORDER BY n DESC LIMIT 50`,
    )
    .all(clock.now() - 7 * DAY_MS) as Array<{ ip: string; accounts: string; n: number }>;
}

/** Biggest transfers in the last day. */
export function bigTransfers(limit = 20) {
  return sqlite
    .prepare(`SELECT * FROM ledger_entries WHERE kind = 'transfer.gift' AND created_at > ? ORDER BY amount DESC LIMIT ?`)
    .all(clock.now() - DAY_MS, limit);
}

/** Request-rate tracker (rapid-fire detection). */
const hits = new Map<string, number[]>();
export function trackRequest(accountId: string) {
  const now = Date.now();
  const arr = (hits.get(accountId) ?? []).filter((t) => now - t < 10_000);
  arr.push(now);
  hits.set(accountId, arr);
  if (arr.length === 150) recordFlag('rapid_fire', null, `Account ${accountId} made 150 requests in 10s`, 2, accountId);
}

export { sql };
