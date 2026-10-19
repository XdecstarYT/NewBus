/**
 * Supabase (Postgres) as the system of record.
 *
 * The game engine runs on a fast local SQLite working copy (the 5-second tick makes
 * thousands of small queries; over a network each one would cost a round trip).
 * Every change is captured by SQLite triggers into `_sync_queue` and streamed to
 * Postgres in batches every couple of seconds, so Supabase always holds the game
 * (at most a few seconds behind). On start-up an empty local copy is rebuilt from
 * Supabase, so the server itself needs no persistent disk.
 *
 * Mirror layout: schema `game` (not exposed by Supabase's public API), one table per
 * SQLite table with the same columns and primary key.
 */
import { sqlite } from './index';
import { log } from '../lib/log';

export interface Pg {
  query(text: string, params?: unknown[]): Promise<Array<Record<string, unknown>>>;
  /** run fn inside one transaction */
  tx<T>(fn: (q: Pg['query']) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

const SCHEMA = 'game';
const LOCAL_ONLY = new Set(['__drizzle_migrations', '_sync_queue', 'sqlite_sequence']);

interface Col {
  name: string;
  type: string;
  pk: number;
}
interface Table {
  name: string;
  cols: Col[];
  pk: string[];
}

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

/** Postgres driver for production (Supabase pooler). */
export async function connectPostgres(url: string): Promise<Pg> {
  const { default: postgres } = await import('postgres');
  // prepare:false keeps us compatible with Supabase's transaction pooler too
  const sql = postgres(url, { prepare: false, max: 4, idle_timeout: 30, connect_timeout: 15, onnotice: () => {}, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : 'require' });
  const run = (s: typeof sql) => async (text: string, params: unknown[] = []) => (await s.unsafe(text, params as any[])) as unknown as Array<Record<string, unknown>>;
  return {
    query: run(sql),
    tx: (fn) => sql.begin((t) => fn(run(t as any))) as any,
    end: () => sql.end({ timeout: 5 }),
  };
}

export function localTables(): Table[] {
  const names = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as Array<{ name: string }>;
  return names
    .filter((t) => !LOCAL_ONLY.has(t.name) && !t.name.startsWith('sqlite_'))
    .map((t) => {
      const cols = sqlite.prepare(`PRAGMA table_info(${q(t.name)})`).all() as Col[];
      return { name: t.name, cols, pk: cols.filter((c) => c.pk).sort((a, b) => a.pk - b.pk).map((c) => c.name) };
    });
}

function pgType(sqliteType: string) {
  const t = sqliteType.toUpperCase();
  if (t.includes('INT') || t === 'SERIAL') return 'bigint';
  if (t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB')) return 'double precision';
  if (t.includes('BLOB')) return 'bytea';
  return 'text';
}

/** Create the `game` schema and any missing tables/columns in Postgres. */
export async function ensureMirrorSchema(pg: Pg) {
  await pg.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  for (const t of localTables()) {
    const cols = t.cols.map((c) => `${q(c.name)} ${pgType(c.type)}`).join(', ');
    await pg.query(`CREATE TABLE IF NOT EXISTS ${SCHEMA}.${q(t.name)} (${cols}, PRIMARY KEY (${t.pk.map(q).join(', ')}))`);
    for (const c of t.cols) await pg.query(`ALTER TABLE ${SCHEMA}.${q(t.name)} ADD COLUMN IF NOT EXISTS ${q(c.name)} ${pgType(c.type)}`);
    // keep game data away from Supabase's public API (the server's postgres role bypasses RLS)
    await pg.query(`ALTER TABLE ${SCHEMA}.${q(t.name)} ENABLE ROW LEVEL SECURITY`);
  }
  try {
    await pg.query(`REVOKE ALL ON SCHEMA ${SCHEMA} FROM anon, authenticated`);
  } catch {
    // plain Postgres (tests, self-hosting) has no anon/authenticated roles
  }
}

function ensureQueue() {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS _sync_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT NOT NULL, pk TEXT NOT NULL)`);
}

/** (Re)create the change-capture triggers on every table. */
export function installTriggers() {
  ensureQueue();
  for (const t of localTables()) {
    const key = (row: 'NEW' | 'OLD') => `json_array(${t.pk.map((p) => `${row}.${q(p)}`).join(', ')})`;
    for (const [op, row] of [['INSERT', 'NEW'], ['UPDATE', 'NEW'], ['DELETE', 'OLD']] as const) {
      const name = q(`_sync_${t.name}_${op.toLowerCase()}`);
      sqlite.exec(`DROP TRIGGER IF EXISTS ${name}`);
      sqlite.exec(`CREATE TRIGGER ${name} AFTER ${op} ON ${q(t.name)} BEGIN INSERT INTO _sync_queue (tbl, pk) VALUES ('${t.name}', ${key(row)}); END`);
    }
    // a primary-key change moves the row: also queue the old key so it gets deleted remotely
    const moved = q(`_sync_${t.name}_pkmove`);
    sqlite.exec(`DROP TRIGGER IF EXISTS ${moved}`);
    sqlite.exec(
      `CREATE TRIGGER ${moved} AFTER UPDATE ON ${q(t.name)} WHEN ${t.pk.map((p) => `OLD.${q(p)} IS NOT NEW.${q(p)}`).join(' OR ')} BEGIN INSERT INTO _sync_queue (tbl, pk) VALUES ('${t.name}', ${key('OLD')}); END`,
    );
  }
}

export function dropTriggers() {
  const trig = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE '\\_sync\\_%' ESCAPE '\\'`).all() as Array<{ name: string }>;
  for (const t of trig) sqlite.exec(`DROP TRIGGER IF EXISTS ${q(t.name)}`);
}

/** Queue every row of every table (used for the very first upload). */
export function queueEverything() {
  installTriggers();
  for (const t of localTables()) sqlite.exec(`INSERT INTO _sync_queue (tbl, pk) SELECT '${t.name}', json_array(${t.pk.map(q).join(', ')}) FROM ${q(t.name)}`);
}

export const syncState = { lastFlushAt: 0, lastRows: 0, totalRows: 0, lastError: null as string | null, lastErrorAt: 0, pending: 0, enabled: false, hydratedRows: 0 };

const MAX_PARAMS = 30_000;

/** Send queued changes to Postgres. Returns the number of rows written or deleted. */
export async function flush(pg: Pg, maxBatch = 20_000): Promise<number> {
  const maxRow = sqlite.prepare(`SELECT MAX(id) m FROM (SELECT id FROM _sync_queue ORDER BY id LIMIT ?)`).get(maxBatch) as { m: number | null };
  if (!maxRow?.m) {
    syncState.pending = 0;
    return 0;
  }
  const maxId = maxRow.m;
  const keys = sqlite.prepare(`SELECT tbl, pk FROM _sync_queue WHERE id <= ? GROUP BY tbl, pk`).all(maxId) as Array<{ tbl: string; pk: string }>;
  const tables = new Map(localTables().map((t) => [t.name, t]));
  const byTable = new Map<string, unknown[][]>();
  for (const k of keys) {
    if (!tables.has(k.tbl)) continue;
    const list = byTable.get(k.tbl) ?? [];
    list.push(JSON.parse(k.pk));
    byTable.set(k.tbl, list);
  }
  // read the current local rows now (synchronously), then write remotely
  const work: Array<{ t: Table; upserts: Array<Record<string, unknown>>; deletes: unknown[][] }> = [];
  for (const [name, pks] of byTable) {
    const t = tables.get(name)!;
    const upserts: Array<Record<string, unknown>> = [];
    const deletes: unknown[][] = [];
    const where = t.pk.map((p) => `${q(p)} IS ?`).join(' AND ');
    const stmt = sqlite.prepare(`SELECT * FROM ${q(name)} WHERE ${where}`);
    for (const pk of pks) {
      const row = stmt.get(...(pk as any[])) as Record<string, unknown> | undefined;
      if (row) upserts.push(row);
      else deletes.push(pk);
    }
    work.push({ t, upserts, deletes });
  }
  let written = 0;
  await pg.tx(async (query) => {
    for (const { t, upserts, deletes } of work) {
      const cols = t.cols.map((c) => c.name);
      const per = Math.max(1, Math.floor(MAX_PARAMS / cols.length));
      for (let i = 0; i < upserts.length; i += per) {
        const chunk = upserts.slice(i, i + per);
        const params: unknown[] = [];
        const values = chunk.map((r) => `(${cols.map((c) => (params.push(toPg(r[c])), `$${params.length}`)).join(', ')})`).join(', ');
        const nonPk = cols.filter((c) => !t.pk.includes(c));
        const update = nonPk.length ? `DO UPDATE SET ${nonPk.map((c) => `${q(c)} = EXCLUDED.${q(c)}`).join(', ')}` : 'DO NOTHING';
        await query(`INSERT INTO ${SCHEMA}.${q(t.name)} (${cols.map(q).join(', ')}) VALUES ${values} ON CONFLICT (${t.pk.map(q).join(', ')}) ${update}`, params);
        written += chunk.length;
      }
      const perDel = Math.max(1, Math.floor(MAX_PARAMS / t.pk.length));
      for (let i = 0; i < deletes.length; i += perDel) {
        const chunk = deletes.slice(i, i + perDel);
        const params: unknown[] = [];
        const cond = chunk.map((pk) => `(${t.pk.map((p, j) => (params.push(toPg(pk[j])), `${q(p)} = $${params.length}`)).join(' AND ')})`).join(' OR ');
        await query(`DELETE FROM ${SCHEMA}.${q(t.name)} WHERE ${cond}`, params);
        written += chunk.length;
      }
    }
  });
  sqlite.prepare(`DELETE FROM _sync_queue WHERE id <= ?`).run(maxId);
  syncState.lastFlushAt = Date.now();
  syncState.lastRows = written;
  syncState.totalRows += written;
  syncState.pending = (sqlite.prepare(`SELECT COUNT(*) n FROM _sync_queue`).get() as { n: number }).n;
  return written;
}

/** Flush until the queue is empty. */
export async function flushAll(pg: Pg) {
  let total = 0;
  for (let i = 0; i < 10_000; i++) {
    const n = await flush(pg);
    total += n;
    if (!syncState.pending) break;
  }
  return total;
}

function toPg(v: unknown) {
  if (typeof v === 'bigint') return v.toString();
  return v;
}

function fromPg(v: unknown, sqliteType: string) {
  if (v === null || v === undefined) return null;
  const t = pgType(sqliteType);
  if (t === 'bigint') return typeof v === 'string' ? Number(v) : Number(v);
  if (t === 'double precision') return Number(v);
  if (v instanceof Date) return v.toISOString();
  return v;
}

/** Does Postgres already hold a game? */
export async function remoteHasData(pg: Pg) {
  try {
    const r = await pg.query(`SELECT COUNT(*)::int AS n FROM ${SCHEMA}.accounts`);
    return Number(r[0]?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Rebuild the local copy from Postgres (local tables are replaced). */
export async function hydrate(pg: Pg) {
  ensureQueue();
  dropTriggers();
  let rows = 0;
  const tables = localTables();
  const PAGE = 5000;
  sqlite.pragma('foreign_keys = OFF');
  for (const t of tables) {
    sqlite.prepare(`DELETE FROM ${q(t.name)}`).run();
    const cols = t.cols.map((c) => c.name);
    const ins = sqlite.prepare(`INSERT OR REPLACE INTO ${q(t.name)} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
    const insertMany = sqlite.transaction((list: Array<Record<string, unknown>>) => {
      for (const r of list) ins.run(...t.cols.map((c) => fromPg(r[c.name], c.type)));
    });
    for (let offset = 0; ; offset += PAGE) {
      const page = await pg.query(`SELECT * FROM ${SCHEMA}.${q(t.name)} ORDER BY ${t.pk.map(q).join(', ')} LIMIT ${PAGE} OFFSET ${offset}`);
      if (!page.length) break;
      insertMany(page);
      rows += page.length;
      if (page.length < PAGE) break;
    }
  }
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(`DELETE FROM _sync_queue`);
  syncState.hydratedRows = rows;
  log.info('hydrated local game copy from Supabase', { rows });
  return rows;
}

let timer: NodeJS.Timeout | null = null;
let busy = false;

/** Stream changes to Postgres every `everyMs`. */
export function startSync(pg: Pg, everyMs = 2000) {
  syncState.enabled = true;
  let backoff = everyMs;
  const loop = async () => {
    if (busy) return schedule();
    busy = true;
    try {
      await flush(pg);
      backoff = everyMs;
      syncState.lastError = null;
    } catch (e: any) {
      syncState.lastError = String(e?.message ?? e);
      syncState.lastErrorAt = Date.now();
      backoff = Math.min(60_000, backoff * 2);
      log.error('supabase sync failed (will retry)', { err: syncState.lastError });
    } finally {
      busy = false;
    }
    schedule();
  };
  const schedule = () => {
    timer = setTimeout(loop, syncState.pending > 0 && !syncState.lastError ? 50 : backoff);
  };
  schedule();
}

export async function stopSync(pg: Pg) {
  if (timer) clearTimeout(timer);
  timer = null;
  for (let i = 0; i < 50 && busy; i++) await new Promise((r) => setTimeout(r, 100));
  try {
    await flushAll(pg);
  } catch (e: any) {
    log.error('final supabase flush failed', { err: String(e?.message ?? e) });
  }
}

let connection: Pg | null = null;
export function setSyncConnection(pg: Pg | null) {
  connection = pg;
}
/** Owner "sync now" button. */
export async function syncNow() {
  if (!connection) return { ok: false, reason: 'Supabase is not configured (set DATABASE_URL).' };
  const rows = await flushAll(connection);
  return { ok: true, rows };
}

export function syncStatus() {
  const pending = (sqlite.prepare(`SELECT COUNT(*) n FROM sqlite_master WHERE name = '_sync_queue'`).get() as { n: number }).n
    ? (sqlite.prepare(`SELECT COUNT(*) n FROM _sync_queue`).get() as { n: number }).n
    : 0;
  return { ...syncState, pending };
}
