import { eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { economy, type Economy } from '../config/economy';
import { clock } from '../lib/time';
import { badRequest } from '../lib/errors';

/**
 * Live economy settings = config/economy.ts defaults deep-merged with owner
 * overrides from the `settings` table. Only plain values (numbers, strings,
 * booleans, arrays, plain objects) can be overridden; functions stay as coded.
 */
let cache: Economy | null = null;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge(base: any, over: any): any {
  if (!isPlainObject(base) || !isPlainObject(over)) return over;
  const out: any = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? deepMerge(base[k], v) : v;
  return out;
}

function setPath(obj: any, pathStr: string, value: unknown) {
  const parts = pathStr.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    cur[parts[i]] = isPlainObject(cur[parts[i]]) ? cur[parts[i]] : {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function getPath(obj: any, pathStr: string): unknown {
  return pathStr.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function cfg(): Economy {
  if (cache) return cache;
  const rows = db.select().from(schema.settings).all();
  const over: any = {};
  for (const r of rows) setPath(over, r.key, r.value);
  cache = deepMerge(economy, over);
  return cache!;
}

export function invalidateSettings() {
  cache = null;
}

/** List editable leaves (numbers/strings/booleans) with their default + current value. */
export function listSettings(): Array<{ key: string; default: unknown; value: unknown; overridden: boolean }> {
  const out: Array<{ key: string; default: unknown; value: unknown; overridden: boolean }> = [];
  const current = cfg();
  const overrides = new Set(db.select({ key: schema.settings.key }).from(schema.settings).all().map((r) => r.key));
  const walk = (o: any, prefix: string) => {
    for (const [k, v] of Object.entries(o)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'function') continue;
      if (isPlainObject(v)) walk(v, key);
      else out.push({ key, default: v, value: getPath(current, key), overridden: overrides.has(key) });
    }
  };
  walk(economy, '');
  return out;
}

export function setSetting(key: string, value: unknown) {
  const def = getPath(economy, key);
  if (def === undefined) throw badRequest(`Unknown setting "${key}"`);
  if (typeof def === 'function') throw badRequest('That setting is a formula and cannot be edited live.');
  if (typeof def !== typeof value || Array.isArray(def) !== Array.isArray(value)) throw badRequest(`Setting "${key}" expects a ${Array.isArray(def) ? 'list' : typeof def}`);
  if (typeof value === 'number' && !Number.isFinite(value)) throw badRequest('Numbers only, please.');
  const now = clock.now();
  db.insert(schema.settings)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: now } })
    .run();
  invalidateSettings();
  return { key, old: getPath(economy, key), value };
}

export function resetSetting(key: string) {
  db.delete(schema.settings).where(eq(schema.settings.key, key)).run();
  invalidateSettings();
}

export function exportSettings() {
  return db.select().from(schema.settings).all();
}
