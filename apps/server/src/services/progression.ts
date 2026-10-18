/**
 * Daily login streak + Lucky Wheel, IPO Prestige, decorations & pets shop.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db, schema, atomic } from '../db';
import { cfg } from './settings';
import { clock, dayKey, DAY_MS } from '../lib/time';
import { newId } from '../lib/ids';
import { liveRng } from '../engine/rng';
import { getCompany, createWorkplace, insertWorker } from './companies';
import { payCompany, chargeCompany, companyWallet, companyBalance } from './money';
import { SYS, post } from './ledger';
import { addModifier, registerMultiplier } from './multipliers';
import { openPod } from './pods';
import { badRequest, notFound } from '../lib/errors';
import { bump } from './stats';
import { addNews } from './news';
import { audit } from './audit';
import { SHOP_ITEMS, ITEM_MAP, SETS } from '../catalog/decor';

// ------------------------------------------------------------ daily streak & wheel
export function streakStatus(companyId: string) {
  const co = getCompany(companyId);
  const today = dayKey();
  const last = co.lastStreakClaim ? dayKey(co.lastStreakClaim) : null;
  const yesterday = dayKey(clock.now() - DAY_MS);
  const c = cfg();
  return {
    streak: last === today || last === yesterday ? co.streak : 0,
    canClaim: last !== today,
    wheel: c.streak.wheel.map((s, i) => ({ i, label: s.label, weight: s.weight, chance: s.weight / c.streak.wheel.reduce((a, b) => a + b.weight, 0) })),
    bonusPct: Math.round(Math.min(c.streak.streakBonusCap, c.streak.streakBonusPerDay * (co.streak + 1)) * 100),
  };
}

export function spinWheel(companyId: string, actorId: string) {
  return atomic(() => {
    const co = getCompany(companyId);
    const c = cfg();
    const today = dayKey();
    const last = co.lastStreakClaim ? dayKey(co.lastStreakClaim) : null;
    if (last === today) throw badRequest('Already spun today! Come back tomorrow for another go.');
    const yesterday = dayKey(clock.now() - DAY_MS);
    const streak = last === yesterday ? co.streak + 1 : 1;
    db.update(schema.companies).set({ streak, lastStreakClaim: clock.now() }).where(eq(schema.companies.id, companyId)).run();
    const rng = liveRng();
    const idx = c.streak.wheel.indexOf(rng.weighted(c.streak.wheel, (s) => s.weight));
    const seg = c.streak.wheel[idx];
    const mult = 1 + Math.min(c.streak.streakBonusCap, c.streak.streakBonusPerDay * (streak - 1));
    const result: Record<string, unknown> = { index: idx, label: seg.label, streak };
    if (seg.bits) result.bits = payCompany({ companyId, amount: Math.round(seg.bits * mult), from: SYS.TREASURY, kind: 'reward.streak', memo: `Day ${streak} wheel`, idempotencyKey: `wheel:${companyId}:${today}`, actorId, partial: true });
    if (seg.coffee) {
      db.update(schema.workers).set({ coffeeUntil: clock.now() + c.workers.coffeeDurationMs, energy: 100 }).where(eq(schema.workers.companyId, companyId)).run();
      result.coffee = true;
    }
    if (seg.pod) {
      try {
        result.pod = openPod(companyId, seg.pod, actorId, { free: true });
      } catch {
        result.bits = payCompany({ companyId, amount: c.pods.types[seg.pod].cost, from: SYS.TREASURY, kind: 'reward.streak', memo: 'Pod refund (worker cap)', actorId, partial: true });
      }
    }
    if (seg.mult && seg.minutes) {
      addModifier(companyId, 'income', seg.mult, seg.minutes, 'wheel');
      result.mult = seg.mult;
    }
    bump(companyId, 'spins');
    return result;
  });
}

// ------------------------------------------------------------ IPO Prestige
export function prestigePreview(companyId: string) {
  const co = getCompany(companyId);
  const c = cfg();
  const points = Math.floor(Math.sqrt(co.runEarned / c.prestige.divisor));
  return {
    runEarned: co.runEarned,
    minRunEarned: c.prestige.minRunEarned,
    eligible: co.runEarned >= c.prestige.minRunEarned,
    pointsGained: points,
    currentPoints: co.prestigePoints,
    currentMult: 1 + co.prestigePoints * c.prestige.multPerPoint,
    newMult: 1 + (co.prestigePoints + points) * c.prestige.multPerPoint,
    count: co.prestigeCount,
    trophies: co.trophies ?? [],
  };
}

/**
 * "Go Public" prestige reset: burns the main wallet down to the starting
 * amount, resets workers/workplaces/level, grants permanent prestige points
 * (+income multiplier) and a shiny trophy. Bank pots, items, stock listing,
 * achievements and research survive.
 */
export function doPrestige(companyId: string, actorId: string) {
  return atomic(() => {
    const p = prestigePreview(companyId);
    if (!p.eligible) throw badRequest(`Earn at least ${p.minRunEarned.toLocaleString()} BT this run before going public.`);
    const co = getCompany(companyId);
    const c = cfg();
    const keep = c.start.bits[co.difficulty] ?? 1500;
    const bal = companyBalance(companyId);
    if (bal > keep) post({ kind: 'prestige.burn', memo: 'IPO Prestige reset', actorId, legs: [{ from: companyWallet(companyId), to: SYS.MINT, amount: bal - keep }] });
    db.delete(schema.workers).where(eq(schema.workers.companyId, companyId)).run();
    db.delete(schema.workplaces).where(eq(schema.workplaces.companyId, companyId)).run();
    db.delete(schema.productionJobs).where(eq(schema.productionJobs.companyId, companyId)).run();
    db.delete(schema.contracts).where(and(eq(schema.contracts.companyId, companyId), sql`${schema.contracts.status} IN ('offered','active')`)).run();
    const wp = createWorkplace(companyId, co.industryId, 0);
    insertWorker(companyId, co.industryId, 'RARE', { workplaceId: wp.id, desk: 0 });
    insertWorker(companyId, co.industryId, 'COMMON', { workplaceId: wp.id, desk: 1 });
    const trophies = [...(co.trophies ?? []), `🏆 IPO #${co.prestigeCount + 1} (+${p.pointsGained} pts)`];
    db.update(schema.companies)
      .set({ prestigePoints: co.prestigePoints + p.pointsGained, prestigeCount: co.prestigeCount + 1, runEarned: 0, level: 1, xp: 0, trophies })
      .where(eq(schema.companies.id, companyId))
      .run();
    bump(companyId, 'prestiges');
    audit({ actorId, action: 'company.prestige', targetType: 'company', targetId: companyId, newValue: { points: p.pointsGained } });
    addNews('headline', `🚀 ${co.emoji} ${co.name} goes public (prestige #${co.prestigeCount + 1})!`, `They rang the big bell and started over with a +${Math.round(p.newMult * 100 - 100)}% permanent boost.`, companyId);
    return { pointsGained: p.pointsGained, newMult: p.newMult };
  });
}

// ------------------------------------------------------------ decorations & pets
export function shopView(companyId: string) {
  const co = getCompany(companyId);
  const owned = db.select().from(schema.items).where(eq(schema.items.companyId, companyId)).all();
  const c = cfg();
  const equipped = owned.filter((i) => i.equipped);
  const sets = Object.entries(SETS).map(([id, s]) => {
    const members = SHOP_ITEMS.filter((i) => i.set === id);
    const have = members.filter((m) => equipped.some((e) => e.itemKey === m.key)).length;
    return { id, ...s, have, total: members.length, complete: have === members.length };
  });
  return {
    items: SHOP_ITEMS.map((i) => ({ ...i, owned: owned.filter((o) => o.itemKey === i.key).length, unlocked: co.level >= i.minLevel })),
    owned: owned.map((o) => ({ ...o, def: ITEM_MAP.get(o.itemKey) })),
    maxEquipped: c.decor.maxEquipped,
    maxPets: c.decor.maxPets,
    sets,
    perks: decorPerks(companyId),
  };
}

export function buyItem(companyId: string, key: string, actorId: string) {
  return atomic(() => {
    const def = ITEM_MAP.get(key);
    if (!def) throw notFound('Not in the shop.');
    const co = getCompany(companyId);
    if (co.level < def.minLevel) throw badRequest(`Unlocks at company level ${def.minLevel}.`);
    if (def.kind === 'cosmetic' && db.select().from(schema.items).where(and(eq(schema.items.companyId, companyId), eq(schema.items.itemKey, key))).get()) throw badRequest('You already own that cosmetic.');
    chargeCompany({ companyId, amount: def.cost, kind: 'spend.shop', memo: def.name, actorId });
    const row = { id: newId('itm'), companyId, itemKey: key, kind: def.kind, level: 1, equipped: false, workplaceId: null, listed: false, createdAt: clock.now() };
    db.insert(schema.items).values(row).run();
    bump(companyId, def.kind === 'pet' ? 'pets' : 'decor');
    try {
      equipItem(companyId, row.id, true);
    } catch {}
    return { id: row.id, item: def };
  });
}

export function equipItem(companyId: string, itemId: string, on: boolean) {
  const it = db.select().from(schema.items).where(and(eq(schema.items.id, itemId), eq(schema.items.companyId, companyId))).get();
  if (!it) throw notFound('You do not own that.');
  if (it.listed) throw badRequest('It is listed on the marketplace.');
  if (on) {
    const c = cfg();
    const equipped = db.select().from(schema.items).where(and(eq(schema.items.companyId, companyId), eq(schema.items.equipped, true))).all();
    if (it.kind === 'pet' && equipped.filter((e) => e.kind === 'pet').length >= c.decor.maxPets) throw badRequest(`Max ${c.decor.maxPets} pets on duty. They get jealous.`);
    if (it.kind !== 'pet' && it.kind !== 'cosmetic' && equipped.filter((e) => e.kind === 'decor').length >= c.decor.maxEquipped) throw badRequest(`No room! Max ${c.decor.maxEquipped} decorations.`);
  }
  db.update(schema.items).set({ equipped: on }).where(eq(schema.items.id, it.id)).run();
  clearPerkMemo(companyId);
  return { ok: true };
}

const perkMemo = new Map<string, { at: number; perks: ReturnType<typeof computePerks> }>();
/** Sum of perks from equipped decor/pets + complete set bonuses (memoised briefly; cleared on changes). */
export function decorPerks(companyId: string) {
  const hit = perkMemo.get(companyId);
  if (hit && Date.now() - hit.at < 3000) return hit.perks;
  const perks = computePerks(companyId);
  perkMemo.set(companyId, { at: Date.now(), perks });
  return perks;
}
export function clearPerkMemo(companyId?: string) {
  if (companyId) perkMemo.delete(companyId);
  else perkMemo.clear();
}
function computePerks(companyId: string) {
  const eq_ = db.select().from(schema.items).where(and(eq(schema.items.companyId, companyId), eq(schema.items.equipped, true))).all();
  const perks = { mood: 0, income: 0, traffic: 0, research: 0, quality: 0, speed: 0 };
  for (const i of eq_) {
    const d = ITEM_MAP.get(i.itemKey);
    if (!d) continue;
    for (const [k, v] of Object.entries(d.perk)) (perks as any)[k] += v;
  }
  for (const [id, s] of Object.entries(SETS)) {
    const members = SHOP_ITEMS.filter((i) => i.set === id);
    if (members.every((m) => eq_.some((e) => e.itemKey === m.key))) for (const [k, v] of Object.entries(s.bonus)) (perks as any)[k] += v;
  }
  return perks;
}

registerMultiplier('income', (co) => 1 + decorPerks(co.id).income);
registerMultiplier('traffic', (co) => 1 + decorPerks(co.id).traffic);
registerMultiplier('research', (co) => 1 + decorPerks(co.id).research);
registerMultiplier('speed', (co) => 1 + decorPerks(co.id).speed);
registerMultiplier('mood', (co) => decorPerks(co.id).mood);
registerMultiplier('quality', (co) => decorPerks(co.id).quality);
