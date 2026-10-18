/**
 * Bit Exchange assets: stocks (via owner-approved IPOs), ETFs tracking
 * indexes, Treasury & company bonds, commodities and fictional meme coins.
 *
 * Every asset has an automated market maker ("the Treasury desk") except in
 * PLAYER price mode, where only the IPO float is offered and prices come from
 * the order book. Fundamentals mode pulls the MM mid toward a fair value
 * computed from the company's real activity.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { AssetType, PriceMode } from '@dw/shared';
import { db, schema, atomic, sqlite } from '../db';
import { cfg } from '../services/settings';
import { clock, dayKey, DAY_MS } from '../lib/time';
import { newId } from '../lib/ids';
import { liveRng } from '../engine/rng';
import { badRequest, notFound } from '../lib/errors';
import { getCompany } from '../services/companies';
import { getIndustry, getCommodity } from '../services/catalog';
import { getCompanyPermissions } from '../permissions';
import { SYS, post, balanceOf } from '../services/ledger';
import { companyWallet } from '../services/money';
import { activeModifiers, addModifier } from '../services/multipliers';
import { addNews } from '../services/news';
import { notify } from '../services/notifications';
import { audit } from '../services/audit';
import { bus } from '../lib/bus';
import { getStat } from '../services/stats';
import { fundamentalValue, driftToward, mmQuote, breakerTripped } from './math';

export type Asset = typeof schema.assets.$inferSelect;
export const TREASURY_HOLDER = 'treasury';
const UNLIMITED: AssetType[] = ['ETF', 'BOND', 'COMMODITY', 'COIN'];

export function isUnlimited(a: Asset) {
  return UNLIMITED.includes(a.type as AssetType);
}

export function getAsset(id: string): Asset {
  const a = db.select().from(schema.assets).where(eq(schema.assets.id, id)).get();
  if (!a) throw notFound('No such asset. Did it go to the moon without us?');
  return a;
}

export function findAssetBySymbol(symbol: string) {
  return db.select().from(schema.assets).where(eq(schema.assets.symbol, symbol.toUpperCase())).get();
}

export function stockOf(companyId: string) {
  return db.select().from(schema.assets).where(and(eq(schema.assets.companyId, companyId), eq(schema.assets.type, 'STOCK'))).get();
}

function newAsset(input: Partial<Asset> & { symbol: string; name: string; type: AssetType; price: number }) {
  const now = clock.now();
  const row: Asset = {
    id: newId('ast'),
    symbol: input.symbol.toUpperCase(),
    name: input.name,
    type: input.type,
    companyId: input.companyId ?? null,
    priceMode: input.priceMode ?? cfg().exchange.defaultPriceMode,
    price: input.price,
    fairValue: input.fairValue ?? input.price,
    sharesOutstanding: input.sharesOutstanding ?? 0,
    primaryRemaining: input.primaryRemaining ?? 0,
    founderPct: input.founderPct ?? 0,
    dividendPct: input.dividendPct ?? 0,
    dayOpen: input.price,
    dayKey: dayKey(now),
    halted: false,
    haltReason: null,
    haltUntil: null,
    lockupUntil: input.lockupUntil ?? null,
    listed: true,
    data: input.data ?? {},
    createdAt: now,
  };
  db.insert(schema.assets).values(row).run();
  recordPrice(row.id, row.price, 0, now);
  return row;
}

/** Unique ticker from a company name: "Crusty Dreams" -> "CRSTY" / "CRUD". */
export function makeSymbol(name: string): string {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, '');
  const words = name.toUpperCase().split(/\s+/).map((w) => w.replace(/[^A-Z]/g, '')).filter(Boolean);
  const candidates = [
    words.map((w) => w[0]).join('').slice(0, 4),
    letters.replace(/[AEIOU]/g, '').slice(0, 4),
    letters.slice(0, 4),
    letters.slice(0, 3),
  ].filter((c) => c.length >= 2);
  for (const c of candidates) if (!findAssetBySymbol(c)) return c;
  for (let i = 2; i < 99; i++) {
    const c = `${(candidates[0] ?? 'CO').slice(0, 3)}${i}`;
    if (!findAssetBySymbol(c)) return c;
  }
  return `C${Date.now().toString(36).toUpperCase().slice(-4)}`;
}

// ------------------------------------------------------------ price history
export function recordPrice(assetId: string, price: number, volume: number, now = clock.now()) {
  const bucket = Math.floor(now / 60_000) * 60_000;
  sqlite
    .prepare(
      `INSERT INTO price_history (asset_id, bucket, o, h, l, c, v) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(asset_id, bucket) DO UPDATE SET h = MAX(h, excluded.h), l = MIN(l, excluded.l), c = excluded.c, v = v + excluded.v`,
    )
    .run(assetId, bucket, price, price, price, price, volume);
}

export function candles(assetId: string, limit = 120) {
  return db
    .select()
    .from(schema.priceHistory)
    .where(eq(schema.priceHistory.assetId, assetId))
    .orderBy(sql`${schema.priceHistory.bucket} DESC`)
    .limit(limit)
    .all()
    .reverse();
}

export function changeOver(assetId: string, ms: number) {
  const a = getAsset(assetId);
  const old = db
    .select({ c: schema.priceHistory.c })
    .from(schema.priceHistory)
    .where(and(eq(schema.priceHistory.assetId, assetId), sql`${schema.priceHistory.bucket} <= ${clock.now() - ms}`))
    .orderBy(sql`${schema.priceHistory.bucket} DESC`)
    .get();
  const first = old ?? db.select({ c: schema.priceHistory.c }).from(schema.priceHistory).where(eq(schema.priceHistory.assetId, assetId)).orderBy(schema.priceHistory.bucket).get();
  const base = first?.c ?? a.price;
  return base ? Math.round(((a.price - base) / base) * 10_000) / 100 : 0;
}

// ------------------------------------------------------------ holdings
export function holding(holderId: string, assetId: string) {
  return db.select().from(schema.holdings).where(and(eq(schema.holdings.holderId, holderId), eq(schema.holdings.assetId, assetId))).get();
}

export function setHolding(holderId: string, assetId: string, qty: number, costBasis: number, drip?: boolean) {
  const now = clock.now();
  if (qty === 0) {
    db.delete(schema.holdings).where(and(eq(schema.holdings.holderId, holderId), eq(schema.holdings.assetId, assetId))).run();
    return;
  }
  db.insert(schema.holdings)
    .values({ holderId, assetId, qty, costBasis, drip: drip ?? false, acquiredAt: now })
    .onConflictDoUpdate({ target: [schema.holdings.holderId, schema.holdings.assetId], set: { qty, costBasis, ...(drip != null ? { drip } : {}) } })
    .run();
}

// ------------------------------------------------------------ market maker
/** The MM's current quote, or null when it isn't making a market. */
export function marketMaker(a: Asset): { bid: number | null; ask: number | null; askCap: number; bidCap: number } {
  const c = cfg();
  if (!a.listed || a.halted) return { bid: null, ask: null, askCap: 0, bidCap: 0 };
  const q = mmQuote(a.fairValue, c.exchange.mmSpreadBps);
  if (isUnlimited(a)) return { bid: q.bid, ask: q.ask, askCap: 5000, bidCap: 5000 };
  const treasuryQty = holding(TREASURY_HOLDER, a.id)?.qty ?? 0;
  const cap = Math.max(1, Math.floor((a.sharesOutstanding * c.exchange.mmMaxPerOrderPct) / 100));
  if (a.priceMode === 'PLAYER') {
    // player-driven: the desk only sells the IPO float, at the IPO price
    return { bid: null, ask: a.primaryRemaining > 0 ? Math.max(1, (a.data as any)?.ipoPrice ?? a.price) : null, askCap: Math.min(a.primaryRemaining, treasuryQty), bidCap: 0 };
  }
  return { bid: q.bid, ask: treasuryQty > 0 ? q.ask : null, askCap: Math.min(cap, treasuryQty), bidCap: cap };
}

// ------------------------------------------------------------ fundamentals
export function fundamentalsFor(companyId: string, shares: number) {
  const c = cfg();
  const co = getCompany(companyId);
  const cash = (sqlite.prepare(`SELECT COALESCE(SUM(balance),0) s FROM wallets WHERE owner_type='company' AND owner_id = ?`).get(companyId) as { s: number }).s;
  const loans = (sqlite.prepare(`SELECT COALESCE(SUM(outstanding),0) s FROM loans WHERE borrower_id = ? AND status = 'active'`).get(companyId) as { s: number }).s;
  const inventory = (sqlite.prepare(`SELECT COALESCE(SUM(qty),0) s FROM inventory WHERE company_id = ?`).get(companyId) as { s: number }).s * 5;
  const workers = db.select({ n: sql<number>`count(*)` }).from(schema.workers).where(eq(schema.workers.companyId, companyId)).get()!.n;
  const now = clock.now();
  const recent = (sqlite.prepare(`SELECT COALESCE(SUM(amount),0) s FROM ledger_entries WHERE to_wallet = ? AND created_at > ? AND (kind LIKE 'income.%' OR kind LIKE 'sale.%')`).get(companyWallet(companyId), now - 3600_000) as { s: number }).s;
  const previous = (sqlite.prepare(`SELECT COALESCE(SUM(amount),0) s FROM ledger_entries WHERE to_wallet = ? AND created_at BETWEEN ? AND ? AND (kind LIKE 'income.%' OR kind LIKE 'sale.%')`).get(companyWallet(companyId), now - 7200_000, now - 3600_000) as { s: number }).s;
  const ticksPerHour = 3600_000 / c.tick.intervalMs;
  const profitPerTick = Math.max(co.incomePerTick - co.wagesPerTick, recent / ticksPerHour - co.wagesPerTick);
  const input = {
    netWorth: cash + inventory - loans,
    profitPerTick,
    workers,
    contracts: getStat(companyId, 'contracts'),
    level: co.level,
    creditScore: co.creditScore,
    growth: previous > 0 ? recent / previous : 1,
    shares,
  };
  return { input, value: fundamentalValue(input, c.exchange.fundamentals) };
}

/** Target price modifier from market events (bull run, audit scare...). */
function eventMultiplier(a: Asset, now: number) {
  let m = 1;
  for (const mod of activeModifiers(null, now)) {
    if (mod.kind === `price:${a.symbol}` || mod.kind === `price:${a.type}` || mod.kind === 'price:*') m *= mod.value;
  }
  return m;
}

// ------------------------------------------------------------ indexes
export function indexValue(rule: { kind: 'top'; n: number } | { kind: 'category'; category: string }) {
  const stocks = db.select().from(schema.assets).where(and(eq(schema.assets.type, 'STOCK'), eq(schema.assets.listed, true))).all();
  let members = stocks;
  if (rule.kind === 'category') members = stocks.filter((s) => s.companyId && rule.category.split(',').includes(getIndustry(getCompany(s.companyId).industryId).categoryId));
  members = members.sort((a, b) => b.price * b.sharesOutstanding - a.price * a.sharesOutstanding).slice(0, rule.kind === 'top' ? rule.n : 500);
  const cap = members.reduce((s, m) => s + m.price * m.sharesOutstanding, 0);
  return { cap, members: members.map((m) => m.symbol) };
}

// ------------------------------------------------------------ IPO lifecycle
/** A fair IPO price from fundamentals (shown to players and the owner). */
export function suggestedIpoPrice(companyId: string, shares: number) {
  return Math.max(1, Math.round(fundamentalsFor(companyId, shares).value));
}

export function requestIpo(companyId: string, req: { shares: number; price: number; founderPct: number; pitch: string }) {
  const perms = getCompanyPermissions(companyId);
  if (!perms.modules.exchange) throw badRequest('The Stock Market module is not enabled for your company.');
  const co = getCompany(companyId);
  if (co.ipoStatus === 'listed') throw badRequest('Already listed! Ring the bell again some other time.');
  if (co.ipoStatus === 'requested') throw badRequest('Your IPO request is already waiting for the Owner.');
  const c = cfg();
  if (req.founderPct < c.exchange.founderMinPct || req.founderPct > 95) throw badRequest(`Founders must keep ${c.exchange.founderMinPct}-95% of shares.`);
  db.update(schema.companies).set({ ipoStatus: 'requested', ipoRequest: { ...req, requestedAt: clock.now() } }).where(eq(schema.companies.id, companyId)).run();
  bus.publish('owner', { type: 'owner_refresh', reason: 'ipo_request' });
  return { ok: true };
}

export function approveIpo(companyId: string, opts: { shares: number; price: number; founderPct: number; priceMode: PriceMode; dividendPct: number; symbol?: string }, actorId: string) {
  return atomic(() => {
    const co = getCompany(companyId);
    if (co.ipoStatus === 'listed') throw badRequest('Already listed.');
    const c = cfg();
    if (opts.founderPct < c.exchange.founderMinPct) throw badRequest(`Founder must keep at least ${c.exchange.founderMinPct}%.`);
    if (stockOf(companyId)) throw badRequest('This company already has a stock (maybe delisted). Relist it instead.');
    const symbol = (opts.symbol?.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || makeSymbol(co.name));
    if (findAssetBySymbol(symbol)) throw badRequest(`Ticker ${symbol} is taken.`);
    const founderShares = Math.floor((opts.shares * opts.founderPct) / 100);
    const float = opts.shares - founderShares;
    const now = clock.now();
    const asset = newAsset({
      symbol,
      name: co.name,
      type: 'STOCK',
      companyId,
      priceMode: opts.priceMode,
      price: opts.price,
      fairValue: opts.price,
      sharesOutstanding: opts.shares,
      primaryRemaining: float,
      founderPct: opts.founderPct,
      dividendPct: opts.dividendPct,
      lockupUntil: now + c.exchange.lockupMs,
      data: { ipoPrice: opts.price, ipoAt: now, lastDividendAt: now },
    });
    setHolding(companyId, asset.id, founderShares, 0);
    setHolding(TREASURY_HOLDER, asset.id, float, 0);
    db.update(schema.companies).set({ ipoStatus: 'listed' }).where(eq(schema.companies.id, companyId)).run();
    audit({ actorId, action: 'exchange.ipo_approve', targetType: 'company', targetId: companyId, newValue: { ...opts, symbol } });
    addNews('market', `🔔 ${co.emoji} ${co.name} lists on the Bit Exchange as $${symbol}!`, `IPO at ${opts.price} BT/share. Boss Byte has already set a price alert.`, companyId);
    notify(companyId, 'ipo', `🔔 You're listed as $${symbol}!`, `Your IPO is live. Founder lock-up: ${Math.round(c.exchange.lockupMs / 60_000)} minutes.`);
    return asset;
  });
}

export function rejectIpo(companyId: string, reason: string, actorId: string) {
  db.update(schema.companies).set({ ipoStatus: 'rejected' }).where(eq(schema.companies.id, companyId)).run();
  notify(companyId, 'ipo', '❌ IPO request declined', reason || 'The Owner said "not yet". Grow a bit and try again!');
  audit({ actorId, action: 'exchange.ipo_reject', targetType: 'company', targetId: companyId, newValue: { reason } });
}

/** Delist: the Treasury buys out every outside holder at the last price, then the stock is retired. */
export function delist(assetId: string, actorId: string) {
  return atomic(() => {
    const a = getAsset(assetId);
    const holders = db.select().from(schema.holdings).where(eq(schema.holdings.assetId, assetId)).all();
    for (const h of holders) {
      if (h.holderId === TREASURY_HOLDER || h.holderId === a.companyId || h.qty <= 0) continue;
      const amount = h.qty * a.price;
      if (amount > 0) post({ kind: 'trade.delist_buyout', memo: `$${a.symbol} delisted`, actorId, legs: [{ from: SYS.TREASURY, to: companyWallet(h.holderId), amount }] });
      notify(h.holderId, 'exchange', `📤 $${a.symbol} was delisted`, `You were bought out for ${amount} BT.`);
    }
    db.delete(schema.holdings).where(eq(schema.holdings.assetId, assetId)).run();
    cancelOpenOrders(assetId);
    db.update(schema.assets).set({ listed: false, halted: true, haltReason: 'Delisted' }).where(eq(schema.assets.id, assetId)).run();
    if (a.companyId) db.update(schema.companies).set({ ipoStatus: 'none' }).where(eq(schema.companies.id, a.companyId)).run();
    audit({ actorId, action: 'exchange.delist', targetType: 'asset', targetId: assetId });
    addNews('market', `📤 $${a.symbol} has been delisted from the Bit Exchange.`, 'Shareholders were bought out by the Treasury.');
  });
}

let cancelOpenOrdersImpl: (assetId: string) => void = () => {};
export function setCancelOpenOrders(fn: (assetId: string) => void) {
  cancelOpenOrdersImpl = fn;
}
function cancelOpenOrders(assetId: string) {
  cancelOpenOrdersImpl(assetId);
}

export function setHalt(assetId: string, halted: boolean, reason: string, actorId: string | null, minutes?: number) {
  const until = halted && minutes ? clock.now() + minutes * 60_000 : null;
  db.update(schema.assets).set({ halted, haltReason: halted ? reason : null, haltUntil: until }).where(eq(schema.assets.id, assetId)).run();
  if (actorId) audit({ actorId, action: halted ? 'exchange.halt' : 'exchange.resume', targetType: 'asset', targetId: assetId, newValue: { reason } });
  bus.publish('market', { type: 'halt', assetId, halted, reason });
}

export function setPriceMode(assetId: string, mode: PriceMode, actorId: string) {
  db.update(schema.assets).set({ priceMode: mode }).where(eq(schema.assets.id, assetId)).run();
  audit({ actorId, action: 'exchange.price_mode', targetType: 'asset', targetId: assetId, newValue: mode });
}

export function setOwnerPrice(assetId: string, price: number, actorId: string) {
  const a = getAsset(assetId);
  db.update(schema.assets).set({ fairValue: price, price, priceMode: 'OWNER' }).where(eq(schema.assets.id, assetId)).run();
  recordPrice(assetId, price, 0);
  audit({ actorId, action: 'exchange.owner_price', targetType: 'asset', targetId: assetId, oldValue: a.price, newValue: price });
}

// ------------------------------------------------------------ seed: indexes, ETFs, bonds, commodities, coins
const COMMODITY_ASSETS: Array<[string, string]> = [
  ['FLOUR', 'flour'],
  ['COFFEE', 'coffee-beans'],
  ['MOON', 'moon-rocks'],
  ['GOLD', 'gold'],
  ['GEMS', 'gems'],
  ['ZAP', 'energy'],
  ['CHIPS', 'chips'],
  ['FISH', 'fish'],
];

export function seedMarket() {
  const now = clock.now();
  if (!findAssetBySymbol('BIT500')) {
    const idx: Array<[string, string, { kind: 'top'; n: number } | { kind: 'category'; category: string }]> = [
      ['BIT500', 'Bit500 Index Fund', { kind: 'top', n: 500 }],
      ['FOOD', 'Food & Drink Index', { kind: 'category', category: 'food,beverages,agriculture' }],
      ['TECH', 'Tech Index', { kind: 'category', category: 'tech,gaming,science' }],
      ['WACKY', 'Weird and Wacky Index', { kind: 'category', category: 'weird,events,arts' }],
    ];
    for (const [symbol, name, rule] of idx) {
      db.insert(schema.indexes).values({ id: newId('idx'), symbol, name, rule, value: 100, createdAt: now }).run();
      newAsset({ symbol, name, type: 'ETF', price: 100, priceMode: 'FUNDAMENTALS', data: { index: symbol, divisor: 0 } });
    }
  }
  if (!findAssetBySymbol('TBOND')) {
    const b = cfg().exchange.bonds;
    newAsset({ symbol: 'TBOND', name: 'Treasury Bond', type: 'BOND', price: b.parValue, priceMode: 'FUNDAMENTALS', data: { couponBps: b.couponBpsPerPeriod, issuer: 'treasury', lastCouponAt: now, maturesAt: null } });
  }
  for (const [symbol, cid] of COMMODITY_ASSETS) {
    if (findAssetBySymbol(symbol)) continue;
    const cdef = getCommodity(cid);
    newAsset({ symbol, name: cdef.name, type: 'COMMODITY', price: cdef.basePrice * 10, priceMode: 'FUNDAMENTALS', data: { commodityId: cid } });
  }
  for (const [symbol, name, price] of [
    ['DUCK', 'DuckCoin', 40],
    ['PIZZA', 'PizzaCoin', 25],
  ] as const) {
    if (!findAssetBySymbol(symbol)) newAsset({ symbol, name, type: 'COIN', price, priceMode: 'FUNDAMENTALS', data: { meme: true } });
  }
}

/** Owner: issue company bonds (proceeds go to the company, it pays the coupons). */
export function issueCompanyBond(companyId: string, couponBps: number, termPeriods: number, actorId: string) {
  const co = getCompany(companyId);
  const b = cfg().exchange.bonds;
  let symbol = `${makeSymbol(co.name).slice(0, 3)}B`;
  for (let i = 2; findAssetBySymbol(symbol); i++) symbol = `${makeSymbol(co.name).slice(0, 3)}B${i}`;
  const a = newAsset({ symbol, name: `${co.name} Bond`, type: 'BOND', companyId, price: b.parValue, priceMode: 'FUNDAMENTALS', data: { couponBps, issuer: companyId, lastCouponAt: clock.now(), maturesAt: clock.now() + termPeriods * b.periodMs } });
  audit({ actorId, action: 'exchange.issue_bond', targetType: 'asset', targetId: a.id, newValue: { companyId, couponBps, termPeriods } });
  return a;
}

// ------------------------------------------------------------ the market tick
export function marketTick(now: number) {
  const c = cfg();
  const rng = liveRng();
  const assets = db.select().from(schema.assets).where(eq(schema.assets.listed, true)).all();
  const ticker: Array<Record<string, unknown>> = [];
  const today = dayKey(now);
  for (const a of assets) {
    // new day: reset the circuit-breaker reference price
    if (a.dayKey !== today) {
      db.update(schema.assets).set({ dayOpen: a.price, dayKey: today }).where(eq(schema.assets.id, a.id)).run();
      a.dayOpen = a.price;
    }
    if (a.halted && a.haltUntil && a.haltUntil <= now) setHalt(a.id, false, '', null);
    if (a.halted) continue;
    let target = a.fairValue;
    if (a.type === 'STOCK' && a.companyId) {
      if (a.priceMode === 'FUNDAMENTALS') {
        target = fundamentalsFor(a.companyId, a.sharesOutstanding).value;
        // post-IPO honeymoon: blend from the IPO price toward fundamentals so listings don't crash on day one
        const data = (a.data ?? {}) as Record<string, any>;
        const age = now - (data.ipoAt ?? a.createdAt);
        const w = Math.max(0, 1 - age / c.exchange.honeymoonMs) * 0.7;
        if (w > 0 && data.ipoPrice) target = target * (1 - w) + data.ipoPrice * w;
      }
      else if (a.priceMode === 'OWNER') target = a.fairValue;
      else target = a.price; // PLAYER mode: the book decides
    } else if (a.type === 'ETF') {
      const idx = db.select().from(schema.indexes).where(eq(schema.indexes.symbol, (a.data as any).index)).get();
      if (idx) {
        const { cap } = indexValue(idx.rule as any);
        const data = a.data as any;
        // the divisor is fixed the first time the index has members, so it starts at 100
        if (cap > 0 && !data.divisor) {
          data.divisor = cap / 100;
          db.update(schema.assets).set({ data }).where(eq(schema.assets.id, a.id)).run();
        }
        const v = cap > 0 && data.divisor ? cap / data.divisor : 100;
        db.update(schema.indexes).set({ value: v }).where(eq(schema.indexes.id, idx.id)).run();
        target = v;
      }
    } else if (a.type === 'COMMODITY') {
      const cid = (a.data as any).commodityId;
      const produced = getStat('global', `d:${today}:commodity:${cid}:produced`);
      const bought = getStat('global', `d:${today}:commodity:${cid}:bought`);
      const factor = Math.max(0.5, Math.min(2, Math.sqrt((bought + 20) / (produced + 20))));
      target = getCommodity(cid).basePrice * 10 * factor;
    } else if (a.type === 'BOND') {
      target = cfg().exchange.bonds.parValue;
    } else if (a.type === 'COIN') {
      // meme coins: random walk + rare pump-and-dump
      const vol = c.exchange.coins.volatility;
      target = a.fairValue * (1 + (rng.next() * 2 - 1) * vol);
      if (rng.chance(0.0015)) {
        const pump = rng.chance(0.5);
        target *= pump ? 1.6 : 0.5;
        addNews('market', pump ? `🚀 $${a.symbol} is PUMPING! ${a.name} up 60% on a viral meme!` : `💥 $${a.symbol} DUMPS! ${a.name} halves after influencer sneezes.`, 'This is not financial advice. It is not even finance.');
      }
      target = Math.max(1, Math.min(1000, target));
    }
    target *= eventMultiplier(a, now);
    const pull = a.type === 'COIN' ? 0.5 : c.exchange.anchorPull;
    let mid = a.priceMode === 'PLAYER' && a.type === 'STOCK' ? a.price : driftToward(a.fairValue, target, pull, a.type === 'BOND' ? 0.0005 : c.exchange.noisePct, rng.next());
    if (a.priceMode === 'OWNER') mid = a.fairValue;
    const price = Math.max(1, Math.round(mid));
    db.update(schema.assets).set({ fairValue: mid, price: a.priceMode === 'PLAYER' && a.type === 'STOCK' ? a.price : price }).where(eq(schema.assets.id, a.id)).run();
    if (a.priceMode !== 'PLAYER' || a.type !== 'STOCK') recordPrice(a.id, price, 0, now);
    const finalPrice = a.priceMode === 'PLAYER' && a.type === 'STOCK' ? a.price : price;
    // circuit breaker on drift too (e.g. a crash event)
    if (a.type === 'STOCK' && breakerTripped(finalPrice, a.dayOpen, c.exchange.circuitBreakerPct)) {
      setHalt(a.id, true, `Circuit breaker: moved more than ${c.exchange.circuitBreakerPct}% today`, null, c.exchange.haltMs / 60_000);
      db.update(schema.assets).set({ dayOpen: finalPrice }).where(eq(schema.assets.id, a.id)).run();
    }
    ticker.push({ symbol: a.symbol, price: finalPrice, type: a.type, change: a.dayOpen ? Math.round(((finalPrice - a.dayOpen) / a.dayOpen) * 1000) / 10 : 0 });
  }
  bus.publish('market', { type: 'ticker', items: ticker, comment: commentary(ticker) });
}

const MOONING = ['is MOONING! 🚀', 'is on fire! 🔥', 'just did a backflip! 🤸', 'is going to the moon (cartoon moon)! 🌙'];
const CRASHING = ['is having a nap... a deep one 😴', 'fell down the stairs 📉', 'needs a hug 🫂', 'is sad. Buy the dip? 🍦'];
function commentary(items: Array<Record<string, any>>) {
  const movers = items.filter((i) => Math.abs(i.change) >= 5).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  if (!movers.length) return 'Boss Byte says: calm markets. Perfect time for a snack.';
  const m = movers[0];
  const rng = liveRng();
  return `Boss Byte says: $${m.symbol} ${m.change > 0 ? rng.pick(MOONING) : rng.pick(CRASHING)} (${m.change > 0 ? '+' : ''}${m.change}% today)`;
}

/** Market events for Chaos Controls (and the occasional random one). */
export const MARKET_EVENTS: Record<string, { label: string; emoji: string; kind: string; mult: number; minutes: number; text: string }> = {
  'bull-run': { label: 'Bull Run', emoji: '🐂', kind: 'price:STOCK', mult: 1.2, minutes: 30, text: 'A bull ran through the trading floor! Stocks charge upward.' },
  'bubble-pop': { label: 'Bubble Pop', emoji: '🫧', kind: 'price:COIN', mult: 0.5, minutes: 30, text: 'The meme-coin bubble POPPED. Ducks everywhere are crying.' },
  'audit-scare': { label: 'Audit Scare', emoji: '🧾', kind: 'price:STOCK', mult: 0.85, minutes: 20, text: 'Rumours of a big audit spook the market.' },
  'meme-rally': { label: 'Viral Meme Rally', emoji: '🐸', kind: 'price:COIN', mult: 2, minutes: 20, text: 'A frog meme sent meme coins soaring!' },
  'supply-shock': { label: 'Supply Shock', emoji: '📦', kind: 'price:COMMODITY', mult: 1.5, minutes: 30, text: 'A giant hamster blocked the shipping lane. Commodities spike!' },
  'market-crash': { label: 'Market Crash', emoji: '💥', kind: 'price:*', mult: 0.7, minutes: 20, text: 'Everything is down! (Cartoon crash. Nobody actually fell.)' },
  'market-boom': { label: 'Market Boom', emoji: '🎆', kind: 'price:*', mult: 1.3, minutes: 30, text: 'Boom Week! Everything is up and everyone is smug.' },
};

export function triggerMarketEvent(key: string) {
  const ev = MARKET_EVENTS[key];
  if (!ev) throw notFound('Unknown market event.');
  addModifier(null, ev.kind, ev.mult, ev.minutes, `market:${key}`);
  addNews('market', `${ev.emoji} ${ev.label}! ${ev.text}`, `Effect lasts ${ev.minutes} minutes.`);
  bus.publish('global', { type: 'boss', text: `${ev.emoji} ${ev.label}! ${ev.text}`, mood: ev.mult > 1 ? 'wow' : 'sad' });
  return ev;
}

export function randomMarketEvent(now: number) {
  if (liveRng().chance(0.25)) triggerMarketEvent(liveRng().pick(Object.keys(MARKET_EVENTS).filter((k) => k !== 'market-crash' && k !== 'market-boom')));
  void now;
}

export function listedAssets() {
  return db.select().from(schema.assets).where(eq(schema.assets.listed, true)).all();
}

export { inArray, DAY_MS, balanceOf };
