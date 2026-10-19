/**
 * Research tree: companies earn Research Points (RP) every tick (a little for
 * everyone, more per THINKER worker), then spend RP on nodes in 5 branches.
 * Node effects plug into the multipliers registry. RP are not Bits.
 *
 * Storage: companies.research JSON = { _rp: points, <nodeKey>: level }.
 */
import { eq } from 'drizzle-orm';
import { db, schema, atomic } from '../db';
import { badRequest, notFound } from '../lib/errors';
import { cfg } from './settings';
import { getCompany, type Company } from './companies';
import { multiplier, registerMultiplier } from './multipliers';
import { BRANCHES, RESEARCH, RESEARCH_MAP, researchCost, type ResearchEffect } from '../catalog/research';
import { bump } from './stats';
import { toCompany } from '../lib/bus';
import type { TickCtx } from './tick';

type Tree = Record<string, number>;

function treeOf(co: Pick<Company, 'research'>): Tree {
  return { ...(co.research ?? {}) };
}

/** Sum of a research effect for a company (fraction for multiplicative, flat for additive). */
export function researchEffect(co: Pick<Company, 'research'>, effect: ResearchEffect) {
  const t = co.research ?? {};
  let total = 0;
  for (const n of RESEARCH) if (n.effect === effect && t[n.key]) total += n.perLevel * t[n.key];
  return total;
}

for (const kind of ['income', 'traffic', 'speed', 'research', 'minigame'] as const) {
  registerMultiplier(kind, (co) => 1 + researchEffect(co, kind));
}
registerMultiplier('wages', (co) => Math.max(0.5, 1 - researchEffect(co, 'wages')));
for (const kind of ['quality', 'mood', 'offline', 'pity'] as const) {
  registerMultiplier(kind, (co) => researchEffect(co, kind));
}

/** Company hook: accrue RP every tick. */
export function researchTick(ctx: TickCtx) {
  if (ctx.ticks <= 0) return;
  const c = cfg().research;
  const co = ctx.company;
  const thinkers = (ctx.workers ?? []).filter((w) => w.role === 'THINKER' && w.workplaceId).length;
  const gain = (c.basePointsPerTick + thinkers * c.pointsPerTick) * ctx.ticks * multiplier('research', co, ctx.now);
  if (gain <= 0) return;
  const t = treeOf(getCompany(co.id));
  t._rp = Math.round(((t._rp ?? 0) + gain) * 1000) / 1000;
  db.update(schema.companies).set({ research: t }).where(eq(schema.companies.id, co.id)).run();
}

export function researchView(companyId: string) {
  const co = getCompany(companyId);
  const t = treeOf(co);
  const thinkers = db.select().from(schema.workers).where(eq(schema.workers.companyId, companyId)).all().filter((w) => w.role === 'THINKER' && w.workplaceId).length;
  const c = cfg().research;
  const perTick = (c.basePointsPerTick + thinkers * c.pointsPerTick) * multiplier('research', co);
  return {
    points: Math.floor(t._rp ?? 0),
    perMinute: Math.round(perTick * (60_000 / cfg().tick.intervalMs) * 100) / 100,
    thinkers,
    branches: BRANCHES.map((b) => ({
      ...b,
      nodes: RESEARCH.filter((n) => n.branch === b.id).map((n) => {
        const level = t[n.key] ?? 0;
        const unlocked = !n.requires || (t[n.requires] ?? 0) > 0;
        return { ...n, level, unlocked, cost: level >= n.maxLevel ? null : researchCost(n, level), requiresName: n.requires ? RESEARCH_MAP.get(n.requires)?.name : null };
      }),
    })),
    totals: {
      income: Math.round(researchEffect(co, 'income') * 100),
      traffic: Math.round(researchEffect(co, 'traffic') * 100),
      speed: Math.round(researchEffect(co, 'speed') * 100),
      quality: researchEffect(co, 'quality'),
      mood: researchEffect(co, 'mood'),
      wages: Math.round(researchEffect(co, 'wages') * 100),
      minigame: Math.round(researchEffect(co, 'minigame') * 100),
      offline: researchEffect(co, 'offline'),
      research: Math.round(researchEffect(co, 'research') * 100),
      pity: researchEffect(co, 'pity'),
    },
  };
}

export function buyResearch(companyId: string, key: string) {
  return atomic(() => {
    const node = RESEARCH_MAP.get(key);
    if (!node) throw notFound('No such research.');
    const co = getCompany(companyId);
    const t = treeOf(co);
    const level = t[key] ?? 0;
    if (level >= node.maxLevel) throw badRequest('Already maxed out! Your scientists are bored now.');
    if (node.requires && !(t[node.requires] > 0)) throw badRequest(`Research ${RESEARCH_MAP.get(node.requires)?.name} first.`);
    const cost = researchCost(node, level);
    if ((t._rp ?? 0) < cost) throw badRequest(`Not enough Research Points (${cost} needed, you have ${Math.floor(t._rp ?? 0)}).`);
    t._rp = (t._rp ?? 0) - cost;
    t[key] = level + 1;
    db.update(schema.companies).set({ research: t }).where(eq(schema.companies.id, companyId)).run();
    bump(companyId, 'research');
    toCompany(companyId, { type: 'company' });
    return { key, level: level + 1 };
  });
}
