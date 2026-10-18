/**
 * Products, production queues, equipment, warehouses, pricing, NPC customers,
 * reviews, marketing campaigns, automation and financial statements.
 *
 * Money rules:
 *  - NPC customers pay from the budgeted NPC demand pool (never minted on the spot),
 *    so sales can never create unbounded Bits. If the pool is dry, customers are broke.
 *  - Sales tax goes to the Treasury.
 *  - Inputs bought from the NPC wholesaler are paid to the Treasury.
 */
import { and, desc, eq, gt, inArray, like, sql } from 'drizzle-orm';
import { CUSTOMER_TYPES, type ProductDef, type CustomerTypeId } from '@dw/shared';
import { db, schema, atomic, sqlite } from '../db';
import { cfg } from './settings';
import { clock, dayKey } from '../lib/time';
import { newId } from '../lib/ids';
import { liveRng } from '../engine/rng';
import { npcName } from '../engine/names';
import { purchaseProbability, expectedCustomers, reviewStars, nextReputation, unitQuality, priceBounds } from '../engine/demand';
import { getCompany } from './companies';
import { getIndustry, productsFor, getProduct, findProduct, getCommodity, findCommodity, listProducts } from './catalog';
import { getCompanyPermissions } from '../permissions';
import { SYS, post, balanceOf } from './ledger';
import { companyWallet, chargeCompany, payCompany, recordEarnings, companyBalance } from './money';
import { addStock, takeStock, getQty, totalUnits, warehouseCapacity, listInventory, freeSpace } from './inventory';
import { multiplier, bonus, activeModifiers, addModifier } from './multipliers';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { bump, today } from './stats';
import { notify } from './notifications';
import { toCompany } from '../lib/bus';
import { flag } from './flags';
import type { TickCtx } from './tick';
import { getWorkplace } from './office';

// ------------------------------------------------------------ equipment catalog
export const EQUIPMENT = [
  { key: 'workbench', name: 'Turbo Workbench', emoji: '🛠️', cost: 2000, minLevel: 2, speed: 0.15, quality: 0 },
  { key: 'scanner', name: 'Quality Scanner', emoji: '🔍', cost: 3500, minLevel: 3, speed: 0, quality: 6 },
  { key: 'autopacker', name: 'Auto-Packer 3000', emoji: '📦', cost: 8000, minLevel: 5, speed: 0.25, quality: 0 },
  { key: 'robo-helper', name: 'Robo Helper', emoji: '🤖', cost: 15000, minLevel: 8, speed: 0.2, quality: 3 },
  { key: 'golden-machine', name: 'The Golden Machine', emoji: '✨', cost: 60000, minLevel: 14, speed: 0.4, quality: 8 },
];
const EQUIP_MAP = new Map(EQUIPMENT.map((e) => [e.key, e]));
const MAX_EQUIP_PER_WORKPLACE = 2;
const BREAKDOWN_CHANCE = 0.0015;
const BREAKDOWN_LINES = ['started playing elevator music and refuses to stop', 'is now just a very expensive toaster', 'achieved sentience and went on strike', 'is making a noise like a sad trombone', 'got a paperclip stuck in its soul'];

function equipmentAt(companyId: string, workplaceId: string) {
  return db
    .select()
    .from(schema.items)
    .where(and(eq(schema.items.companyId, companyId), eq(schema.items.kind, 'equipment'), eq(schema.items.workplaceId, workplaceId)))
    .all()
    .map((i) => ({ ...i, def: EQUIP_MAP.get(i.itemKey.replace('equip:', ''))! }));
}

export function buyEquipment(companyId: string, workplaceId: string, key: string, actorId: string) {
  return atomic(() => {
    const def = EQUIP_MAP.get(key);
    if (!def) throw notFound('No such machine.');
    const co = getCompany(companyId);
    if (co.level < def.minLevel) throw badRequest(`Unlocks at company level ${def.minLevel}.`);
    getWorkplace(companyId, workplaceId);
    if (equipmentAt(companyId, workplaceId).length >= MAX_EQUIP_PER_WORKPLACE) throw badRequest(`Max ${MAX_EQUIP_PER_WORKPLACE} machines per workplace. It's getting crowded.`);
    chargeCompany({ companyId, amount: def.cost, kind: 'spend.equipment', memo: def.name, actorId });
    db.insert(schema.items).values({ id: newId('eq'), companyId, itemKey: `equip:${key}`, kind: 'equipment', level: 1, equipped: true, workplaceId, listed: false, createdAt: clock.now() }).run();
    bump(companyId, 'equipment');
    return { ok: true };
  });
}

export function repairEquipment(companyId: string, itemId: string, actorId: string) {
  return atomic(() => {
    const it = db.select().from(schema.items).where(and(eq(schema.items.id, itemId), eq(schema.items.companyId, companyId), eq(schema.items.kind, 'equipment'))).get();
    if (!it) throw notFound('No such machine.');
    if (it.equipped) throw badRequest('It works fine. Please do not poke it.');
    const def = EQUIP_MAP.get(it.itemKey.replace('equip:', ''))!;
    chargeCompany({ companyId, amount: Math.round(def.cost * 0.2), kind: 'spend.repair', memo: `Repair ${def.name}`, actorId });
    db.update(schema.items).set({ equipped: true }).where(eq(schema.items.id, it.id)).run();
    return { ok: true };
  });
}

// ------------------------------------------------------------ trends
function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

let trendCache: { day: string; set: Set<string> } | null = null;
/** One trending product per category per day (deterministic), +50% demand. */
export function trendingProducts(): Set<string> {
  const day = dayKey();
  if (trendCache?.day === day) return trendCache.set;
  const byCat = new Map<string, ProductDef[]>();
  for (const p of listProducts()) byCat.set(p.category, [...(byCat.get(p.category) ?? []), p]);
  const set = new Set<string>();
  for (const [cat, ps] of byCat) set.add(ps[hashStr(day + cat) % ps.length].id);
  trendCache = { day, set };
  return set;
}

function demandModifier(companyId: string, productId: string, now: number) {
  let m = trendingProducts().has(productId) ? 1.5 : 1;
  for (const mod of activeModifiers(companyId, now)) if (mod.kind === `demand:${productId}` || mod.kind === 'demand:*') m *= mod.value;
  return m;
}

function seasonIndex(now: number) {
  return Math.floor(((new Date(now).getUTCMonth() + 10) % 12) / 3); // Mar-May spring=0 ...
}

// ------------------------------------------------------------ views
function unlockedFor(p: ProductDef, level: number, ownedKinds: Set<number>) {
  return level >= p.unlockLevel && [...ownedKinds].some((k) => k >= p.requiredWorkplace);
}

export function productsView(companyId: string) {
  const co = getCompany(companyId);
  const c = cfg();
  const perms = getCompanyPermissions(companyId);
  const ind = getIndustry(co.industryId);
  const prices = new Map(db.select().from(schema.companyProducts).where(eq(schema.companyProducts.companyId, companyId)).all().map((r) => [r.productId, r]));
  const inv = new Map(listInventory(companyId).map((i) => [`${i.itemType}:${i.itemId}`, i]));
  const wps = db.select().from(schema.workplaces).where(eq(schema.workplaces.companyId, companyId)).all();
  const ownedKinds = new Set(wps.map((w) => w.kind));
  const trending = trendingProducts();
  const now = clock.now();
  const season = seasonIndex(now);
  const competitors = competitorPrices(co.industryId, companyId);
  const products = productsFor(co.industryId).map((p) => {
    const cp = prices.get(p.id);
    const price = cp?.price ?? p.basePrice;
    const stock = inv.get(`product:${p.id}`);
    const bounds = priceBounds(p.basePrice, c.products.priceFloor, c.products.priceCeiling, perms.limits.priceLimitMult);
    // demand meter: average purchase chance across customer types at the current price
    const meter = CUSTOMER_TYPES.reduce(
      (s, t) => s + purchaseProbability({ price, basePrice: p.basePrice, quality: stock?.quality ?? 50, reputation: co.reputation, demandBase: p.demand.base, elasticity: p.demand.elasticity, priceSensitivity: t.priceSensitivity, qualityCare: t.qualityCare, season: p.seasonality[season], trend: demandModifier(companyId, p.id, now), competition: 1 }),
      0,
    ) / CUSTOMER_TYPES.length;
    const rival = competitors.get(p.id);
    const tip =
      price > p.basePrice * 1.8 ? 'Boss Byte: that price is spicy. Only Big Spenders will bite.'
      : price < p.basePrice * 0.6 ? 'Boss Byte: you are practically giving it away! Bargain Hunters love you though.'
      : rival && rival < price ? `Boss Byte: a rival sells this for ${rival} BT. Undercut them?`
      : trending.has(p.id) ? 'Boss Byte: this is TRENDING today. Maybe nudge the price up?'
      : 'Boss Byte: price looks reasonable. Ship it!';
    return {
      ...p,
      price,
      onSale: cp?.onSale ?? true,
      autoRestock: cp?.autoRestock ?? 0,
      sold: cp?.sold ?? 0,
      stock: stock?.qty ?? 0,
      quality: stock?.quality ?? null,
      unlocked: unlockedFor(p, co.level, ownedKinds),
      trending: trending.has(p.id),
      bounds,
      demandMeter: Math.round(meter * 100),
      rivalPrice: rival ?? null,
      tip,
      recipe: p.recipe.map((r) => ({
        ...r,
        name: findCommodity(r.inputId)?.name ?? findProduct(r.inputId)?.name ?? r.inputId,
        emoji: findCommodity(r.inputId)?.emoji ?? findProduct(r.inputId)?.emoji ?? '❓',
        kind: findCommodity(r.inputId) ? 'commodity' : 'product',
        have: getQty(companyId, findCommodity(r.inputId) ? 'commodity' : 'product', r.inputId),
        wholesalePrice: findCommodity(r.inputId) ? Math.ceil(getCommodity(r.inputId).basePrice * c.products.commoditySellRatio) : null,
      })),
    };
  });
  const jobs = db.select().from(schema.productionJobs).where(and(eq(schema.productionJobs.companyId, companyId), inArray(schema.productionJobs.status, ['running', 'queued', 'blocked']))).orderBy(schema.productionJobs.createdAt).all();
  const workplaces = wps.map((w) => ({
    id: w.id,
    name: w.name,
    kind: w.kind,
    level: w.level,
    speed: Math.round(workplaceSpeed(companyId, w.id) * 100) / 100,
    equipment: equipmentAt(companyId, w.id).map((e) => ({ id: e.id, name: e.def?.name, emoji: e.def?.emoji, working: e.equipped, repairCost: Math.round((e.def?.cost ?? 0) * 0.2) })),
    jobs: jobs.filter((j) => j.workplaceId === w.id).map((j) => ({ ...j, productName: findProduct(j.productId)?.name, productEmoji: findProduct(j.productId)?.emoji })),
  }));
  const commodities = listInventory(companyId)
    .filter((i) => i.itemType === 'commodity')
    .map((i) => ({ ...i, def: findCommodity(i.itemId) }));
  return {
    industry: { id: ind.id, name: ind.name, service: ind.service, perishable: ind.perishable, needs: ind.needs.map((n) => getCommodity(n)), supplies: ind.supplies.map((n) => getCommodity(n)) },
    products,
    workplaces,
    commodities,
    equipmentCatalog: EQUIPMENT,
    warehouse: {
      level: co.warehouseLevel,
      capacity: warehouseCapacity(co.warehouseLevel),
      used: totalUnits(companyId),
      upgradeCost: c.products.warehouseUpgradeCost[co.warehouseLevel + 1] ?? null,
      maxLevel: Math.min(c.products.warehouseCapacity.length - 1, perms.limits.maxWarehouseLevel ?? 99),
    },
    reputation: co.reputation,
    channels: perms.limits.allowedSalesChannels,
    maxListed: perms.limits.maxProductsListed,
  };
}

function competitorPrices(industryId: string, exceptCompany: string): Map<string, number> {
  const rows = sqlite
    .prepare(
      `SELECT cp.product_id AS productId, MIN(cp.price) AS price FROM company_products cp JOIN companies c ON c.id = cp.company_id
       JOIN inventory i ON i.company_id = cp.company_id AND i.item_type='product' AND i.item_id = cp.product_id AND i.qty > 0
       WHERE c.industry_id = ? AND c.id != ? AND cp.on_sale = 1 AND c.status='active' GROUP BY cp.product_id`,
    )
    .all(industryId, exceptCompany) as Array<{ productId: string; price: number }>;
  return new Map(rows.map((r) => [r.productId, r.price]));
}

export function setPricing(companyId: string, productId: string, patch: { price?: number; onSale?: boolean; autoRestock?: number }) {
  const co = getCompany(companyId);
  const p = getProduct(productId);
  if (p.industryId !== co.industryId) throw forbidden('That product is not in your industry.', 'wrong_industry');
  const c = cfg();
  const perms = getCompanyPermissions(companyId);
  const bounds = priceBounds(p.basePrice, c.products.priceFloor, c.products.priceCeiling, perms.limits.priceLimitMult);
  if (patch.price != null && (patch.price < bounds.min || patch.price > bounds.max)) throw badRequest(`Price must be between ${bounds.min} and ${bounds.max} BT (market floor & ceiling).`, 'price_bounds');
  if (patch.onSale && perms.limits.maxProductsListed != null) {
    const listed = db.select({ n: sql<number>`count(*)` }).from(schema.companyProducts).where(and(eq(schema.companyProducts.companyId, companyId), eq(schema.companyProducts.onSale, true), sql`${schema.companyProducts.productId} != ${productId}`)).get()!.n;
    if (listed >= perms.limits.maxProductsListed) throw forbidden(`You can list at most ${perms.limits.maxProductsListed} products for sale.`, 'limit');
  }
  db.insert(schema.companyProducts)
    .values({ companyId, productId, price: patch.price ?? p.basePrice, onSale: patch.onSale ?? true, autoRestock: patch.autoRestock ?? 0, sold: 0 })
    .onConflictDoUpdate({
      target: [schema.companyProducts.companyId, schema.companyProducts.productId],
      set: { ...(patch.price != null ? { price: patch.price } : {}), ...(patch.onSale != null ? { onSale: patch.onSale } : {}), ...(patch.autoRestock != null ? { autoRestock: patch.autoRestock } : {}) },
    })
    .run();
  return { ok: true };
}

// ------------------------------------------------------------ production
function workplaceSpeed(companyId: string, workplaceId: string) {
  const ws = db.select().from(schema.workers).where(and(eq(schema.workers.companyId, companyId), eq(schema.workers.workplaceId, workplaceId))).all();
  const avgSpeed = ws.length ? ws.reduce((s, w) => s + w.skills.speed, 0) / ws.length : 40;
  const quirk = ws.reduce((m, w) => m * (w.quirk === 'speedrunner' ? 1.3 : w.quirk === 'perfectionist' ? 0.9 : 1), 1);
  const eq_ = equipmentAt(companyId, workplaceId).filter((e) => e.equipped).reduce((s, e) => s + (e.def?.speed ?? 0), 0);
  const co = getCompany(companyId);
  return (0.5 + ws.length * 0.25) * (0.7 + (avgSpeed / 100) * 0.6) * quirk * (1 + eq_) * multiplier('speed', co);
}

function workplaceQualityBonus(companyId: string, workplaceId: string) {
  const ws = db.select().from(schema.workers).where(and(eq(schema.workers.companyId, companyId), eq(schema.workers.workplaceId, workplaceId))).all();
  const craft = ws.length ? ws.reduce((s, w) => s + w.skills.craft, 0) / ws.length : 30;
  const morale = ws.length ? ws.reduce((s, w) => s + w.mood, 0) / ws.length : 50;
  const quirk = ws.reduce((s, w) => s + (w.quirk === 'perfectionist' ? 10 : w.quirk === 'speedrunner' ? -8 : 0), 0) / Math.max(1, ws.length);
  const eq_ = equipmentAt(companyId, workplaceId).filter((e) => e.equipped).reduce((s, e) => s + (e.def?.quality ?? 0), 0);
  const fixers = ws.filter((w) => w.role === 'FIXER').length;
  return { craft, morale, bonus: quirk + eq_ + bonus('quality', getCompany(companyId)), oopsChance: Math.max(0.01, 0.04 - fixers * 0.01) };
}

/**
 * Queue a production job. Inputs are consumed up front; missing commodity
 * inputs can be auto-bought from the NPC wholesaler (at a markup) if affordable.
 */
export function queueProduction(companyId: string, workplaceId: string, productId: string, qty: number, actorId: string | null, opts: { autoBuy?: boolean } = {}) {
  return atomic(() => {
    if (qty < 1 || qty > 100) throw badRequest('Queue between 1 and 100 units.');
    const co = getCompany(companyId);
    const p = getProduct(productId);
    if (p.industryId !== co.industryId) throw forbidden('That is not one of your products.', 'wrong_industry');
    const wp = getWorkplace(companyId, workplaceId);
    if (co.level < p.unlockLevel) throw badRequest(`${p.name} unlocks at company level ${p.unlockLevel}.`);
    if (wp.kind < p.requiredWorkplace) throw badRequest(`${p.name} needs a fancier workplace (tier ${p.requiredWorkplace + 1}+).`);
    const c = cfg();
    const queued = db.select({ n: sql<number>`count(*)` }).from(schema.productionJobs).where(and(eq(schema.productionJobs.workplaceId, workplaceId), inArray(schema.productionJobs.status, ['running', 'queued', 'blocked']))).get()!.n;
    if (queued >= c.products.maxQueuePerWorkplace) throw badRequest(`This workplace's queue is full (${c.products.maxQueuePerWorkplace} jobs).`);
    // consume inputs (auto-buying missing commodities from the NPC wholesaler)
    let wholesaleCost = 0;
    for (const line of p.recipe) {
      const need = line.qty * qty;
      const isCommodity = !!findCommodity(line.inputId);
      const type = isCommodity ? 'commodity' : 'product';
      const have = getQty(companyId, type, line.inputId);
      if (have < need) {
        if (!isCommodity) throw badRequest(`You need ${need}x ${findProduct(line.inputId)?.name} first (have ${have}). Make some!`, 'missing_inputs');
        if (!(opts.autoBuy ?? c.products.autoBuyInputs)) throw badRequest(`Missing ${need - have}x ${getCommodity(line.inputId).name}. Buy some on the Supply Chain page.`, 'missing_inputs');
        const missing = need - have;
        const unit = Math.ceil(getCommodity(line.inputId).basePrice * c.products.commoditySellRatio);
        chargeCompany({ companyId, amount: unit * missing, kind: 'spend.inputs', memo: `Wholesaler: ${missing}x ${getCommodity(line.inputId).name}`, actorId });
        wholesaleCost += unit * missing;
        addStock(companyId, 'commodity', line.inputId, missing, 45);
        bump('global', `commodity:${line.inputId}:bought`, missing);
      }
      takeStock(companyId, type, line.inputId, need);
    }
    const running = db.select({ id: schema.productionJobs.id }).from(schema.productionJobs).where(and(eq(schema.productionJobs.workplaceId, workplaceId), eq(schema.productionJobs.status, 'running'))).get();
    const job = { id: newId('job'), companyId, workplaceId, productId, qty, done: 0, quality: 0, msPerUnit: p.productionMs, progressMs: 0, status: running ? 'queued' : 'running', createdAt: clock.now() };
    db.insert(schema.productionJobs).values(job).run();
    bump(companyId, 'jobsQueued');
    return { job, wholesaleCost };
  });
}

export function cancelJob(companyId: string, jobId: string) {
  return atomic(() => {
    const j = db.select().from(schema.productionJobs).where(and(eq(schema.productionJobs.id, jobId), eq(schema.productionJobs.companyId, companyId))).get();
    if (!j || j.status === 'done') throw notFound('No such job.');
    // refund the inputs for units not yet made
    const p = getProduct(j.productId);
    const left = j.qty - j.done;
    for (const line of p.recipe) addStock(companyId, findCommodity(line.inputId) ? 'commodity' : 'product', line.inputId, line.qty * left, 40);
    db.update(schema.productionJobs).set({ status: 'done', qty: j.done }).where(eq(schema.productionJobs.id, j.id)).run();
    promoteNextJob(j.workplaceId);
    return { refundedUnits: left };
  });
}

function promoteNextJob(workplaceId: string) {
  const running = db.select().from(schema.productionJobs).where(and(eq(schema.productionJobs.workplaceId, workplaceId), eq(schema.productionJobs.status, 'running'))).get();
  if (running) return;
  const next = db.select().from(schema.productionJobs).where(and(eq(schema.productionJobs.workplaceId, workplaceId), inArray(schema.productionJobs.status, ['queued', 'blocked']))).orderBy(schema.productionJobs.createdAt).get();
  if (next) db.update(schema.productionJobs).set({ status: 'running' }).where(eq(schema.productionJobs.id, next.id)).run();
}

export function productionTick(ctx: TickCtx) {
  if (ctx.ticks <= 0) return;
  const c = cfg();
  const co = ctx.company;
  const rng = liveRng();
  const jobs = db.select().from(schema.productionJobs).where(and(eq(schema.productionJobs.companyId, co.id), inArray(schema.productionJobs.status, ['running', 'blocked']))).all();
  let made = 0;
  for (const j of jobs) {
    const p = findProduct(j.productId);
    if (!p) continue;
    let space = freeSpace(co.id, co.warehouseLevel);
    if (space <= 0) {
      if (j.status !== 'blocked') {
        db.update(schema.productionJobs).set({ status: 'blocked' }).where(eq(schema.productionJobs.id, j.id)).run();
        notify(co.id, 'warehouse', '📦 Warehouse full!', 'Production paused. Sell stuff or upgrade the warehouse.');
      }
      continue;
    }
    const speed = workplaceSpeed(co.id, j.workplaceId);
    let progress = j.progressMs + c.tick.intervalMs * ctx.ticks * speed;
    let done = j.done;
    let qualitySum = j.quality * j.done;
    const q = workplaceQualityBonus(co.id, j.workplaceId);
    while (progress >= j.msPerUnit && done < j.qty && space > 0) {
      progress -= j.msPerUnit;
      done++;
      space--;
      const oops = rng.chance(q.oopsChance);
      const quality = oops ? 3 : unitQuality(p.qualityMin, p.qualityMax, q.craft, q.morale, q.bonus, rng.next());
      if (oops) toCompany(co.id, { type: 'oops', text: `Oops! A batch became "${p.oops}". Critics might love it?` });
      addStock(co.id, 'product', p.id, 1, quality);
      qualitySum += quality;
      made++;
    }
    const finished = done >= j.qty;
    db.update(schema.productionJobs)
      .set({ progressMs: finished ? 0 : Math.round(progress), done, quality: done ? Math.round(qualitySum / done) : 0, status: finished ? 'done' : 'running' })
      .where(eq(schema.productionJobs.id, j.id))
      .run();
    if (finished) {
      promoteNextJob(j.workplaceId);
      toCompany(co.id, { type: 'production_done', product: p.name, qty: j.qty });
    }
  }
  if (made) bump(co.id, 'produced', made);
  autoRestock(co.id);
  equipmentTick(co.id, ctx.ticks);
}

/** Automation: keep products topped up to their auto-restock target. */
function autoRestock(companyId: string) {
  const targets = db.select().from(schema.companyProducts).where(and(eq(schema.companyProducts.companyId, companyId), gt(schema.companyProducts.autoRestock, 0))).all();
  if (!targets.length) return;
  const wps = db.select().from(schema.workplaces).where(eq(schema.workplaces.companyId, companyId)).all();
  for (const t of targets) {
    const have = getQty(companyId, 'product', t.productId);
    if (have >= t.autoRestock) continue;
    const pending = db.select({ n: sql<number>`COALESCE(SUM(${schema.productionJobs.qty} - ${schema.productionJobs.done}),0)` }).from(schema.productionJobs).where(and(eq(schema.productionJobs.companyId, companyId), eq(schema.productionJobs.productId, t.productId), inArray(schema.productionJobs.status, ['running', 'queued', 'blocked']))).get()!.n;
    if (have + pending >= t.autoRestock) continue;
    const p = findProduct(t.productId);
    if (!p) continue;
    const wp = wps.filter((w) => w.kind >= p.requiredWorkplace).sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!wp) continue;
    try {
      queueProduction(companyId, wp.id, t.productId, Math.min(5, t.autoRestock - have - pending), null);
    } catch {
      // not enough Bits/inputs or queue full - try again next tick
    }
  }
}

function equipmentTick(companyId: string, ticks: number) {
  const rng = liveRng();
  const eqs = db.select().from(schema.items).where(and(eq(schema.items.companyId, companyId), eq(schema.items.kind, 'equipment'), eq(schema.items.equipped, true))).all();
  for (const e of eqs) {
    if (rng.chance(BREAKDOWN_CHANCE * Math.min(ticks, 10))) {
      db.update(schema.items).set({ equipped: false }).where(eq(schema.items.id, e.id)).run();
      const def = EQUIP_MAP.get(e.itemKey.replace('equip:', ''));
      notify(companyId, 'equipment', `🔧 ${def?.name} broke down!`, `It ${rng.pick(BREAKDOWN_LINES)}. Repair it on the Products page.`);
    }
  }
}

// ------------------------------------------------------------ commodities, spoilage, storage
const carries = new Map<string, number>();
function carry(key: string, amount: number) {
  const v = (carries.get(key) ?? 0) + amount;
  const whole = Math.floor(v);
  carries.set(key, v - whole);
  return whole;
}

export function supplyTick(ctx: TickCtx) {
  if (ctx.ticks <= 0) return;
  const c = cfg();
  const co = ctx.company;
  const ind = getIndustry(co.industryId);
  // supplier industries produce raw goods from their assigned workers
  if (ind.supplies.length) {
    const assigned = ctx.workers.filter((w) => w.workplaceId).length;
    const per = (assigned * c.commodities.baseProducePerWorkerPerTick * ctx.ticks * multiplier('speed', co)) / ind.supplies.length;
    for (const cid of ind.supplies) {
      const n = Math.min(carry(`${co.id}:prod:${cid}`, per), freeSpace(co.id, co.warehouseLevel));
      if (n > 0) {
        addStock(co.id, 'commodity', cid, n, 50 + Math.round(Math.random() * 20));
        bump(co.id, 'commoditiesProduced', n);
        bump('global', `commodity:${cid}:produced`, n);
      }
    }
  }
  // spoilage for perishables (service slots expire 3x faster)
  for (const item of listInventory(co.id)) {
    const def = item.itemType === 'product' ? findProduct(item.itemId) : findCommodity(item.itemId);
    if (!def?.perishable) continue;
    const rate = c.products.spoilagePerTick * ((def as ProductDef).service ? 3 : 1);
    const lost = Math.min(item.qty, carry(`${co.id}:spoil:${item.itemType}:${item.itemId}`, item.qty * rate * ctx.ticks));
    if (lost > 0) {
      takeStock(co.id, item.itemType as 'product' | 'commodity', item.itemId, lost);
      bump(co.id, 'spoiled', lost);
    }
  }
  // storage costs
  const units = totalUnits(co.id);
  const cost = carry(`${co.id}:storage`, (units / 100) * c.products.storageCostPerTickPer100 * ctx.ticks);
  if (cost > 0) {
    const pay = Math.min(cost, balanceOf(companyWallet(co.id)));
    if (pay > 0) post({ kind: 'cost.storage', legs: [{ from: companyWallet(co.id), to: SYS.TREASURY, amount: pay }] });
  }
  // cartoon pest event in big messy warehouses
  if (units > 50 && ctx.ticks <= 1.5 && liveRng().chance(0.0008)) {
    const items = listInventory(co.id).filter((i) => i.itemType === 'commodity');
    if (items.length) {
      const it = liveRng().pick(items);
      const lost = Math.max(1, Math.floor(it.qty * 0.1));
      takeStock(co.id, 'commodity', it.itemId, lost);
      notify(co.id, 'warehouse', `🐀 Cartoon raccoons raided the warehouse!`, `They stole ${lost}x ${findCommodity(it.itemId)?.name}. They left a thank-you note.`);
    }
  }
}

// ------------------------------------------------------------ NPC customers & sales
const CUSTOMER_WEIGHTS: Record<CustomerTypeId, number> = { bargain: 3, trend: 2, bigspender: 1, grumpy: 2, influencer: 1, tourist: 2, critic: 1 };

const REVIEW_LINES: Record<number, string[]> = {
  5: ['Life-changing. I told my goldfish about it.', 'Ten out of five stars. I broke the scale.', 'I would sell my bicycle for another one.', 'Chef\'s kiss. And the chef wasn\'t even here.', 'My grandma cried happy tears. She is a robot.'],
  4: ['Really good! Would buy again on a Tuesday.', 'Solid. Made my day 37% better.', 'Great stuff, the staff smiled at me twice.', 'Almost perfect. The bag was a bit crinkly.'],
  3: ['It was... fine. Like a beige wall.', 'Okay-ish. My cat was unimpressed.', 'Did the job. Neither delighted nor disappointed.', 'Three stars. I have no strong feelings.'],
  2: ['Overpriced for what it is. My wallet is weeping.', 'Meh. I expected more sparkle.', 'The worker was napping. Literally.', 'Not great. Not terrible. Mostly not great.'],
  1: ['I want my Bits back and a hug.', 'Worst purchase since my invisible hat.', 'A disaster. A delicious-looking disaster.', 'One star, and only because zero is not allowed.'],
};
const TYPE_FLAVOR: Record<string, string> = {
  bargain: '(found it on sale, obviously)',
  trend: '#trending #aesthetic',
  bigspender: '(bought three, just because)',
  grumpy: '...hmph.',
  influencer: 'Link in bio! 💅',
  tourist: '(took 40 photos of it)',
  critic: '- The Pixelville Gazette',
};

function trafficMultiplier(co: ReturnType<typeof getCompany>, workers: TickCtx['workers'], now: number) {
  const perms = getCompanyPermissions(co.id);
  const ch = perms.limits.allowedSalesChannels;
  let channel = ch.includes('shopfront') ? 1 : 0.4;
  if (ch.includes('online')) channel += 0.25;
  if (ch.includes('popup')) channel += 0.1;
  const memeLords = Math.min(3, workers.filter((w) => w.quirk === 'meme-lord' && w.workplaceId).length);
  const sellers = workers.filter((w) => w.role === 'SELLER' && w.workplaceId).length;
  return channel * (1 + memeLords * 0.05 + Math.min(0.5, sellers * 0.06)) * multiplier('traffic', co, now) * cfg().economy.demandMultiplier;
}

export function salesTick(ctx: TickCtx) {
  if (ctx.ticks <= 0) return;
  const perms = getCompanyPermissions(ctx.company.id);
  if (!perms.modules.products) return;
  const c = cfg();
  const co = getCompany(ctx.company.id);
  // owner caps: the shop "closes for the day" once the earn cap or balance cap is hit
  if (perms.limits.dailyEarnCap != null && today(co.id, 'earned') >= perms.limits.dailyEarnCap) return;
  if (perms.limits.maxBalance != null && companyBalance(co.id) >= perms.limits.maxBalance) return;
  const rng = liveRng();
  const onSale = db.select().from(schema.companyProducts).where(and(eq(schema.companyProducts.companyId, co.id), eq(schema.companyProducts.onSale, true))).all();
  const stocked = onSale
    .map((cp) => ({ cp, p: findProduct(cp.productId), row: listInventory(co.id).find((i) => i.itemType === 'product' && i.itemId === cp.productId) }))
    .filter((x) => x.p && x.row && x.row.qty > 0) as Array<{ cp: (typeof onSale)[number]; p: ProductDef; row: NonNullable<ReturnType<typeof listInventory>[number]> }>;
  if (!stocked.length) return;
  const now = ctx.now;
  const traffic = trafficMultiplier(co, ctx.workers, now);
  const expected = expectedCustomers(c.products.baseCustomersPerTick, co.reputation, traffic) * Math.min(ctx.ticks, 60);
  let n = Math.floor(expected) + (rng.chance(expected - Math.floor(expected)) ? 1 : 0);
  n = Math.min(n, 40);
  if (!n) return;
  const season = seasonIndex(now);
  const competitors = competitorPrices(co.industryId, co.id);
  const trending = trendingProducts();
  let sold = 0;
  let revenue = 0;
  let broke = 0;
  let rep = co.reputation;
  const visitors: Array<Record<string, unknown>> = [];
  for (let i = 0; i < n; i++) {
    const type = rng.weighted(CUSTOMER_TYPES, (t) => CUSTOMER_WEIGHTS[t.id]);
    const avail = stocked.filter((s) => s.row.qty > 0);
    if (!avail.length) break;
    const pick =
      type.id === 'bargain' ? avail.reduce((a, b) => (a.cp.price / a.p.basePrice <= b.cp.price / b.p.basePrice ? a : b))
      : type.id === 'bigspender' ? avail.reduce((a, b) => (a.p.basePrice >= b.p.basePrice ? a : b))
      : type.id === 'trend' && avail.some((s) => trending.has(s.p.id)) ? avail.find((s) => trending.has(s.p.id))!
      : rng.pick(avail);
    const rival = competitors.get(pick.p.id);
    const competition = rival && rival < pick.cp.price ? Math.max(0.7, 1 - ((pick.cp.price - rival) / pick.cp.price) * 0.6) : 1;
    const prob = purchaseProbability({
      price: pick.cp.price,
      basePrice: pick.p.basePrice,
      quality: pick.row.quality,
      reputation: rep,
      demandBase: pick.p.demand.base,
      elasticity: pick.p.demand.elasticity,
      priceSensitivity: type.priceSensitivity,
      qualityCare: type.qualityCare,
      season: pick.p.seasonality[season],
      trend: demandModifier(co.id, pick.p.id, now),
      competition,
    });
    const name = npcName(rng);
    if (!rng.chance(prob)) {
      visitors.push({ type: type.id, name, product: pick.p.name, bought: false });
      continue;
    }
    const qty = Math.min(pick.row.qty, type.id === 'bigspender' ? rng.int(1, 3) : 1);
    const total = pick.cp.price * qty;
    if (balanceOf(SYS.NPC) < total) {
      broke++;
      visitors.push({ type: type.id, name, product: pick.p.name, bought: false, broke: true });
      continue;
    }
    const tax = Math.floor((total * c.economy.salesTaxBps) / 10_000);
    post({
      kind: 'sale.npc',
      memo: `${qty}x ${pick.p.name} to ${type.name}`,
      legs: [
        { from: SYS.NPC, to: companyWallet(co.id), amount: total },
        { from: companyWallet(co.id), to: SYS.TREASURY, amount: tax, kind: 'tax.sales' },
      ],
    });
    takeStock(co.id, 'product', pick.p.id, qty);
    pick.row.qty -= qty;
    recordEarnings(co.id, total - tax);
    db.insert(schema.salesOrders).values({ id: newId('so'), companyId: co.id, productId: pick.p.id, qty, unitPrice: pick.cp.price, total, channel: 'shopfront', customerType: type.id, buyerCompanyId: null, createdAt: now }).run();
    db.update(schema.companyProducts).set({ sold: sql`${schema.companyProducts.sold} + ${qty}` }).where(and(eq(schema.companyProducts.companyId, co.id), eq(schema.companyProducts.productId, pick.p.id))).run();
    sold += qty;
    revenue += total;
    const stars = reviewStars(pick.row.quality, pick.cp.price, pick.p.basePrice, type.qualityCare, (rng.next() - 0.5) * 1.2);
    // charcoal art: critics adore the "oops" pieces
    const finalStars = type.id === 'critic' && pick.row.quality <= 5 ? 5 : stars;
    visitors.push({ type: type.id, name, product: pick.p.name, bought: true, qty, stars: finalStars });
    if (rng.chance(c.products.reviewChance) || type.id === 'critic') {
      const text = `${rng.pick(REVIEW_LINES[finalStars])} ${TYPE_FLAVOR[type.id] ?? ''}`.trim();
      db.insert(schema.reviews).values({ id: newId('rev'), companyId: co.id, productId: pick.p.id, stars: finalStars, text, customerType: type.id, customerName: name, reply: null, createdAt: now }).run();
      rep = nextReputation(rep, finalStars);
      if (type.id === 'influencer' && finalStars >= 4) {
        addModifier(co.id, 'traffic', 1.15, 10, 'influencer');
        toCompany(co.id, { type: 'boss', text: `${name} the influencer loved your ${pick.p.name}! Traffic +15% for 10 min.`, mood: 'wow' });
      }
    }
  }
  if (rep !== co.reputation) db.update(schema.companies).set({ reputation: rep }).where(eq(schema.companies.id, co.id)).run();
  // keep a short visitor log for the shopfront animation
  for (const v of visitors.slice(-12)) {
    db.insert(schema.customers).values({ id: newId('cus'), companyId: co.id, type: String(v.type), name: String(v.name), productId: null, bought: !!v.bought, satisfaction: Number(v.stars ?? 0), spent: 0, createdAt: now }).run();
  }
  if (sold) {
    bump(co.id, 'sold', sold);
    bump(co.id, 'revenue', revenue);
    // campaigns track the revenue they helped generate
    db.update(schema.campaigns).set({ revenueDuring: sql`${schema.campaigns.revenueDuring} + ${revenue}` }).where(and(eq(schema.campaigns.companyId, co.id), eq(schema.campaigns.status, 'active'))).run();
  }
  ctx.push.sales = { customers: n, sold, revenue, broke, visitors: visitors.slice(-8) };
}

export function pruneCustomers() {
  sqlite.prepare(`DELETE FROM customers WHERE created_at < ?`).run(clock.now() - 3600_000);
}

export function recentCustomers(companyId: string) {
  return db.select().from(schema.customers).where(eq(schema.customers.companyId, companyId)).orderBy(desc(schema.customers.createdAt)).limit(30).all();
}

// ------------------------------------------------------------ wholesale (sell finished goods to the NPC wholesaler)
export function sellToWholesaler(companyId: string, itemType: 'product' | 'commodity', itemId: string, qty: number, actorId: string) {
  return atomic(() => {
    const perms = getCompanyPermissions(companyId);
    if (itemType === 'product' && !perms.limits.allowedSalesChannels.includes('wholesale')) throw forbidden('The wholesale channel is not allowed for your company.', 'limit');
    const c = cfg();
    const base = itemType === 'product' ? getProduct(itemId).basePrice : getCommodity(itemId).basePrice;
    const unit = Math.max(1, Math.floor(base * (itemType === 'product' ? c.products.wholesaleBuyRatio : c.products.commodityBuyRatio)));
    takeStock(companyId, itemType, itemId, qty);
    const total = unit * qty;
    // the wholesaler pays out of the NPC pool (bounded), so dumping stock can't print money
    if (balanceOf(SYS.NPC) < total) throw badRequest('The wholesaler is out of cash today. Try later!');
    post({ kind: 'sale.wholesale', memo: `${qty}x ${itemId} to wholesaler`, actorId, legs: [{ from: SYS.NPC, to: companyWallet(companyId), amount: total }] });
    recordEarnings(companyId, total);
    db.insert(schema.salesOrders).values({ id: newId('so'), companyId, productId: itemId, qty, unitPrice: unit, total, channel: 'wholesale', customerType: null, buyerCompanyId: null, createdAt: clock.now() }).run();
    bump(companyId, 'wholesaled', qty);
    return { unit, total };
  });
}

export function buyFromWholesaler(companyId: string, commodityId: string, qty: number, actorId: string) {
  return atomic(() => {
    const c = cfg();
    const def = getCommodity(commodityId);
    const co = getCompany(companyId);
    if (freeSpace(companyId, co.warehouseLevel) < qty) throw badRequest('Not enough warehouse space.');
    const unit = Math.ceil(def.basePrice * c.products.commoditySellRatio);
    chargeCompany({ companyId, amount: unit * qty, kind: 'spend.inputs', memo: `Wholesaler: ${qty}x ${def.name}`, actorId });
    addStock(companyId, 'commodity', commodityId, qty, 45);
    bump(companyId, 'inputsBought', qty);
    bump('global', `commodity:${commodityId}:bought`, qty);
    return { unit, total: unit * qty };
  });
}

// ------------------------------------------------------------ warehouse
export function upgradeWarehouse(companyId: string, actorId: string) {
  return atomic(() => {
    const co = getCompany(companyId);
    const c = cfg();
    const perms = getCompanyPermissions(companyId);
    const next = co.warehouseLevel + 1;
    const max = Math.min(c.products.warehouseCapacity.length - 1, perms.limits.maxWarehouseLevel ?? 99);
    if (next > max) throw badRequest('Warehouse is at its maximum level.');
    chargeCompany({ companyId, amount: c.products.warehouseUpgradeCost[next], kind: 'spend.warehouse', memo: `Warehouse level ${next}`, actorId });
    db.update(schema.companies).set({ warehouseLevel: next }).where(eq(schema.companies.id, companyId)).run();
    db.update(schema.warehouses).set({ level: next }).where(eq(schema.warehouses.companyId, companyId)).run();
    // un-block paused jobs
    db.update(schema.productionJobs).set({ status: 'running' }).where(and(eq(schema.productionJobs.companyId, companyId), eq(schema.productionJobs.status, 'blocked'))).run();
    return { level: next, capacity: warehouseCapacity(next) };
  });
}

// ------------------------------------------------------------ reviews
export function listReviews(companyId: string) {
  const rows = db.select().from(schema.reviews).where(eq(schema.reviews.companyId, companyId)).orderBy(desc(schema.reviews.createdAt)).limit(60).all();
  return rows.map((r) => ({ ...r, productName: findProduct(r.productId)?.name, productEmoji: findProduct(r.productId)?.emoji }));
}

export function replyReview(companyId: string, reviewId: string, reply: string) {
  const r = db.select().from(schema.reviews).where(and(eq(schema.reviews.id, reviewId), eq(schema.reviews.companyId, companyId))).get();
  if (!r) throw notFound('No such review.');
  db.update(schema.reviews).set({ reply: reply.slice(0, 200) }).where(eq(schema.reviews.id, reviewId)).run();
  // replying to unhappy customers soothes the brand a little
  if (!r.reply && r.stars <= 2) db.update(schema.companies).set({ reputation: sql`MIN(500, ${schema.companies.reputation} + 3)` }).where(eq(schema.companies.id, companyId)).run();
  return { ok: true };
}

/** Customer-service mini-game: answer a complaint correctly to protect ratings. */
export function complaint(companyId: string) {
  const r = db.select().from(schema.reviews).where(and(eq(schema.reviews.companyId, companyId), sql`${schema.reviews.stars} <= 2`, sql`${schema.reviews.reply} IS NULL`)).orderBy(desc(schema.reviews.createdAt)).get();
  if (!r) return null;
  return {
    review: r,
    options: [
      { id: 'sorry', text: "We're so sorry! Here's a coupon and a tiny cartoon hug. 🤗", good: true },
      { id: 'blame', text: 'Have you considered that YOU are the problem?', good: false },
      { id: 'ignore', text: '*sends a GIF of a dancing cat*', good: false },
    ].sort(() => Math.random() - 0.5),
  };
}

export function answerComplaint(companyId: string, reviewId: string, optionId: string) {
  const good = optionId === 'sorry';
  replyReview(companyId, reviewId, good ? "We're so sorry! Here's a coupon and a tiny cartoon hug. 🤗" : optionId === 'blame' ? 'Have you considered that YOU are the problem?' : '*dancing cat GIF*');
  db.update(schema.companies).set({ reputation: sql`MAX(0, MIN(500, ${schema.companies.reputation} + ${good ? 6 : -8}))` }).where(eq(schema.companies.id, companyId)).run();
  bump(companyId, good ? 'complaintsSolved' : 'complaintsBotched');
  return { good };
}

// ------------------------------------------------------------ marketing campaigns
const SLOGANS = ['Now with extra sparkle!', 'Your boss would want you to buy this.', 'Scientifically 12% more fun.', 'As seen on a billboard!', 'Limited time. Unlimited vibes.', 'Made by robots who care.'];

export function campaignOptions() {
  const rng = liveRng();
  return { kinds: cfg().marketing.kinds, slogans: [rng.pick(SLOGANS), rng.pick(SLOGANS), rng.pick(SLOGANS)], maxMinutes: cfg().marketing.maxMinutes };
}

/** Launch an ad campaign. The "campaign mini-game": one of three slogans secretly goes viral. */
export function startCampaign(companyId: string, kind: string, minutes: number, slogan: number, actorId: string) {
  return atomic(() => {
    const c = cfg();
    const k = c.marketing.kinds[kind];
    if (!k) throw notFound('No such ad type.');
    if (minutes < 5 || minutes > c.marketing.maxMinutes) throw badRequest(`Campaigns run 5-${c.marketing.maxMinutes} minutes.`);
    const active = db.select({ n: sql<number>`count(*)` }).from(schema.campaigns).where(and(eq(schema.campaigns.companyId, companyId), eq(schema.campaigns.status, 'active'))).get()!.n;
    if (active >= 2) throw badRequest('Max 2 campaigns at once. Customers can only take so much.');
    const budget = k.costPerMin * minutes;
    chargeCompany({ companyId, amount: budget, kind: 'spend.marketing', memo: `${k.name} for ${minutes} min`, actorId });
    const viral = liveRng().int(0, 2) === slogan;
    const mult = k.trafficMult * (viral ? 1.25 : 1);
    const now = clock.now();
    const id = newId('cmp');
    db.insert(schema.campaigns).values({ id, companyId, kind, budget, trafficMult: mult, revenueDuring: 0, startsAt: now, endsAt: now + minutes * 60_000, status: 'active' }).run();
    addModifier(companyId, 'traffic', mult, minutes, `campaign:${id}`);
    bump(companyId, 'campaigns');
    return { id, viral, trafficMult: mult, budget };
  });
}

export function listCampaigns(companyId: string) {
  return db.select().from(schema.campaigns).where(eq(schema.campaigns.companyId, companyId)).orderBy(desc(schema.campaigns.startsAt)).limit(20).all();
}

export function campaignTick(now: number) {
  const ended = db.select().from(schema.campaigns).where(and(eq(schema.campaigns.status, 'active'), sql`${schema.campaigns.endsAt} <= ${now}`)).all();
  for (const cmp of ended) {
    db.update(schema.campaigns).set({ status: 'done' }).where(eq(schema.campaigns.id, cmp.id)).run();
    const roi = cmp.budget ? Math.round(((cmp.revenueDuring - cmp.budget) / cmp.budget) * 100) : 0;
    notify(cmp.companyId, 'marketing', `📣 Campaign finished: ROI ${roi >= 0 ? '+' : ''}${roi}%`, `Spent ${cmp.budget} BT, sales during the campaign: ${cmp.revenueDuring} BT.`);
  }
}

// ------------------------------------------------------------ financial statements
export function financials(companyId: string, hours = 24) {
  const since = clock.now() - hours * 3600_000;
  const prefix = `w:company:${companyId}:`;
  const rows = sqlite
    .prepare(
      `SELECT kind,
        SUM(CASE WHEN to_wallet LIKE ? AND from_wallet NOT LIKE ? THEN amount ELSE 0 END) AS inflow,
        SUM(CASE WHEN from_wallet LIKE ? AND to_wallet NOT LIKE ? THEN amount ELSE 0 END) AS outflow
       FROM ledger_entries WHERE created_at > ? AND (to_wallet LIKE ? OR from_wallet LIKE ?) GROUP BY kind`,
    )
    .all(`${prefix}%`, `${prefix}%`, `${prefix}%`, `${prefix}%`, since, `${prefix}%`, `${prefix}%`) as Array<{ kind: string; inflow: number; outflow: number }>;
  const sum = (pred: (k: string) => boolean, f: 'inflow' | 'outflow') => rows.filter((r) => pred(r.kind)).reduce((s, r) => s + r[f], 0);
  const revenue = sum((k) => k.startsWith('sale.') || k === 'supply.buy' || k === 'market.sale' || k === 'invoice.pay', 'inflow');
  const cogs = sum((k) => k === 'spend.inputs' || k === 'supply.buy', 'outflow');
  const wages = sum((k) => k === 'cost.wages_upkeep', 'outflow');
  const taxes = sum((k) => k.startsWith('tax.') || k.startsWith('fee.'), 'outflow');
  const otherIncome = sum((k) => k.startsWith('income.') || k.startsWith('reward.') || k.startsWith('dividend') || k.startsWith('grant') || k.startsWith('owner.'), 'inflow');
  const allOut = rows.reduce((s, r) => s + r.outflow, 0);
  const allIn = rows.reduce((s, r) => s + r.inflow, 0);
  const otherExpenses = allOut - cogs - wages - taxes;
  const inventoryValue = listInventory(companyId).reduce((s, i) => s + i.qty * (i.itemType === 'product' ? findProduct(i.itemId)?.baseCost ?? 0 : findCommodity(i.itemId)?.basePrice ?? 0), 0);
  const cash = (sqlite.prepare(`SELECT COALESCE(SUM(balance),0) s FROM wallets WHERE owner_type='company' AND owner_id = ?`).get(companyId) as { s: number }).s;
  const properties = (sqlite.prepare(`SELECT COALESCE(SUM(price),0) s FROM properties WHERE owner_company_id = ?`).get(companyId) as { s: number }).s;
  const loans = (sqlite.prepare(`SELECT COALESCE(SUM(outstanding),0) s FROM loans WHERE borrower_id = ? AND status = 'active'`).get(companyId) as { s: number }).s;
  const investments = holdingsValue(companyId);
  return {
    hours,
    income: { revenue, cogs, grossMargin: revenue - cogs, grossMarginPct: revenue ? Math.round(((revenue - cogs) / revenue) * 100) : 0, wagesAndUpkeep: wages, taxesAndFees: taxes, otherIncome, otherExpenses, profit: allIn - allOut },
    balance: { cash, inventory: inventoryValue, properties, investments, assets: cash + inventoryValue + properties + investments, liabilities: loans, equity: cash + inventoryValue + properties + investments - loans },
    byKind: rows,
  };
}

/** Value of exchange holdings (filled by the exchange module). */
let holdingsValueFn: (companyId: string) => number = () => 0;
export function setHoldingsValueFn(fn: (companyId: string) => number) {
  holdingsValueFn = fn;
}
function holdingsValue(companyId: string) {
  return holdingsValueFn(companyId);
}

// ------------------------------------------------------------ market data (owner + players)
export function topSellers(industryId?: string, limit = 10) {
  const since = clock.now() - 24 * 3600_000;
  const rows = sqlite
    .prepare(
      `SELECT so.company_id AS companyId, c.name, c.emoji, c.industry_id AS industryId, SUM(so.qty) AS units, SUM(so.total) AS revenue
       FROM sales_orders so JOIN companies c ON c.id = so.company_id WHERE so.created_at > ? ${industryId ? 'AND c.industry_id = ?' : ''}
       GROUP BY so.company_id ORDER BY revenue DESC LIMIT ?`,
    )
    .all(...(industryId ? [since, industryId, limit] : [since, limit]));
  return rows;
}

export function trendingBoard(limit = 12) {
  const since = clock.now() - 24 * 3600_000;
  const rows = sqlite
    .prepare(`SELECT product_id AS productId, SUM(qty) AS units, ROUND(AVG(unit_price)) AS avgPrice FROM sales_orders WHERE created_at > ? GROUP BY product_id ORDER BY units DESC LIMIT ?`)
    .all(since, limit) as Array<{ productId: string; units: number; avgPrice: number }>;
  return rows.map((r) => ({ ...r, name: findProduct(r.productId)?.name, emoji: findProduct(r.productId)?.emoji, trending: trendingProducts().has(r.productId) }));
}

/** Product price index: average realised price / base price across all sales (100 = at base). */
export function priceIndex(hours = 24) {
  const since = clock.now() - hours * 3600_000;
  const rows = sqlite.prepare(`SELECT product_id AS productId, SUM(total) AS total, SUM(qty) AS qty FROM sales_orders WHERE created_at > ? AND channel = 'shopfront' GROUP BY product_id`).all(since) as Array<{ productId: string; total: number; qty: number }>;
  let num = 0;
  let den = 0;
  for (const r of rows) {
    const p = findProduct(r.productId);
    if (!p) continue;
    num += r.total;
    den += p.basePrice * r.qty;
  }
  return den ? Math.round((num / den) * 1000) / 10 : 100;
}

/** Flag possible buy-low-sell-high exploit loops (lots of wholesale dumping right after cheap input buys). */
export function exploitSuspects() {
  const since = clock.now() - 24 * 3600_000;
  return sqlite
    .prepare(
      `SELECT company_id AS companyId, SUM(CASE WHEN channel='wholesale' THEN total ELSE 0 END) AS wholesale, COUNT(*) AS orders FROM sales_orders WHERE created_at > ? GROUP BY company_id HAVING wholesale > 20000 ORDER BY wholesale DESC LIMIT 20`,
    )
    .all(since);
}

export { like, companyBalance, payCompany, flag };
