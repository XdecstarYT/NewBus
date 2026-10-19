/**
 * Owner operations: database backups (one-click, scheduled, download, restore),
 * config export/import (settings, flags, permission templates), the anti-cheat
 * dashboard and game analytics.
 */
import fs from 'node:fs';
import path from 'node:path';
import { desc, eq, sql } from 'drizzle-orm';
import { db, schema, sqlite, openDb, closeDb } from '../db';
import { env } from '../env';
import { clock, dayKey, DAY_MS } from '../lib/time';
import { badRequest, notFound } from '../lib/errors';
import { log } from '../lib/log';
import { listSettings, setSetting, invalidateSettings } from './settings';
import { getFlags, setFlag, invalidateFlags } from './flags';
import { invalidateCatalog } from './catalog';
import { loadSeason } from './goals';
import { listFlags, sharedIps, bigTransfers, resolveFlag } from './anticheat';
import { moneySupply, SYS, balanceOf } from './ledger';
import { findCompany } from './companies';
import { getIndustry } from './catalog';
import { audit } from './audit';
import { ALL_FLAGS } from '@dw/shared';

// ------------------------------------------------------------ backups
const NAME_RE = /^dw-\d{8}-\d{6}-[a-z0-9-]{1,20}\.db$/;

function stamp(ms = clock.now()) {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

export function backupDir() {
  fs.mkdirSync(env.backupDir, { recursive: true });
  return env.backupDir;
}

export function listBackups() {
  if (!fs.existsSync(env.backupDir)) return [];
  return fs
    .readdirSync(env.backupDir)
    .filter((f) => NAME_RE.test(f))
    .map((f) => {
      const st = fs.statSync(path.join(env.backupDir, f));
      return { name: f, size: st.size, createdAt: st.mtimeMs, reason: f.replace(/^dw-\d{8}-\d{6}-/, '').replace(/\.db$/, '') };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

function prune() {
  const list = listBackups();
  for (const b of list.slice(Math.max(1, env.backupKeep))) fs.rmSync(path.join(env.backupDir, b.name), { force: true });
}

/** Online, consistent copy of the live database (SQLite backup API). */
export async function createBackup(reason = 'manual', actorId: string | null = null) {
  if (env.databasePath === ':memory:') {
    // tests: serialize the in-memory db instead
    const name = `dw-${stamp()}-${reason.replace(/[^a-z0-9-]/g, '').slice(0, 20) || 'manual'}.db`;
    fs.writeFileSync(path.join(backupDir(), name), sqlite.serialize());
    prune();
    return { name };
  }
  const name = `dw-${stamp()}-${reason.replace(/[^a-z0-9-]/g, '').slice(0, 20) || 'manual'}.db`;
  await sqlite.backup(path.join(backupDir(), name));
  prune();
  if (actorId) audit({ actorId, action: 'backup.create', targetType: 'backup', targetId: name });
  log.info('backup created', { name });
  return { name };
}

export function backupPath(name: string) {
  if (!NAME_RE.test(name)) throw badRequest('Bad backup name.');
  const p = path.join(env.backupDir, name);
  if (!fs.existsSync(p)) throw notFound('No such backup.');
  return p;
}

/**
 * Restore a backup into the live database. A safety backup is taken first.
 * Caches are cleared so the running server picks up the restored data.
 */
export async function restoreBackup(name: string, actorId: string) {
  const src = backupPath(name);
  await createBackup('pre-restore', actorId);
  if (env.databasePath === ':memory:') throw badRequest('Restore is not available for an in-memory database.');
  closeDb();
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(env.databasePath + ext, { force: true });
  fs.copyFileSync(src, env.databasePath);
  openDb();
  invalidateSettings();
  invalidateFlags();
  invalidateCatalog();
  loadSeason();
  audit({ actorId, action: 'backup.restore', targetType: 'backup', targetId: name });
  log.warn('database restored from backup', { name });
  return { ok: true };
}

export function deleteBackup(name: string, actorId: string) {
  fs.rmSync(backupPath(name), { force: true });
  audit({ actorId, action: 'backup.delete', targetType: 'backup', targetId: name });
  return { ok: true };
}

// ------------------------------------------------------------ config export / import
export function exportConfig() {
  return {
    format: 'digital-workforce-config',
    version: 1,
    exportedAt: new Date(clock.now()).toISOString(),
    settings: Object.fromEntries(listSettings().filter((s) => s.overridden).map((s) => [s.key, s.value])),
    flags: getFlags(),
    templates: db.select().from(schema.permissionTemplates).all(),
  };
}

export function importConfig(data: any, actorId: string) {
  if (data?.format !== 'digital-workforce-config') throw badRequest('That is not a Digital Workforce config file.');
  let settings = 0;
  let flags = 0;
  let templates = 0;
  for (const [k, v] of Object.entries(data.settings ?? {})) {
    try {
      setSetting(k, v);
      settings++;
    } catch {}
  }
  for (const [k, v] of Object.entries(data.flags ?? {})) {
    if ((ALL_FLAGS as string[]).includes(k) && typeof v === 'boolean') {
      setFlag(k as any, v);
      flags++;
    }
  }
  for (const t of data.templates ?? []) {
    if (!t?.id || !t?.name || !t?.data) continue;
    const now = clock.now();
    db.insert(schema.permissionTemplates)
      .values({ id: String(t.id), name: String(t.name), data: t.data, createdAt: Number(t.createdAt) || now, updatedAt: now })
      .onConflictDoUpdate({ target: schema.permissionTemplates.id, set: { name: String(t.name), data: t.data, updatedAt: now } })
      .run();
    templates++;
  }
  invalidateSettings();
  audit({ actorId, action: 'config.import', targetType: 'config', targetId: 'all', newValue: { settings, flags, templates } });
  return { settings, flags, templates };
}

// ------------------------------------------------------------ anti-cheat dashboard
export function anticheatView() {
  const flags = listFlags(300).map((f) => ({ ...f, company: f.companyId ? findCompany(f.companyId)?.name ?? '?' : null }));
  const byKind: Record<string, number> = {};
  for (const f of flags) if (!f.resolved) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
  const linked = sqlite.prepare(`SELECT linked_group AS grp, GROUP_CONCAT(account_number) AS accounts FROM accounts WHERE linked_group IS NOT NULL GROUP BY linked_group`).all();
  const minigame = sqlite
    .prepare(`SELECT m.company_id, c.name, COUNT(*) plays, SUM(m.flagged) flagged, MAX(m.score) best FROM minigame_sessions m JOIN companies c ON c.id = m.company_id WHERE m.started_at > ? GROUP BY m.company_id HAVING flagged > 0 ORDER BY flagged DESC LIMIT 20`)
    .all(clock.now() - 7 * DAY_MS);
  return { flags, open: Object.values(byKind).reduce((a, b) => a + b, 0), byKind, sharedIps: sharedIps(), bigTransfers: bigTransfers(20), linked, minigame };
}

export function resolveFlags(ids: string[], actorId: string) {
  for (const id of ids) resolveFlag(id);
  audit({ actorId, action: 'anticheat.resolve', targetType: 'flag', targetId: ids.join(',').slice(0, 200) });
  return { ok: true };
}

// ------------------------------------------------------------ analytics
export function analytics() {
  const now = clock.now();
  const days = Array.from({ length: 10 }, (_, i) => dayKey(now - (9 - i) * DAY_MS));
  const daily = days.map((d) => {
    const rows = sqlite.prepare(`SELECT key, COUNT(DISTINCT company_id) companies, SUM(value) total FROM stats WHERE key IN (?, ?, ?, ?, ?, ?, ?) GROUP BY key`).all(`d:${d}:earned`, `d:${d}:minigames`, `d:${d}:pods`, `d:${d}:sold`, `d:${d}:trades`, `d:${d}:quests`, `d:${d}:taps`) as Array<{ key: string; companies: number; total: number }>;
    const get = (k: string) => rows.find((r) => r.key === `d:${d}:${k}`);
    return { day: d, active: get('earned')?.companies ?? 0, earned: get('earned')?.total ?? 0, minigames: get('minigames')?.total ?? 0, pods: get('pods')?.total ?? 0, sold: get('sold')?.total ?? 0, trades: get('trades')?.total ?? 0, quests: get('quests')?.total ?? 0, taps: get('taps')?.total ?? 0 };
  });
  const companies = db.select().from(schema.companies).all();
  const activeWithin = (ms: number) => companies.filter((c) => c.status === 'active' && c.lastActiveAt > now - ms).length;
  const byIndustry = new Map<string, number>();
  for (const c of companies) byIndustry.set(c.industryId, (byIndustry.get(c.industryId) ?? 0) + 1);
  const features = (sqlite.prepare(`SELECT key, SUM(value) total, COUNT(DISTINCT company_id) companies FROM stats WHERE key NOT LIKE 'd:%' AND key NOT LIKE 's:%' AND key NOT LIKE 'col:%' AND key NOT LIKE 'best:%' AND key NOT LIKE 'plays:%' GROUP BY key ORDER BY companies DESC, total DESC LIMIT 40`).all() as Array<{ key: string; total: number; companies: number }>);
  const logins = sqlite.prepare(`SELECT COUNT(*) n FROM accounts WHERE last_login > ?`).get(now - DAY_MS) as { n: number };
  return {
    totals: {
      companies: companies.length,
      active1d: activeWithin(DAY_MS),
      active7d: activeWithin(7 * DAY_MS),
      active30d: activeWithin(30 * DAY_MS),
      logins24h: logins.n,
      moneySupply: moneySupply(),
      treasury: balanceOf(SYS.TREASURY),
      achievements: (sqlite.prepare(`SELECT COUNT(*) n FROM achievements`).get() as { n: number }).n,
      minigamePlays: (sqlite.prepare(`SELECT COUNT(*) n FROM minigame_sessions`).get() as { n: number }).n,
    },
    daily,
    topIndustries: [...byIndustry.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, n]) => ({ id, name: getIndustry(id).name, emoji: getIndustry(id).emoji, companies: n })),
    features,
  };
}

export { eq, desc, sql };
