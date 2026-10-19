/**
 * Registry of company-wide multipliers so features (prestige, research, decor,
 * guild perks, events, global chaos) can plug into income/traffic/mood without
 * import cycles. Each provider returns a factor (1 = no effect) or a bonus.
 */
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { db, schema } from '../db';
import type { Company } from './companies';
import { clock } from '../lib/time';

export type Kind = 'income' | 'traffic' | 'speed' | 'quality' | 'mood' | 'research' | 'wages' | 'minigame' | 'offline' | 'pity';
type BonusKind = 'quality' | 'mood' | 'offline' | 'pity';
type Provider = (co: Company, now: number) => number;

const providers: Record<Kind, Provider[]> = { income: [], traffic: [], speed: [], quality: [], mood: [], research: [], wages: [], minigame: [], offline: [], pity: [] };

export function registerMultiplier(kind: Kind, p: Provider) {
  providers[kind].push(p);
}

/** Product of all multiplicative providers (income, traffic, speed, research). */
export function multiplier(kind: Kind, co: Company, now = clock.now()): number {
  return providers[kind].reduce((m, p) => m * p(co, now), 1);
}

/** Sum of additive providers (quality, mood, offline hours, pity reduction). */
export function bonus(kind: BonusKind, co: Company, now = clock.now()): number {
  return providers[kind].reduce((s, p) => s + p(co, now), 0);
}

/** Active temporary modifiers (company-scoped and global). Value multiplies for income/traffic/speed, adds for mood. */
const memo = new Map<string, any[]>();
export function clearModifierMemo() {
  memo.clear();
}
export function activeModifiers(companyId: string | null, now = clock.now()) {
  const key = `${companyId}:${now}`;
  const hit = memo.get(key);
  if (hit) return hit;
  if (memo.size > 5000) memo.clear();
  const rows = db
    .select()
    .from(schema.modifiers)
    .where(and(gt(schema.modifiers.expiresAt, now), companyId ? or(eq(schema.modifiers.companyId, companyId), isNull(schema.modifiers.companyId)) : isNull(schema.modifiers.companyId)))
    .all();
  memo.set(key, rows);
  return rows;
}

// Temporary modifiers feed every kind.
for (const kind of ['income', 'traffic', 'speed', 'research', 'wages'] as const) {
  registerMultiplier(kind, (co, now) => activeModifiers(co.id, now).filter((m) => m.kind === kind).reduce((p, m) => p * m.value, 1));
}
for (const kind of ['mood', 'quality'] as const) {
  registerMultiplier(kind, (co, now) => activeModifiers(co.id, now).filter((m) => m.kind === kind).reduce((s, m) => s + m.value, 0));
}

import { newId } from '../lib/ids';
/** Add a temporary modifier (companyId null = global). */
export function addModifier(companyId: string | null, kind: string, value: number, minutes: number, source: string) {
  const now = clock.now();
  const row = { id: newId('mod'), companyId, kind, value, source, expiresAt: now + minutes * 60_000, createdAt: now };
  db.insert(schema.modifiers).values(row).run();
  memo.clear();
  return row;
}
