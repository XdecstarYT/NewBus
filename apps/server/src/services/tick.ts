/**
 * Server tick: drives production income, wages, upkeep, worker vitals and
 * every per-company / global system that registers a hook (contracts,
 * production queues, sales, events, interest, dividends...).
 *
 * Money flow per company per tick:
 *   MINT  -> company   passive production income (faucet, capped by offline window)
 *   company -> TREASURY wages + upkeep (sink)
 * Fractional Bits are carried between ticks so small incomes are not lost.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema, atomic } from '../db';
import { cfg } from './settings';
import { clock } from '../lib/time';
import { log } from '../lib/log';
import { accrualMs } from '../engine/accrual';
import { companyTickOutput, workerVitals, workerWage, hasSynergy, type WorkerLike } from '../engine/workers';
import { liveRng } from '../engine/rng';
import { getIndustry } from './catalog';
import { SYS, post, balanceOf } from './ledger';
import { companyWallet, payCompany } from './money';
import { multiplier, bonus, clearModifierMemo } from './multipliers';
import type { Company } from './companies';
import { toCompany } from '../lib/bus';
import { bump } from './stats';
import { relationBonus } from './relationships';

export interface TickCtx {
  company: Company;
  now: number;
  /** fraction of a tick being paid (1 = one normal tick; >1 = catch-up) */
  ticks: number;
  incomePerTick: number;
  earned: number;
  workers: (typeof schema.workers.$inferSelect)[];
  workplaces: (typeof schema.workplaces.$inferSelect)[];
  /** extra fields hooks want pushed to the client */
  push: Record<string, unknown>;
}

type CompanyHook = { name: string; fn: (ctx: TickCtx) => void };
type GlobalHook = { name: string; everyMs: number; last: number; fn: (now: number) => void };

const companyHooks: CompanyHook[] = [];
const globalHooks: GlobalHook[] = [];

export function registerCompanyHook(name: string, fn: (ctx: TickCtx) => void) {
  companyHooks.push({ name, fn });
}
/** Global hooks run at most every `everyMs` (0 = every tick). */
export function registerGlobalHook(name: string, everyMs: number, fn: (now: number) => void) {
  globalHooks.push({ name, everyMs, last: 0, fn });
}

const carry = new Map<string, { income: number; cost: number }>();

export function companyIncomeMultiplier(co: Company, now: number) {
  const c = cfg();
  const diff = c.difficulty[co.difficulty] ?? c.difficulty.NORMAL;
  return diff.income * (1 + co.prestigePoints * c.prestige.multPerPoint) * multiplier('income', co, now);
}

/** Pure-ish projection used by the UI and the tick (no writes). */
export function projectCompany(co: Company, now = clock.now()) {
  const c = cfg();
  const ind = getIndustry(co.industryId);
  const workers = db.select().from(schema.workers).where(eq(schema.workers.companyId, co.id)).all();
  const workplaces = db.select().from(schema.workplaces).where(eq(schema.workplaces.companyId, co.id)).all();
  const focus = new Map(workplaces.map((w) => [w.id, ind.workplaces[w.kind]?.focus]));
  const campaignActive = !!db
    .select({ id: schema.campaigns.id })
    .from(schema.campaigns)
    .where(and(eq(schema.campaigns.companyId, co.id), eq(schema.campaigns.status, 'active')))
    .get();
  const relations = relationBonus(workers);
  const out = companyTickOutput(workers as WorkerLike[], workplaces, { now, focusOf: (id) => focus.get(id), campaignActive, relationBonus: relations }, c);
  const mult = companyIncomeMultiplier(co, now);
  const diff = c.difficulty[co.difficulty] ?? c.difficulty.NORMAL;
  const wages = workers.reduce((s, w) => s + workerWage(w, c, diff.wages), 0) * multiplier('wages', co, now);
  const upkeep = workplaces.reduce((s, w) => s + c.workplaces.upkeepPerTick(w.kind, w.level), 0);
  return {
    incomePerTick: out.income * mult,
    perWorkplace: Object.fromEntries([...out.perWorkplace].map(([k, v]) => [k, v * mult])),
    wagesPerTick: wages,
    upkeepPerTick: upkeep,
    synergies: out.synergies,
    multiplier: mult,
    workers,
    workplaces,
    focus,
    campaignActive,
    relations,
  };
}

function tickCompany(co: Company, now: number) {
  const c = cfg();
  const ms = accrualMs({
    lastTickAt: co.lastTickAt,
    lastActiveAt: co.lastActiveAt,
    now,
    offlineCapMs: (c.tick.offlineCapHours + bonus('offline', co, now)) * 3600_000,
    maxCatchupMs: c.tick.maxCatchupMs,
  });
  const ticks = ms / c.tick.intervalMs;
  const p = projectCompany(co, now);
  const live = ticks > 0 && ticks <= 1.5;
  const rng = liveRng();

  // Live tick: roll the random quirks for real (naps, lucky streaks) for fun visuals.
  if (live) {
    for (const w of p.workers) {
      if (!w.workplaceId) continue;
      const napChance = w.quirk === 'procrastinator' && !(w.coffeeUntil && w.coffeeUntil > now) ? 0.1 : w.quirk === 'napper' ? 0.2 : 0;
      if (napChance && rng.chance(napChance)) {
        w.napUntil = now + c.tick.intervalMs * 2;
        db.update(schema.workers).set({ napUntil: w.napUntil }).where(eq(schema.workers.id, w.id)).run();
      }
    }
  }

  const cr = carry.get(co.id) ?? { income: 0, cost: 0 };
  let earned = 0;
  let payrollShort = 0;
  if (ticks > 0) {
    // Recompute live output with real dice for this tick.
    const ind = getIndustry(co.industryId);
    const focus = new Map(p.workplaces.map((w) => [w.id, ind.workplaces[w.kind]?.focus]));
    const rolled = live
      ? companyTickOutput(p.workers as WorkerLike[], p.workplaces, { now, focusOf: (id) => focus.get(id), campaignActive: p.campaignActive, rng, relationBonus: p.relations }, c).income * p.multiplier
      : p.incomePerTick;
    const grossF = rolled * ticks + cr.income;
    const gross = Math.floor(grossF);
    cr.income = grossF - gross;
    if (gross > 0) earned = payCompany({ companyId: co.id, amount: gross, from: SYS.MINT, kind: 'income.production', earn: true, partial: false });

    const costF = (p.wagesPerTick + p.upkeepPerTick) * ticks + cr.cost;
    const cost = Math.floor(costF);
    cr.cost = costF - cost;
    if (cost > 0) {
      const bal = balanceOf(companyWallet(co.id));
      const pay = Math.min(bal, cost);
      if (pay > 0) post({ kind: 'cost.wages_upkeep', legs: [{ from: companyWallet(co.id), to: SYS.TREASURY, amount: pay }] });
      if (pay < cost) {
        // can't make payroll: workers get grumpy (written back by the vitals loop below)
        for (const w of p.workers) w.mood = Math.max(0, w.mood - 3);
        payrollShort = cost - pay;
      }
      bump(co.id, 'wagesPaid', pay);
    }
  }
  carry.set(co.id, cr);

  // Worker vitals + XP (scaled by how many ticks elapsed, capped for long catch-ups).
  const steps = Math.min(Math.max(ticks, 0), 60);
  const moodTarget = 60 + bonus('mood', co, now);
  const xpLevel = c.workers.xpToLevel;
  for (const w of p.workers) {
    let { energy, mood } = w;
    let s = steps;
    while (s > 0) {
      const v = workerVitals({ ...w, energy, mood } as WorkerLike, c, 0, moodTarget);
      energy = v.energy;
      mood = v.mood;
      s -= 1;
    }
    let { xp, level } = w;
    if (w.workplaceId && steps > 0) {
      xp += Math.round(c.workers.xpPerTickWorking * steps);
      while (level < c.workers.maxLevel && xp >= xpLevel(level)) {
        xp -= xpLevel(level);
        level++;
        toCompany(co.id, { type: 'worker_levelup', workerId: w.id, name: w.name, level });
      }
    }
    if (energy !== w.energy || mood !== w.mood || xp !== w.xp || level !== w.level) {
      db.update(schema.workers).set({ energy, mood, xp, level }).where(eq(schema.workers.id, w.id)).run();
      Object.assign(w, { energy, mood, xp, level });
    }
  }

  const ctx: TickCtx = { company: co, now, ticks, incomePerTick: p.incomePerTick, earned, workers: p.workers, workplaces: p.workplaces, push: {} };
  for (const hook of companyHooks) {
    try {
      hook.fn(ctx);
    } catch (e: any) {
      log.error('tick hook failed', { hook: hook.name, company: co.id, err: String(e?.stack ?? e) });
    }
  }

  db.update(schema.companies)
    .set({ lastTickAt: now, incomePerTick: Math.round(p.incomePerTick * 100) / 100 > 0 ? Math.round(p.incomePerTick) : 0, wagesPerTick: Math.round(p.wagesPerTick + p.upkeepPerTick) })
    .where(eq(schema.companies.id, co.id))
    .run();

  return {
    type: 'tick',
    balance: balanceOf(companyWallet(co.id)),
    earned,
    incomePerTick: p.incomePerTick,
    wagesPerTick: p.wagesPerTick,
    upkeepPerTick: p.upkeepPerTick,
    synergies: p.synergies,
    perWorkplace: p.perWorkplace,
    accruing: ticks > 0,
    payrollShort,
    ...ctx.push,
  };
}

let running = false;
export function runTick(now = clock.now()) {
  if (running) return; // never overlap
  running = true;
  const started = Date.now();
  clearModifierMemo();
  try {
    const active = db.select().from(schema.companies).where(eq(schema.companies.status, 'active')).all();
    for (const co of active) {
      try {
        const payload = atomic(() => tickCompany(co, now));
        toCompany(co.id, payload);
      } catch (e: any) {
        log.error('tick company failed', { company: co.id, err: String(e?.stack ?? e) });
      }
    }
    for (const g of globalHooks) {
      if (g.everyMs && now - g.last < g.everyMs) continue;
      g.last = now;
      try {
        atomic(() => g.fn(now));
      } catch (e: any) {
        log.error('global hook failed', { hook: g.name, err: String(e?.stack ?? e) });
      }
    }
  } finally {
    running = false;
  }
  const took = Date.now() - started;
  if (took > cfg().tick.intervalMs / 2) log.warn('slow tick', { ms: took });
  return took;
}

let timer: NodeJS.Timeout | null = null;
export function startTicker() {
  stopTicker();
  const loop = () => {
    runTick();
    timer = setTimeout(loop, cfg().tick.intervalMs);
  };
  timer = setTimeout(loop, cfg().tick.intervalMs);
}
export function stopTicker() {
  if (timer) clearTimeout(timer);
  timer = null;
}

export function resetGlobalHookTimers() {
  for (const g of globalHooks) g.last = 0;
}

export { inArray, hasSynergy };
