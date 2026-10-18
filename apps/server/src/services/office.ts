/**
 * Office & workforce: workplaces, desks, worker actions, tap-to-boost,
 * company dashboard and "next goals".
 */
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { db, schema, atomic, sqlite } from '../db';
import { cfg } from './settings';
import { clock } from '../lib/time';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { getIndustry } from './catalog';
import { getCompany, createWorkplace } from './companies';
import { getCompanyPermissions } from '../permissions';
import { chargeCompany, payCompany, companyBalance } from './money';
import { SYS, balanceOf } from './ledger';
import { projectCompany } from './tick';
import { bump, today } from './stats';
import { hasSynergy, workerBaseOutput, workerWage } from '../engine/workers';
import { quirkById, WORKER_LINES } from '../engine/quirks';
import { liveRng } from '../engine/rng';
import { toCompany } from '../lib/bus';
import { audit } from './audit';

export type Worker = typeof schema.workers.$inferSelect;
export type Workplace = typeof schema.workplaces.$inferSelect;

export function getWorker(companyId: string, workerId: string): Worker {
  const w = db.select().from(schema.workers).where(and(eq(schema.workers.id, workerId), eq(schema.workers.companyId, companyId))).get();
  if (!w) throw notFound('That worker wandered off. Maybe to the vending machine.');
  if (w.listed) throw badRequest('That worker is listed on the marketplace. Cancel the listing first.');
  return w;
}

export function getWorkplace(companyId: string, wpId: string): Workplace {
  const w = db.select().from(schema.workplaces).where(and(eq(schema.workplaces.id, wpId), eq(schema.workplaces.companyId, companyId))).get();
  if (!w) throw notFound('No such workplace. Did someone sell the building?');
  return w;
}

export function desksFor(level: number) {
  const d = cfg().workplaces.desks;
  return d[Math.min(level, d.length - 1)];
}

function speechFor(w: Worker, rng = liveRng()) {
  const band = w.energy < 15 ? 'tired' : w.mood >= 75 ? 'happy' : w.mood >= 40 ? 'ok' : 'sad';
  return rng.pick(WORKER_LINES[band]);
}

export function workerView(w: Worker, focus?: string) {
  const c = cfg();
  const q = quirkById.get(w.quirk);
  const ind = getIndustry(w.industryId);
  const arch = ind.workers.find((a) => a.id === w.archetype);
  return {
    ...w,
    quirkName: q?.name ?? w.quirk,
    quirkEmoji: q?.emoji ?? '❓',
    quirkDescription: q?.description ?? '',
    archetypeName: arch?.name ?? 'Generalist',
    archetypeEmoji: arch?.emoji ?? '🤖',
    archetypeBio: arch?.bio ?? '',
    roleBonus: arch?.bonus ?? '',
    baseOutput: Math.round(workerBaseOutput(w, c) * 100) / 100,
    wage: Math.round(workerWage(w, c) * 100) / 100,
    xpNext: c.workers.xpToLevel(w.level),
    trainCost: c.workers.trainCost(w.level),
    promoteCost: c.workers.trainCost(w.level) * c.workers.promoteCostMult,
    synergy: focus ? hasSynergy(w.role, focus) : false,
    line: speechFor(w),
  };
}

export function officeView(companyId: string) {
  const co = getCompany(companyId);
  const ind = getIndustry(co.industryId);
  const c = cfg();
  const proj = projectCompany(co);
  const perms = getCompanyPermissions(companyId);
  const workers = proj.workers;
  const focusOf = (wpId: string) => ind.workplaces[proj.workplaces.find((w) => w.id === wpId)?.kind ?? 0]?.focus;
  const workplaces = proj.workplaces
    .sort((a, b) => a.kind - b.kind || a.createdAt - b.createdAt)
    .map((wp) => {
      const def = ind.workplaces[wp.kind];
      const desks = desksFor(wp.level);
      const seats = Array.from({ length: desks }, (_, i) => {
        const w = workers.find((x) => x.workplaceId === wp.id && x.desk === i);
        return w ? workerView(w, def.focus) : null;
      });
      const assigned = workers.filter((x) => x.workplaceId === wp.id);
      return {
        id: wp.id,
        kind: wp.kind,
        level: wp.level,
        name: wp.name,
        emoji: def?.emoji ?? '🏢',
        focus: def?.focus,
        desks,
        seats,
        synergies: assigned.filter((w) => hasSynergy(w.role, def?.focus)).length,
        income: Math.round((proj.perWorkplace[wp.id] ?? 0) * 100) / 100,
        upkeep: c.workplaces.upkeepPerTick(wp.kind, wp.level),
        upgradeCost: wp.level < c.workplaces.maxLevel ? c.workplaces.upgradeCost(wp.kind, wp.level) : null,
      };
    });
  const unassigned = workers.filter((w) => !w.workplaceId && !w.listed).map((w) => workerView(w));
  const totalDesks = workplaces.reduce((s, w) => s + w.desks, 0);
  const avgMood = workers.length ? Math.round(workers.reduce((s, w) => s + w.mood, 0) / workers.length) : 0;
  const avgEnergy = workers.length ? Math.round(workers.reduce((s, w) => s + w.energy, 0) / workers.length) : 0;
  const owned = new Set(proj.workplaces.map((w) => w.kind));
  const nextKind = ind.workplaces.findIndex((_, i) => !owned.has(i));
  const unlockable = ind.workplaces.map((def, i) => ({
    kind: i,
    name: def.name,
    emoji: def.emoji,
    focus: def.focus,
    cost: c.workplaces.unlockCost[i] ?? 0,
    level: c.workplaces.unlockLevel[i] ?? 1,
    owned: proj.workplaces.filter((w) => w.kind === i).length,
    allowed: perms.limits.maxWorkplaceTier == null || i <= perms.limits.maxWorkplaceTier,
  }));
  const income = proj.incomePerTick;
  const costs = proj.wagesPerTick + proj.upkeepPerTick;
  // Cartoon dashboard gauges
  const boredom = workers.length ? Math.round((unassigned.length / workers.length) * 100) : 0;
  const fireHazard = Math.min(100, workers.filter((w) => w.energy < 20).length * 15 + (workers.filter((w) => w.quirk === 'cursed').length * 10));
  return {
    company: { id: co.id, name: co.name, emoji: co.emoji, color: co.color, level: co.level, xp: co.xp, xpNext: c.company.levelXp(co.level), prestigePoints: co.prestigePoints, reputation: co.reputation, creditScore: co.creditScore, streak: co.streak, difficulty: co.difficulty },
    industry: { id: ind.id, name: ind.name, emoji: ind.emoji, color: ind.color, jokes: ind.jokes, workplaces: ind.workplaces, minigameFlavor: ind.minigameFlavor },
    workplaces,
    unassigned,
    unlockable,
    nextKind,
    dashboard: {
      balance: companyBalance(companyId),
      incomePerTick: Math.round(income * 100) / 100,
      wagesPerTick: Math.round(proj.wagesPerTick * 100) / 100,
      upkeepPerTick: proj.upkeepPerTick,
      profitPerTick: Math.round((income - costs) * 100) / 100,
      multiplier: Math.round(proj.multiplier * 100) / 100,
      morale: avgMood,
      energy: avgEnergy,
      boredom,
      fireHazard,
      workers: workers.length,
      desks: totalDesks,
      synergies: proj.synergies,
      tickMs: c.tick.intervalMs,
    },
    limits: { maxWorkers: perms.limits.maxWorkers, maxWorkplaces: perms.limits.maxWorkplaces, maxWorkplaceTier: perms.limits.maxWorkplaceTier },
  };
}

/** Put a worker on a desk (swapping if the desk is taken) or bench them (workplaceId null). */
export function assignWorker(companyId: string, workerId: string, workplaceId: string | null, desk: number | null) {
  return atomic(() => {
    const w = getWorker(companyId, workerId);
    if (!workplaceId) {
      db.update(schema.workers).set({ workplaceId: null, desk: null }).where(eq(schema.workers.id, w.id)).run();
      return { synergy: false };
    }
    const wp = getWorkplace(companyId, workplaceId);
    const desks = desksFor(wp.level);
    let d = desk;
    const taken = db.select().from(schema.workers).where(and(eq(schema.workers.companyId, companyId), eq(schema.workers.workplaceId, wp.id))).all();
    if (d == null) {
      const used = new Set(taken.map((t) => t.desk));
      d = Array.from({ length: desks }, (_, i) => i).find((i) => !used.has(i)) ?? null;
      if (d == null) throw badRequest('Every desk here is taken! Upgrade the workplace for more desks.');
    }
    if (d < 0 || d >= desks) throw badRequest('That desk does not exist (yet).');
    const occupant = taken.find((t) => t.desk === d && t.id !== w.id);
    if (occupant) {
      // swap: occupant goes to the dragged worker's old seat (or the bench)
      db.update(schema.workers).set({ workplaceId: w.workplaceId, desk: w.desk }).where(eq(schema.workers.id, occupant.id)).run();
    }
    db.update(schema.workers).set({ workplaceId: wp.id, desk: d }).where(eq(schema.workers.id, w.id)).run();
    const ind = getIndustry(getCompany(companyId).industryId);
    const synergy = hasSynergy(w.role, ind.workplaces[wp.kind]?.focus);
    if (synergy) bump(companyId, 'synergies');
    return { synergy, focus: ind.workplaces[wp.kind]?.focus };
  });
}

export function autoAssign(companyId: string) {
  return atomic(() => {
    const co = getCompany(companyId);
    const ind = getIndustry(co.industryId);
    const wps = db.select().from(schema.workplaces).where(eq(schema.workplaces.companyId, companyId)).all();
    const bench = db.select().from(schema.workers).where(and(eq(schema.workers.companyId, companyId), sql`${schema.workers.workplaceId} IS NULL`, eq(schema.workers.listed, false))).all();
    let placed = 0;
    // synergy-first: each benched worker prefers a workplace whose focus matches its role
    bench.sort((a, b) => (b.level - a.level) || (a.energy < 30 ? 1 : 0) - (b.energy < 30 ? 1 : 0));
    for (const w of bench) {
      if (w.energy < 30) continue; // let tired workers rest
      const order = [...wps].sort((a, b) => Number(hasSynergy(w.role, ind.workplaces[b.kind]?.focus)) - Number(hasSynergy(w.role, ind.workplaces[a.kind]?.focus)));
      for (const wp of order) {
        const used = new Set(db.select({ d: schema.workers.desk }).from(schema.workers).where(eq(schema.workers.workplaceId, wp.id)).all().map((r) => r.d));
        const free = Array.from({ length: desksFor(wp.level) }, (_, i) => i).find((i) => !used.has(i));
        if (free != null) {
          db.update(schema.workers).set({ workplaceId: wp.id, desk: free }).where(eq(schema.workers.id, w.id)).run();
          placed++;
          break;
        }
      }
    }
    return { placed };
  });
}

export function upgradeWorkplace(companyId: string, wpId: string, actorId: string) {
  return atomic(() => {
    const wp = getWorkplace(companyId, wpId);
    const c = cfg();
    if (wp.level >= c.workplaces.maxLevel) throw badRequest('Already max level. It literally cannot get fancier.');
    const cost = c.workplaces.upgradeCost(wp.kind, wp.level);
    chargeCompany({ companyId, amount: cost, kind: 'spend.workplace_upgrade', memo: `Upgrade ${wp.name} to level ${wp.level + 1}`, actorId });
    db.update(schema.workplaces).set({ level: wp.level + 1 }).where(eq(schema.workplaces.id, wp.id)).run();
    bump(companyId, 'upgrades');
    return { level: wp.level + 1, cost };
  });
}

export function unlockWorkplace(companyId: string, kind: number, actorId: string) {
  return atomic(() => {
    const co = getCompany(companyId);
    const ind = getIndustry(co.industryId);
    const c = cfg();
    const perms = getCompanyPermissions(companyId);
    if (kind < 0 || kind >= ind.workplaces.length) throw badRequest('No such workplace type.');
    if (perms.limits.maxWorkplaceTier != null && kind > perms.limits.maxWorkplaceTier) throw forbidden('The Owner capped your workplace tier. Ask nicely!', 'limit');
    const count = db.select({ n: sql<number>`count(*)` }).from(schema.workplaces).where(eq(schema.workplaces.companyId, companyId)).get()!.n;
    if (perms.limits.maxWorkplaces != null && count >= perms.limits.maxWorkplaces) throw forbidden(`Workplace limit reached (${perms.limits.maxWorkplaces}).`, 'limit');
    const need = c.workplaces.unlockLevel[kind] ?? 1;
    if (co.level < need) throw badRequest(`Reach company level ${need} first.`);
    const cost = (c.workplaces.unlockCost[kind] ?? 0) * Math.max(1, db.select({ n: sql<number>`count(*)` }).from(schema.workplaces).where(and(eq(schema.workplaces.companyId, companyId), eq(schema.workplaces.kind, kind))).get()!.n + 1);
    chargeCompany({ companyId, amount: Math.max(cost, 500), kind: 'spend.workplace_unlock', memo: `Open ${ind.workplaces[kind].name}`, actorId });
    const wp = createWorkplace(companyId, co.industryId, kind);
    bump(companyId, 'workplaces');
    return wp;
  });
}

// ------------------------------------------------------------ worker actions
export function trainWorker(companyId: string, workerId: string, actorId: string) {
  return atomic(() => {
    const w = getWorker(companyId, workerId);
    const c = cfg();
    if (w.level >= c.workers.maxLevel) throw badRequest('Max level! There is nothing left to teach them.');
    const cost = c.workers.trainCost(w.level);
    chargeCompany({ companyId, amount: cost, kind: 'spend.training', memo: `Train ${w.name}`, actorId });
    let xp = w.xp + c.workers.trainXp(w.level);
    let level = w.level;
    while (level < c.workers.maxLevel && xp >= c.workers.xpToLevel(level)) {
      xp -= c.workers.xpToLevel(level);
      level++;
    }
    db.update(schema.workers).set({ xp, level, mood: Math.min(100, w.mood + 5) }).where(eq(schema.workers.id, w.id)).run();
    bump(companyId, 'trainings');
    return { level, xp, leveled: level > w.level, cost };
  });
}

const RARITY_UP: Record<string, string> = { COMMON: 'RARE', RARE: 'EPIC', EPIC: 'LEGENDARY', CURSED: 'RARE' };
export function promoteWorker(companyId: string, workerId: string, actorId: string) {
  return atomic(() => {
    const w = getWorker(companyId, workerId);
    const c = cfg();
    if (w.level >= c.workers.maxLevel) throw badRequest('Already at the top of the ladder.');
    const cost = c.workers.trainCost(w.level) * c.workers.promoteCostMult;
    chargeCompany({ companyId, amount: cost, kind: 'spend.promotion', memo: `Promote ${w.name}`, actorId });
    const glow = RARITY_UP[w.rarity] && liveRng().chance(0.15) ? RARITY_UP[w.rarity] : w.rarity;
    db.update(schema.workers).set({ level: w.level + 1, rarity: glow, mood: Math.min(100, w.mood + 15) }).where(eq(schema.workers.id, w.id)).run();
    bump(companyId, 'promotions');
    return { level: w.level + 1, rarity: glow, glowUp: glow !== w.rarity, cost };
  });
}

export function coffee(companyId: string, workerIds: string[] | 'all', actorId: string) {
  return atomic(() => {
    const c = cfg();
    const ws = workerIds === 'all'
      ? db.select().from(schema.workers).where(and(eq(schema.workers.companyId, companyId), eq(schema.workers.listed, false))).all()
      : workerIds.map((id) => getWorker(companyId, id));
    if (!ws.length) throw badRequest('Nobody here to drink coffee.');
    const cost = c.workers.coffeeCost * ws.length;
    chargeCompany({ companyId, amount: cost, kind: 'spend.coffee', memo: `Coffee round x${ws.length}`, actorId });
    const until = clock.now() + c.workers.coffeeDurationMs;
    db.update(schema.workers)
      .set({ coffeeUntil: until, napUntil: null, energy: sql`MIN(100, ${schema.workers.energy} + 25)` })
      .where(inArray(schema.workers.id, ws.map((w) => w.id)))
      .run();
    bump(companyId, 'coffees', ws.length);
    return { count: ws.length, cost, until };
  });
}

export function renameWorker(companyId: string, workerId: string, name: string, actorId: string) {
  const w = getWorker(companyId, workerId);
  const clean = name.trim().slice(0, 30);
  if (clean.length < 2) throw badRequest('Names need at least 2 characters.');
  chargeCompany({ companyId, amount: cfg().workers.renameCost, kind: 'spend.rename', memo: `Rename ${w.name} -> ${clean}`, actorId });
  db.update(schema.workers).set({ name: clean }).where(eq(schema.workers.id, w.id)).run();
  return { name: clean };
}

export function fireWorker(companyId: string, workerId: string, actorId: string) {
  const w = getWorker(companyId, workerId);
  db.delete(schema.workers).where(eq(schema.workers.id, w.id)).run();
  db.delete(schema.relationships).where(sql`${schema.relationships.workerA} = ${w.id} OR ${schema.relationships.workerB} = ${w.id}`).run();
  audit({ actorId, action: 'worker.fire', targetType: 'worker', targetId: w.id, oldValue: { name: w.name, rarity: w.rarity } });
  bump(companyId, 'fired');
  return { ok: true, name: w.name };
}

// ------------------------------------------------------------ tap to boost
const combos = new Map<string, { last: number; combo: number; taps: number[] }>();

/**
 * One tap on a workplace. Server-side rate limit (max taps/sec), combo window,
 * and a daily cap tied to the company's income so tapping can't break the economy.
 */
export function boost(companyId: string, workplaceId: string) {
  const c = cfg();
  const now = clock.now();
  const st = combos.get(companyId) ?? { last: 0, combo: 0, taps: [] };
  st.taps = st.taps.filter((t) => now - t < 1000);
  if (st.taps.length >= c.boost.maxTapsPerSecond) throw badRequest('Whoa, slow down! Your finger is overheating. 🔥', 'too_fast');
  st.taps.push(now);
  st.combo = now - st.last <= c.boost.comboWindowMs ? Math.min(c.boost.maxCombo, st.combo + 1) : 1;
  st.last = now;
  combos.set(companyId, st);
  const wp = getWorkplace(companyId, workplaceId);
  const co = getCompany(companyId);
  const proj = projectCompany(co, now);
  const wpIncome = proj.perWorkplace[wp.id] ?? 0;
  const raw = Math.max(c.boost.minPerTap, wpIncome * c.boost.perTapRatio * (1 + c.boost.comboStep * (st.combo - 1)));
  const cap = Math.max(200, Math.round(proj.incomePerTick * c.boost.dailyCapTicks));
  const usedToday = today(companyId, 'boostEarned');
  const amount = Math.max(0, Math.min(Math.round(raw), cap - usedToday));
  let paid = 0;
  if (amount > 0) {
    paid = payCompany({ companyId, amount, from: SYS.MINT, kind: 'income.boost', partial: false });
    bump(companyId, 'boostEarned', paid);
  }
  bump(companyId, 'taps');
  return { paid, combo: st.combo, capped: amount <= 0, balance: balanceOf(`w:company:${companyId}:main`), big: st.combo >= 10 && st.combo % 5 === 0 };
}

// ------------------------------------------------------------ goals
export function nextGoals(companyId: string) {
  const v = officeView(companyId);
  const goals: Array<{ id: string; emoji: string; text: string; progress: number; target: number }> = [];
  goals.push({ id: 'level', emoji: '⭐', text: `Reach company level ${v.company.level + 1}`, progress: v.company.xp, target: v.company.xpNext });
  if (v.unassigned.length && v.dashboard.desks > v.dashboard.workers - v.unassigned.length) goals.push({ id: 'desks', emoji: '🪑', text: 'Put your benched workers on desks', progress: v.dashboard.workers - v.unassigned.length, target: v.dashboard.workers });
  else if (v.dashboard.workers < v.dashboard.desks) goals.push({ id: 'hire', emoji: '🥚', text: 'Fill every desk (open a Recruit Pod)', progress: v.dashboard.workers, target: v.dashboard.desks });
  const next = v.unlockable.find((u) => !u.owned && u.allowed);
  if (next) goals.push({ id: 'unlock', emoji: next.emoji, text: `Open a ${next.name} (needs Lv ${next.level})`, progress: Math.min(v.dashboard.balance, next.cost), target: Math.max(1, next.cost) });
  goals.push({ id: 'synergy', emoji: '✨', text: 'Get a synergy combo on every desk', progress: v.dashboard.synergies, target: Math.max(1, v.dashboard.desks) });
  return goals.slice(0, 4);
}

export { gt };
