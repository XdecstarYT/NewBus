/**
 * Pure worker & workplace math. No DB access: callers pass plain objects.
 */
import type { IndustryDef, Rarity, WorkerRole } from '@dw/shared';
import type { Economy } from '../config/economy';
import type { Rng } from './rng';
import { QUIRK_IDS } from './quirks';
import { workerName, workerAppearance } from './names';
import { SPECIES } from '@dw/shared';

export interface WorkerLike {
  id: string;
  role: string;
  rarity: string;
  quirk: string;
  level: number;
  energy: number;
  mood: number;
  workplaceId: string | null;
  coffeeUntil: number | null;
  napUntil?: number | null;
}

export interface WorkplaceLike {
  id: string;
  kind: number;
  level: number;
}

export interface OutputContext {
  now: number;
  /** focus role for each workplace id */
  focusOf: (workplaceId: string) => WorkerRole | undefined;
  campaignActive: boolean;
  /** relationship modifier per worker id (+chemistry / -rivalry) */
  relationBonus?: Map<string, number>;
  /** if set, chance-based quirks are rolled; otherwise expectation is used */
  rng?: Rng;
}

export function rollWorker(rng: Rng, industry: IndustryDef, rarity: Rarity, now: number) {
  const arch = rng.pick(industry.workers);
  let quirk = rng.pick(QUIRK_IDS);
  if (rarity === 'CURSED') quirk = 'cursed';
  else if (quirk === 'cursed') quirk = 'steady-eddie';
  const base = rarity === 'LEGENDARY' ? 70 : rarity === 'EPIC' ? 55 : rarity === 'RARE' ? 40 : 25;
  return {
    name: workerName(rng),
    species: rng.pick(SPECIES),
    archetype: arch.id,
    archetypeName: arch.name,
    role: arch.role,
    rarity,
    quirk,
    level: 1,
    energy: 100,
    mood: 60 + rng.int(0, 30),
    skills: { speed: base + rng.int(0, 25), craft: base + rng.int(0, 25), charm: base + rng.int(0, 25) },
    appearance: workerAppearance(rng),
    createdAt: now,
  };
}

export function workerBaseOutput(w: Pick<WorkerLike, 'rarity' | 'level'>, c: Economy): number {
  return c.workers.baseOutputPerTick * (c.workers.rarityOutput[w.rarity] ?? 1) * (1 + c.workers.levelOutputBonus * (w.level - 1));
}

export function workerWage(w: Pick<WorkerLike, 'rarity' | 'level' | 'quirk'>, c: Economy, difficultyWageMult = 1): number {
  let wage = workerBaseOutput(w, c) * c.workers.wageRatio * difficultyWageMult;
  if (w.quirk === 'penny-pincher') wage *= 0.6;
  return wage;
}

export function workplaceMult(wp: WorkplaceLike, c: Economy): number {
  return (c.workplaces.kindMult[wp.kind] ?? 1) * (1 + c.workplaces.levelMult * (wp.level - 1));
}

export function hasSynergy(role: string, focus: string | undefined): boolean {
  return !!focus && (role === focus || role === 'WILDCARD');
}

function utcHour(now: number) {
  return new Date(now).getUTCHours();
}

/**
 * Output of one assigned worker for one tick (float Bits). Returns 0 for
 * unassigned or napping workers.
 */
export function workerTickOutput(w: WorkerLike, wp: WorkplaceLike, ctx: OutputContext, c: Economy): number {
  if (!w.workplaceId) return 0;
  if (w.napUntil && w.napUntil > ctx.now) return 0;
  let out = workerBaseOutput(w, c);
  out *= 0.5 + Math.max(0, Math.min(100, w.energy)) / 200; // energy 0..100 -> 0.5..1.0
  out *= 0.8 + Math.max(0, Math.min(100, w.mood)) / 250; // mood 0..100 -> 0.8..1.2
  out *= workplaceMult(wp, c);
  const focus = ctx.focusOf(wp.id);
  if (hasSynergy(w.role, focus)) out *= w.role === 'WILDCARD' ? 1 + (c.workers.synergyMult - 1) * 0.4 : c.workers.synergyMult;
  const coffee = !!w.coffeeUntil && w.coffeeUntil > ctx.now;
  const h = utcHour(ctx.now);
  const roll = (p: number) => (ctx.rng ? (ctx.rng.chance(p) ? 1 : 0) : p);
  switch (w.quirk) {
    case 'procrastinator':
      // live ticks roll naps via napUntil (see services/tick.ts); catch-up uses the expectation
      out *= coffee ? 2 : ctx.rng ? 1 : 0.9;
      break;
    case 'overachiever':
      out *= 1.2;
      break;
    case 'night-owl':
      out *= h >= 20 || h < 6 ? 1.4 : 0.85;
      break;
    case 'early-bird':
      out *= h >= 5 && h < 11 ? 1.4 : 0.85;
      break;
    case 'lucky':
      out *= 1 + 4 * roll(0.03);
      break;
    case 'chatterbox':
      out *= 0.9;
      break;
    case 'coffee-addict':
      out *= coffee ? 1.7 : 0.6;
      break;
    case 'drama-llama':
      out *= w.mood > 80 ? 1.15 : w.mood < 40 ? 0.85 : 1;
      break;
    case 'cursed': {
      // 15% zero, 2% 10x  -> expectation 0.83 + 0.18 = ~1.01
      if (ctx.rng) {
        const r = ctx.rng.next();
        out *= r < 0.15 ? 0 : r < 0.17 ? 10 : 1;
      } else out *= 0.83 + 0.02 * 9;
      break;
    }
    case 'napper':
      out *= ctx.rng ? 1 : 0.8;
      break;
    case 'hype-beast':
      out *= ctx.campaignActive ? 1.25 : 1;
      break;
    case 'steady-eddie':
      out *= 1.08;
      break;
  }
  const rel = ctx.relationBonus?.get(w.id);
  if (rel) out *= 1 + rel;
  return out;
}

/** Chatterbox & manager aura: +5% to each coworker at the same workplace per chatterbox/manager. */
export function workplaceAura(workers: WorkerLike[]): Map<string, number> {
  const byWp = new Map<string, WorkerLike[]>();
  for (const w of workers) if (w.workplaceId) byWp.set(w.workplaceId, [...(byWp.get(w.workplaceId) ?? []), w]);
  const out = new Map<string, number>();
  for (const [wpId, ws] of byWp) {
    const boosters = ws.filter((w) => w.quirk === 'chatterbox' || w.role === 'MANAGER').length;
    out.set(wpId, Math.min(0.3, boosters * 0.05));
  }
  return out;
}

export interface CompanyOutput {
  income: number; // float per tick (before company multipliers)
  perWorkplace: Map<string, number>;
  synergies: number;
}

export function companyTickOutput(workers: WorkerLike[], workplaces: WorkplaceLike[], ctx: OutputContext, c: Economy): CompanyOutput {
  const wpMap = new Map(workplaces.map((w) => [w.id, w]));
  const aura = workplaceAura(workers);
  const perWorkplace = new Map<string, number>();
  let income = 0;
  let synergies = 0;
  for (const w of workers) {
    if (!w.workplaceId) continue;
    const wp = wpMap.get(w.workplaceId);
    if (!wp) continue;
    let o = workerTickOutput(w, wp, ctx, c);
    const a = aura.get(wp.id) ?? 0;
    if (a && !(w.quirk === 'chatterbox')) o *= 1 + a;
    if (hasSynergy(w.role, ctx.focusOf(wp.id))) synergies++;
    perWorkplace.set(wp.id, (perWorkplace.get(wp.id) ?? 0) + o);
    income += o;
  }
  return { income, perWorkplace, synergies };
}

/** New energy/mood after one tick. */
export function workerVitals(w: WorkerLike, c: Economy, moodFloor: number, moodTarget: number) {
  let { energy, mood } = w;
  if (w.workplaceId) {
    let drain = c.workers.energyDrainPerTick;
    if (w.quirk === 'overachiever') drain *= 2;
    if (w.quirk === 'gym-bro') drain *= 0.5;
    energy -= drain;
  } else {
    let restore = c.workers.energyRestorePerTick;
    if (w.quirk === 'napper') restore *= 3;
    energy += restore;
  }
  // mood drifts toward target, low energy makes everyone grumpy
  const target = moodTarget - (energy < 20 ? 20 : 0);
  mood += Math.sign(target - mood) * Math.min(1, Math.abs(target - mood));
  if (w.quirk === 'zen') mood = Math.max(60, mood);
  mood = Math.max(moodFloor, mood);
  return { energy: Math.max(0, Math.min(100, Math.round(energy * 10) / 10)), mood: Math.max(0, Math.min(100, Math.round(mood))) };
}
