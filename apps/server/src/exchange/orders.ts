/**
 * Order matching engine for the Bit Exchange.
 *
 *  - Market & limit orders, price-time priority; players' resting orders are
 *    matched before the Treasury market maker at equal prices.
 *  - Buy limit orders escrow their Bits in a per-order system wallet.
 *  - Wash trades / self-dealing are prevented by never matching an order
 *    against the same company or an owner-linked company.
 *  - Every trade goes through the double-entry ledger (atomic) and the audit log.
 */
import { and, asc, desc, eq, gt, inArray, lte, gte, sql } from 'drizzle-orm';
import type { AssetType } from '@dw/shared';
import { db, schema, atomic } from '../db';
import { cfg } from '../services/settings';
import { clock } from '../lib/time';
import { newId } from '../lib/ids';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { SYS, post, balanceOf, walletId } from '../services/ledger';
import { companyWallet } from '../services/money';
import { getCompanyPermissions } from '../permissions';
import { flag } from '../services/flags';
import { areLinked } from '../services/bank';
import { recordFlag } from '../services/anticheat';
import { audit } from '../services/audit';
import { bump, today } from '../services/stats';
import { bus } from '../lib/bus';
import { getAsset, holding, setHolding, marketMaker, isUnlimited, recordPrice, setHalt, TREASURY_HOLDER, type Asset, setCancelOpenOrders } from './assets';
import { tradingFee, addToBasis, removeFromBasis, breakerTripped } from './math';

export type Side = 'buy' | 'sell';
type Order = typeof schema.orders.$inferSelect;

const orderEscrow = (orderId: string) => walletId('system', `order-${orderId}`, 'main');

function walletFor(holderId: string) {
  return holderId === TREASURY_HOLDER ? SYS.TREASURY : companyWallet(holderId);
}

/** Shares a holder can still sell (position minus shares promised to open sell orders). */
export function availableToSell(holderId: string, assetId: string) {
  const pos = holding(holderId, assetId)?.qty ?? 0;
  const open = db
    .select({ s: sql<number>`COALESCE(SUM(${schema.orders.qty} - ${schema.orders.filled}),0)` })
    .from(schema.orders)
    .where(and(eq(schema.orders.holderId, holderId), eq(schema.orders.assetId, assetId), eq(schema.orders.side, 'sell'), eq(schema.orders.status, 'open')))
    .get()!.s;
  return pos - open;
}

export function portfolioValue(holderId: string) {
  const rows = db.select().from(schema.holdings).where(eq(schema.holdings.holderId, holderId)).all();
  let v = 0;
  for (const h of rows) {
    const a = db.select({ price: schema.assets.price }).from(schema.assets).where(eq(schema.assets.id, h.assetId)).get();
    v += h.qty * (a?.price ?? 0);
  }
  return v;
}

interface Counter {
  kind: 'book' | 'mm';
  order?: Order;
  holderId: string;
  price: number;
  available: number;
}

function linkedOrSelf(a: string, b: string) {
  if (a === b) return true;
  if (a === TREASURY_HOLDER || b === TREASURY_HOLDER) return false;
  return areLinked(a, b);
}

/** Best counter-party for an incoming order (price-time priority, players before the MM). */
function bestCounter(asset: Asset, side: Side, holderId: string, limit: number | null, skip: Set<string>): Counter | null {
  const oppSide = side === 'buy' ? 'sell' : 'buy';
  const conds = [eq(schema.orders.assetId, asset.id), eq(schema.orders.status, 'open'), eq(schema.orders.side, oppSide)];
  if (limit != null) conds.push(side === 'buy' ? lte(schema.orders.limitPrice, limit) : gte(schema.orders.limitPrice, limit));
  const book = db
    .select()
    .from(schema.orders)
    .where(and(...conds))
    .orderBy(side === 'buy' ? asc(schema.orders.limitPrice) : desc(schema.orders.limitPrice), asc(schema.orders.createdAt))
    .limit(25)
    .all();
  let bookBest: Counter | null = null;
  for (const o of book) {
    if (skip.has(o.id)) continue;
    if (linkedOrSelf(o.holderId, holderId)) continue; // wash-trade / self-dealing guard
    const avail = o.qty - o.filled;
    if (avail <= 0) continue;
    bookBest = { kind: 'book', order: o, holderId: o.holderId, price: o.limitPrice!, available: avail };
    break;
  }
  const mm = marketMaker(asset);
  let mmBest: Counter | null = null;
  if (holderId !== TREASURY_HOLDER) {
    if (side === 'buy' && mm.ask != null && mm.askCap > 0 && (limit == null || mm.ask <= limit)) mmBest = { kind: 'mm', holderId: TREASURY_HOLDER, price: mm.ask, available: mm.askCap };
    if (side === 'sell' && mm.bid != null && mm.bidCap > 0 && (limit == null || mm.bid >= limit)) mmBest = { kind: 'mm', holderId: TREASURY_HOLDER, price: mm.bid, available: mm.bidCap };
  }
  if (!bookBest) return mmBest;
  if (!mmBest) return bookBest;
  if (side === 'buy') return bookBest.price <= mmBest.price ? bookBest : mmBest;
  return bookBest.price >= mmBest.price ? bookBest : mmBest;
}

interface PlaceInput {
  holderId: string;
  assetId: string;
  side: Side;
  type: 'market' | 'limit';
  qty: number;
  limitPrice?: number | null;
  actorId?: string | null;
  /** internal orders (DRIP, buybacks, forced cover) skip a few player limits */
  system?: 'drip' | 'buyback' | 'cover';
}

export function placeOrder(input: PlaceInput) {
  return atomic(() => {
    const c = cfg();
    const asset = getAsset(input.assetId);
    const now = clock.now();
    if (!asset.listed) throw badRequest('That asset is not listed.');
    if (asset.halted) throw badRequest(`Trading in $${asset.symbol} is halted: ${asset.haltReason ?? 'paused'}.`, 'halted');
    if (!Number.isInteger(input.qty) || input.qty < 1 || input.qty > c.exchange.maxOrderQty) throw badRequest(`Order size must be 1-${c.exchange.maxOrderQty}.`);
    if (input.type === 'limit' && (!input.limitPrice || input.limitPrice < 1)) throw badRequest('Limit orders need a limit price.');
    const holder = input.holderId;
    const perms = getCompanyPermissions(holder);
    if (!input.system) {
      if (!perms.limits.tradableAssets.includes(asset.type as AssetType)) throw forbidden(`You are not allowed to trade ${asset.type.toLowerCase()}s.`, 'asset_type');
      if (perms.limits.maxDailyTrades != null && today(holder, 'trades') >= perms.limits.maxDailyTrades) throw forbidden(`Daily trade limit reached (${perms.limits.maxDailyTrades}).`, 'limit');
      if (asset.companyId === holder && asset.lockupUntil && now < asset.lockupUntil) throw forbidden('Lock-up window! You cannot trade your own shares yet.', 'lockup');
    }
    // sell-side checks
    if (input.side === 'sell') {
      const avail = availableToSell(holder, asset.id);
      const shortOk = flag('shorting') && perms.limits.shortingAllowed && asset.type === 'STOCK' && !input.system;
      if (avail < input.qty) {
        if (!shortOk) throw badRequest(`You only have ${Math.max(0, avail)} $${asset.symbol} available to sell.`, 'insufficient_shares');
        const maxShortValue = Math.floor(balanceOf(companyWallet(holder)) / 1.5);
        if ((input.qty - Math.max(0, avail)) * asset.price > maxShortValue) throw badRequest('Short too big for your collateral (need 150% of the short value in Bits).', 'margin');
      }
      if (asset.companyId === holder && asset.type === 'STOCK') {
        const after = (holding(holder, asset.id)?.qty ?? 0) - input.qty;
        if (after < Math.ceil((asset.sharesOutstanding * c.exchange.founderMinPct) / 100)) throw forbidden(`Founders must keep at least ${c.exchange.founderMinPct}% of their shares.`, 'founder_min');
      }
    }
    // buy-side caps
    if (input.side === 'buy' && !input.system) {
      const ref = input.limitPrice ?? Math.max(asset.price, marketMaker(asset).ask ?? asset.price);
      if (perms.limits.maxPortfolioValue != null && portfolioValue(holder) + ref * input.qty > perms.limits.maxPortfolioValue) throw forbidden(`That would exceed your portfolio cap (${perms.limits.maxPortfolioValue} BT).`, 'limit');
      if (asset.type === 'COIN') {
        const have = (holding(holder, asset.id)?.qty ?? 0) * asset.price;
        if (have + ref * input.qty > c.exchange.coins.maxHoldingValue) throw forbidden(`Meme coins are capped at ${c.exchange.coins.maxHoldingValue} BT per company. Stay safe out there!`, 'coin_cap');
      }
    }
    const order: Order = {
      id: newId('ord'),
      assetId: asset.id,
      holderId: holder,
      side: input.side,
      type: input.type,
      qty: input.qty,
      filled: 0,
      limitPrice: input.limitPrice ?? null,
      reserved: 0,
      status: 'open',
      createdAt: now,
    };
    db.insert(schema.orders).values(order).run();
    if (!input.system || input.system === 'drip') bump(holder, 'trades');
    // buy limits escrow their worst-case cost up front
    if (input.side === 'buy' && input.type === 'limit') {
      const reserve = input.qty * input.limitPrice! + tradingFee(input.qty * input.limitPrice!, c.economy.tradingFeeBps);
      post({ kind: 'trade.escrow', memo: `Buy order $${asset.symbol}`, actorId: input.actorId, legs: [{ from: companyWallet(holder), to: orderEscrow(order.id), amount: reserve }] });
      order.reserved = reserve;
      db.update(schema.orders).set({ reserved: reserve }).where(eq(schema.orders.id, order.id)).run();
    }
    const fills = match(asset, order, input.actorId ?? null);
    const fresh = db.select().from(schema.orders).where(eq(schema.orders.id, order.id)).get()!;
    if (fresh.type === 'market' && fresh.status === 'open') closeOrder(fresh, fresh.filled > 0 ? 'filled' : 'cancelled');
    if (fresh.filled === 0 && fresh.type === 'market') throw badRequest(input.side === 'buy' ? 'Nobody is selling right now (or you could not afford it).' : 'Nobody is buying right now.', 'no_liquidity');
    return { order: db.select().from(schema.orders).where(eq(schema.orders.id, order.id)).get()!, fills };
  });
}

function match(asset: Asset, order: Order, actorId: string | null) {
  const c = cfg();
  const fills: Array<{ qty: number; price: number; counter: string }> = [];
  const skip = new Set<string>([order.id]);
  let remaining = order.qty - order.filled;
  let guard = 0;
  while (remaining > 0 && guard++ < 200) {
    const fresh = getAsset(asset.id);
    if (fresh.halted) break;
    const counter = bestCounter(fresh, order.side as Side, order.holderId, order.type === 'limit' ? order.limitPrice : null, skip);
    if (!counter) break;
    let qty = Math.min(remaining, counter.available);
    const price = counter.price;
    // market buys: only fill what the taker can afford
    if (order.side === 'buy' && order.type === 'market') {
      const bal = balanceOf(companyWallet(order.holderId));
      const affordable = Math.floor(bal / (price * (1 + c.economy.tradingFeeBps / 10_000) + 1));
      qty = Math.min(qty, affordable);
      if (qty <= 0) break;
    }
    if (counter.kind === 'book') skip.add(counter.order!.id);
    const buyer = order.side === 'buy' ? order : counter.order ?? null;
    const seller = order.side === 'sell' ? order : counter.order ?? null;
    execute(fresh, {
      qty,
      price,
      buyerId: order.side === 'buy' ? order.holderId : counter.holderId,
      sellerId: order.side === 'sell' ? order.holderId : counter.holderId,
      buyOrder: buyer,
      sellOrder: seller,
      taker: order.side as Side,
      actorId,
    });
    remaining -= qty;
    fills.push({ qty, price, counter: counter.kind === 'mm' ? 'market maker' : counter.holderId });
  }
  return fills;
}

interface Exec {
  qty: number;
  price: number;
  buyerId: string;
  sellerId: string;
  buyOrder: Order | null;
  sellOrder: Order | null;
  taker: Side;
  actorId: string | null;
}

function execute(asset: Asset, e: Exec) {
  const c = cfg();
  const notional = e.qty * e.price;
  const fee = tradingFee(notional, c.economy.tradingFeeBps);
  const takerId = e.taker === 'buy' ? e.buyerId : e.sellerId;
  // where the buyer's money comes from: escrow for resting/limit buy orders, else the wallet
  const buyEscrow = e.buyOrder && e.buyOrder.type === 'limit' && e.buyOrder.holderId !== TREASURY_HOLDER ? orderEscrow(e.buyOrder.id) : null;
  const buyerFrom = buyEscrow ?? walletFor(e.buyerId);
  // where the seller's proceeds go: IPO float proceeds go to the listed company
  let sellerTo = walletFor(e.sellerId);
  let primary = 0;
  if (e.sellerId === TREASURY_HOLDER && asset.type === 'STOCK' && asset.primaryRemaining > 0 && asset.companyId) {
    primary = Math.min(e.qty, asset.primaryRemaining);
    sellerTo = companyWallet(asset.companyId);
  }
  const legs = [{ from: buyerFrom, to: sellerTo, amount: notional, kind: 'trade.settle' }];
  if (takerId !== TREASURY_HOLDER) legs.push({ from: e.taker === 'buy' ? buyerFrom : walletFor(e.sellerId), to: SYS.TREASURY, amount: fee, kind: 'fee.trading' });
  post({ kind: 'trade.settle', memo: `${e.qty} $${asset.symbol} @ ${e.price}`, actorId: e.actorId, legs });
  // escrow bookkeeping
  if (buyEscrow && e.buyOrder) {
    const used = notional + (e.taker === 'buy' ? fee : 0);
    db.update(schema.orders).set({ reserved: sql`${schema.orders.reserved} - ${used}` }).where(eq(schema.orders.id, e.buyOrder.id)).run();
  }
  // shares: for unlimited assets (ETFs, bonds, commodities, coins) the desk issues/redeems units on demand
  const desk = isUnlimited(asset);
  if (desk && (e.buyerId === TREASURY_HOLDER || e.sellerId === TREASURY_HOLDER)) {
    db.update(schema.assets).set({ sharesOutstanding: sql`${schema.assets.sharesOutstanding} + ${e.sellerId === TREASURY_HOLDER ? e.qty : -e.qty}` }).where(eq(schema.assets.id, asset.id)).run();
  }
  if (!(desk && e.sellerId === TREASURY_HOLDER)) {
    const s = holding(e.sellerId, asset.id);
    const ns = removeFromBasis(s?.qty ?? 0, s?.costBasis ?? 0, e.qty);
    setHolding(e.sellerId, asset.id, ns.qty, ns.basis);
  }
  if (!(desk && e.buyerId === TREASURY_HOLDER)) {
    const b = holding(e.buyerId, asset.id);
    const nb = addToBasis(b?.qty ?? 0, b?.costBasis ?? 0, e.qty, notional + (e.taker === 'buy' ? fee : 0));
    setHolding(e.buyerId, asset.id, nb.qty, nb.qty === 0 ? 0 : nb.basis);
  }
  if (primary) db.update(schema.assets).set({ primaryRemaining: sql`${schema.assets.primaryRemaining} - ${primary}` }).where(eq(schema.assets.id, asset.id)).run();
  // order fill state
  for (const o of [e.buyOrder, e.sellOrder]) {
    if (!o) continue;
    const cur = db.select().from(schema.orders).where(eq(schema.orders.id, o.id)).get()!;
    const filled = cur.filled + e.qty;
    db.update(schema.orders).set({ filled }).where(eq(schema.orders.id, o.id)).run();
    if (filled >= cur.qty) closeOrder({ ...cur, filled }, 'filled');
  }
  const now = clock.now();
  db.insert(schema.trades).values({ id: newId('trd'), assetId: asset.id, buyerId: e.buyerId, sellerId: e.sellerId, qty: e.qty, price: e.price, fee, createdAt: now }).run();
  const prev = asset.price;
  // the last traded price is THE price for stocks; the desk's mid follows it a little
  if (asset.type === 'STOCK') db.update(schema.assets).set({ price: e.price, fairValue: asset.priceMode === 'PLAYER' ? e.price : asset.fairValue * 0.9 + e.price * 0.1 }).where(eq(schema.assets.id, asset.id)).run();
  recordPrice(asset.id, e.price, e.qty, now);
  for (const h of [e.buyerId, e.sellerId]) if (h !== TREASURY_HOLDER) bump(h, 'tradeVolume', notional);
  audit({ actorId: e.actorId, action: 'exchange.trade', targetType: 'asset', targetId: asset.symbol, newValue: { buyer: e.buyerId, seller: e.sellerId, qty: e.qty, price: e.price, fee } });
  bus.publish('market', { type: 'trade', symbol: asset.symbol, qty: e.qty, price: e.price });
  // circuit breakers & spike halts (stocks)
  if (asset.type === 'STOCK') {
    if (breakerTripped(e.price, asset.dayOpen, c.exchange.circuitBreakerPct)) {
      setHalt(asset.id, true, `Circuit breaker: more than ${c.exchange.circuitBreakerPct}% move today`, null, c.exchange.haltMs / 60_000);
      db.update(schema.assets).set({ dayOpen: e.price }).where(eq(schema.assets.id, asset.id)).run();
    } else if (prev > 0 && Math.abs(e.price - prev) / prev > 0.15 && e.qty * e.price > 500) {
      setHalt(asset.id, true, 'Suspicious spike - trading paused for review', null, 5);
      recordFlag('price_spike', e.buyerId === TREASURY_HOLDER ? e.sellerId : e.buyerId, `$${asset.symbol} jumped ${prev} -> ${e.price}`, 2);
    }
  }
}

function closeOrder(o: Order, status: 'filled' | 'cancelled') {
  const cur = db.select().from(schema.orders).where(eq(schema.orders.id, o.id)).get()!;
  if (cur.reserved > 0) {
    post({ kind: 'trade.escrow_refund', legs: [{ from: orderEscrow(o.id), to: companyWallet(o.holderId), amount: cur.reserved }] });
  }
  db.update(schema.orders).set({ status, reserved: 0 }).where(eq(schema.orders.id, o.id)).run();
}

export function cancelOrder(holderId: string, orderId: string) {
  return atomic(() => {
    const o = db.select().from(schema.orders).where(and(eq(schema.orders.id, orderId), eq(schema.orders.holderId, holderId))).get();
    if (!o || o.status !== 'open') throw notFound('No open order with that id.');
    closeOrder(o, 'cancelled');
    return { ok: true };
  });
}

/** Cancel every open order for an asset (delisting, splits). */
export function cancelAllForAsset(assetId: string) {
  for (const o of db.select().from(schema.orders).where(and(eq(schema.orders.assetId, assetId), eq(schema.orders.status, 'open'))).all()) closeOrder(o, 'cancelled');
}
setCancelOpenOrders(cancelAllForAsset);

/** Aggregated order book (players) + the market maker's quote. */
export function orderBook(assetId: string) {
  const a = getAsset(assetId);
  const open = db.select().from(schema.orders).where(and(eq(schema.orders.assetId, assetId), eq(schema.orders.status, 'open'))).all();
  const agg = (side: Side) => {
    const m = new Map<number, number>();
    for (const o of open.filter((x) => x.side === side)) m.set(o.limitPrice!, (m.get(o.limitPrice!) ?? 0) + (o.qty - o.filled));
    return [...m].map(([price, qty]) => ({ price, qty })).sort((x, y) => (side === 'buy' ? y.price - x.price : x.price - y.price)).slice(0, 12);
  };
  const mm = marketMaker(a);
  return { bids: agg('buy'), asks: agg('sell'), mm: { bid: mm.bid, ask: mm.ask, askSize: mm.askCap, bidSize: mm.bidCap } };
}

export function myOrders(holderId: string) {
  return db.select().from(schema.orders).where(eq(schema.orders.holderId, holderId)).orderBy(desc(schema.orders.createdAt)).limit(50).all();
}

export function recentTrades(assetId: string, limit = 30) {
  return db.select().from(schema.trades).where(eq(schema.trades.assetId, assetId)).orderBy(desc(schema.trades.createdAt)).limit(limit).all();
}

/** Forced cover for shorts that no longer have enough collateral. */
export function marginTick() {
  const shorts = db.select().from(schema.holdings).where(sql`${schema.holdings.qty} < 0`).all();
  for (const h of shorts) {
    const a = getAsset(h.assetId);
    const value = -h.qty * a.price;
    if (balanceOf(companyWallet(h.holderId)) < value * 1.2) {
      try {
        placeOrder({ holderId: h.holderId, assetId: a.id, side: 'buy', type: 'market', qty: -h.qty, system: 'cover' });
      } catch {}
    }
  }
}

export { gt, inArray };
