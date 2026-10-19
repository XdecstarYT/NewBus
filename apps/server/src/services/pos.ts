/**
 * POS (point of sale) and online shops between players.
 *
 *  - In store: a business rings up products at its register -> a checkout with a short code
 *    and QR. The customer (another player's company) scans/types it and pays with their Bits.
 *  - Online: players order from another business's shop, paying now or at pickup. The
 *    business marks it ready; at the counter the customer's pickup code is scanned and they
 *    pay (or just collect if prepaid).
 *
 * Money: buyer -> seller (the sale) + buyer -> Treasury (sales tax), one ledger transaction.
 * Stock: taken from the seller when paid (register) or when ordered (reserved for pickup),
 * delivered into the buyer's inventory when the sale completes.
 */
import { randomInt } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema, atomic } from '../db';
import type { PosLine } from '../db/schema';
import { clock, DAY_MS } from '../lib/time';
import { newId } from '../lib/ids';
import { badRequest, conflict, forbidden, insufficientFunds, notFound } from '../lib/errors';
import { cfg } from './settings';
import { SYS, balanceOf, post } from './ledger';
import { companyWallet } from './money';
import { findCompany, getCompany } from './companies';
import { findProduct } from './catalog';
import { addStock, getRow, takeStock } from './inventory';
import { getCompanyPermissions } from '../permissions';
import { areLinked } from './bank';
import { bump, today } from './stats';
import { notify } from './notifications';
import { toCompany } from '../lib/bus';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CHECKOUT_TTL_MS = 15 * 60_000;

function newCode(len = 6) {
  return Array.from({ length: len }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}
function uniqueCode(table: 'pos' | 'order') {
  for (;;) {
    const code = newCode();
    const taken =
      table === 'pos'
        ? db.select({ id: schema.posCheckouts.id }).from(schema.posCheckouts).where(eq(schema.posCheckouts.code, code)).get()
        : db.select({ id: schema.shopOrders.id }).from(schema.shopOrders).where(eq(schema.shopOrders.pickupCode, code)).get();
    if (!taken) return code;
  }
}
export function normalizeCode(raw: string) {
  const s = String(raw ?? '').trim();
  const fromUrl = /\/pay\/([A-Za-z0-9]+)/.exec(s)?.[1] ?? s;
  return fromUrl.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Price a business charges for a product (its shelf price, or the catalog base price). */
function shelfPrice(sellerId: string, productId: string) {
  const row = db.select().from(schema.companyProducts).where(and(eq(schema.companyProducts.companyId, sellerId), eq(schema.companyProducts.productId, productId))).get();
  return row?.price ?? findProduct(productId)?.basePrice ?? 0;
}

function buildLines(sellerId: string, lines: Array<{ productId: string; qty: number }>): PosLine[] {
  if (!lines.length) throw badRequest('The basket is empty.');
  const merged = new Map<string, number>();
  for (const l of lines) {
    const qty = Math.floor(l.qty);
    if (qty < 1 || qty > 10_000) throw badRequest('Quantities must be 1-10,000.');
    merged.set(l.productId, (merged.get(l.productId) ?? 0) + qty);
  }
  return [...merged].map(([productId, qty]) => {
    const p = findProduct(productId);
    if (!p) throw notFound(`No product "${productId}".`);
    return { productId, name: p.name, emoji: p.emoji, qty, unitPrice: shelfPrice(sellerId, productId) };
  });
}

function totals(items: PosLine[], discountPct = 0) {
  const gross = items.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const subtotal = Math.round(gross * (1 - discountPct / 100));
  const tax = Math.round((subtotal * cfg().economy.salesTaxBps) / 10_000);
  return { subtotal, tax, total: subtotal + tax };
}

function assertStock(sellerId: string, items: PosLine[]) {
  for (const l of items) {
    const have = getRow(sellerId, 'product', l.productId)?.qty ?? 0;
    if (have < l.qty) throw badRequest(`Not enough ${l.emoji} ${l.name} in stock (${have} left).`, 'out_of_stock');
  }
}

/** Move money buyer -> seller (+ tax to the Treasury). Respects the buyer's balance and daily spend cap. */
function charge(buyerId: string, sellerId: string, subtotal: number, tax: number, memo: string, accountId: string) {
  if (buyerId === sellerId) throw badRequest("You can't buy from your own business.");
  if (areLinked(buyerId, sellerId)) throw forbidden('These two companies are linked by the Owner, so they cannot trade with each other.', 'linked');
  const total = subtotal + tax;
  const have = balanceOf(companyWallet(buyerId));
  if (have < total) throw insufficientFunds(total, have);
  const cap = getCompanyPermissions(buyerId).limits.dailySpendCap;
  if (cap != null && today(buyerId, 'spent') + total > cap) throw forbidden(`That would pass your daily spending cap (${cap} BT).`, 'spend_cap');
  post({
    kind: 'sale.pos',
    memo,
    actorId: accountId,
    legs: [
      { from: companyWallet(buyerId), to: companyWallet(sellerId), amount: subtotal },
      ...(tax > 0 ? [{ from: companyWallet(buyerId), to: SYS.TREASURY, amount: tax }] : []),
    ],
  });
  bump(buyerId, 'spent', total);
  bump(buyerId, 'purchases');
}

function qualityOf(items: PosLine[]) {
  return Object.fromEntries(items.map((l) => [l.productId, l.quality ?? 50]));
}

function deliver(sellerId: string, buyerId: string, items: PosLine[], qualities: Record<string, number>) {
  for (const l of items) addStock(buyerId, 'product', l.productId, l.qty, qualities[l.productId] ?? 50);
  const units = items.reduce((s, l) => s + l.qty, 0);
  const revenue = items.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  bump(sellerId, 'sold', units);
  bump(sellerId, 'revenue', revenue);
  bump(sellerId, 'posSales');
  for (const l of items) db.update(schema.companyProducts).set({ sold: sql`${schema.companyProducts.sold} + ${l.qty}` }).where(and(eq(schema.companyProducts.companyId, sellerId), eq(schema.companyProducts.productId, l.productId))).run();
}

// ------------------------------------------------------------ register (in store)
export function createCheckout(sellerId: string, accountId: string, input: { lines: Array<{ productId: string; qty: number }>; discountPct?: number }) {
  const discountPct = Math.max(0, Math.min(50, Math.floor(input.discountPct ?? 0)));
  const items = buildLines(sellerId, input.lines);
  assertStock(sellerId, items);
  const t = totals(items, discountPct);
  const now = clock.now();
  const row = { id: newId('pos'), code: uniqueCode('pos'), sellerId, buyerId: null, orderId: null, items, ...t, discountPct, status: 'open', createdBy: accountId, paidBy: null, createdAt: now, paidAt: null, expiresAt: now + CHECKOUT_TTL_MS };
  db.insert(schema.posCheckouts).values(row).run();
  return row;
}

/** What the customer sees after scanning. */
export function viewCheckout(code: string) {
  const c = db.select().from(schema.posCheckouts).where(eq(schema.posCheckouts.code, normalizeCode(code))).get();
  if (!c) throw notFound('No sale with that code. Check the letters on the register.');
  const seller = findCompany(c.sellerId);
  const status = c.status === 'open' && c.expiresAt < clock.now() ? 'expired' : c.status;
  return { code: c.code, status, seller: seller ? { id: seller.id, name: seller.name, emoji: seller.emoji } : null, items: c.items, subtotal: c.subtotal, discountPct: c.discountPct, tax: c.tax, total: c.total, orderId: c.orderId, expiresAt: c.expiresAt };
}

export function payCheckout(buyerId: string, accountId: string, code: string) {
  return atomic(() => {
    const c = db.select().from(schema.posCheckouts).where(eq(schema.posCheckouts.code, normalizeCode(code))).get();
    if (!c) throw notFound('No sale with that code.');
    if (c.status !== 'open') throw conflict(c.status === 'paid' ? 'This sale is already paid.' : `This sale was ${c.status}.`);
    if (c.expiresAt < clock.now()) throw badRequest('This sale expired. Ask the cashier to ring it up again.');
    const order = c.orderId ? db.select().from(schema.shopOrders).where(eq(schema.shopOrders.id, c.orderId)).get() : null;
    if (order && order.buyerId !== buyerId) throw forbidden('This pickup belongs to another customer.');
    // stock: register sales take it now; order pickups already reserved it when ordered
    const qualities = order ? qualityOf(order.items) : qualityOf(c.items.map((l) => ({ ...l, quality: getRow(c.sellerId, 'product', l.productId)?.quality ?? 50 })));
    if (!order) {
      assertStock(c.sellerId, c.items);
      for (const l of c.items) takeStock(c.sellerId, 'product', l.productId, l.qty);
    }
    const seller = getCompany(c.sellerId);
    charge(buyerId, c.sellerId, c.subtotal, c.tax, `${seller.name} (register ${c.code})`, accountId);
    deliver(c.sellerId, buyerId, c.items, qualities);
    const now = clock.now();
    db.update(schema.posCheckouts).set({ status: 'paid', buyerId, paidBy: accountId, paidAt: now }).where(eq(schema.posCheckouts.id, c.id)).run();
    if (order) db.update(schema.shopOrders).set({ paid: true, status: 'collected', collectedAt: now }).where(eq(schema.shopOrders.id, order.id)).run();
    const buyer = getCompany(buyerId);
    toCompany(c.sellerId, { type: 'pos', event: 'paid', code: c.code, total: c.total, buyer: buyer.name });
    toCompany(buyerId, { type: 'company' });
    return { ok: true, total: c.total, seller: seller.name, items: c.items };
  });
}

export function cancelCheckout(sellerId: string, id: string) {
  const c = db.select().from(schema.posCheckouts).where(and(eq(schema.posCheckouts.id, id), eq(schema.posCheckouts.sellerId, sellerId))).get();
  if (!c) throw notFound('No such sale.');
  if (c.status !== 'open') throw conflict('Only open sales can be cancelled.');
  db.update(schema.posCheckouts).set({ status: 'cancelled' }).where(eq(schema.posCheckouts.id, id)).run();
  return { ok: true };
}

// ------------------------------------------------------------ online shop
/** Businesses that have stock on their shelves, for the shop directory. */
export function shopDirectory(viewerId: string) {
  const rows = db
    .select({ companyId: schema.companyProducts.companyId, n: sql<number>`count(*)` })
    .from(schema.companyProducts)
    .innerJoin(schema.inventory, and(eq(schema.inventory.companyId, schema.companyProducts.companyId), eq(schema.inventory.itemType, 'product'), eq(schema.inventory.itemId, schema.companyProducts.productId)))
    .where(and(eq(schema.companyProducts.onSale, true), sql`${schema.inventory.qty} > 0`))
    .groupBy(schema.companyProducts.companyId)
    .all();
  return rows
    .filter((r) => r.companyId !== viewerId)
    .map((r) => {
      const co = findCompany(r.companyId);
      return co && co.status === 'active' ? { id: co.id, name: co.name, emoji: co.emoji, color: co.color, slogan: co.slogan, stars: Math.round(co.reputation / 10) / 10, products: r.n } : null;
    })
    .filter(Boolean);
}

export function storefront(sellerId: string) {
  const co = getCompany(sellerId);
  const listed = db.select().from(schema.companyProducts).where(and(eq(schema.companyProducts.companyId, sellerId), eq(schema.companyProducts.onSale, true))).all();
  const products = listed
    .map((cp) => {
      const p = findProduct(cp.productId);
      const stock = getRow(sellerId, 'product', cp.productId);
      return p && stock && stock.qty > 0 ? { productId: p.id, name: p.name, emoji: p.emoji, description: (p as any).description ?? '', price: cp.price, stock: stock.qty, quality: stock.quality } : null;
    })
    .filter(Boolean);
  return { seller: { id: co.id, name: co.name, emoji: co.emoji, color: co.color, slogan: co.slogan, stars: Math.round(co.reputation / 10) / 10 }, products, taxBps: cfg().economy.salesTaxBps };
}

export function placeOrder(buyerId: string, accountId: string, input: { sellerId: string; lines: Array<{ productId: string; qty: number }>; payMode: 'now' | 'pickup'; note?: string }) {
  return atomic(() => {
    const seller = findCompany(input.sellerId);
    if (!seller || seller.status !== 'active') throw notFound('That shop is closed.');
    if (input.sellerId === buyerId) throw badRequest("You can't order from your own shop.");
    if (areLinked(buyerId, input.sellerId)) throw forbidden('These two companies are linked by the Owner, so they cannot trade with each other.', 'linked');
    const open = db.select({ n: sql<number>`count(*)` }).from(schema.shopOrders).where(and(eq(schema.shopOrders.buyerId, buyerId), inArray(schema.shopOrders.status, ['placed', 'ready']))).get()!.n;
    if (open >= 10) throw badRequest('You already have 10 orders waiting. Pick some up first!');
    // only listed products can be ordered online
    const listed = new Set(db.select({ p: schema.companyProducts.productId }).from(schema.companyProducts).where(and(eq(schema.companyProducts.companyId, input.sellerId), eq(schema.companyProducts.onSale, true))).all().map((r) => r.p));
    for (const l of input.lines) if (!listed.has(l.productId)) throw badRequest('That product is not sold in this shop.');
    const items = buildLines(input.sellerId, input.lines);
    assertStock(input.sellerId, items);
    const t = totals(items);
    const id = newId('ord');
    for (const l of items) l.quality = getRow(input.sellerId, 'product', l.productId)?.quality ?? 50;
    // reserve the stock for this customer
    for (const l of items) takeStock(input.sellerId, 'product', l.productId, l.qty);
    let paid = false;
    if (input.payMode === 'now') {
      charge(buyerId, input.sellerId, t.subtotal, t.tax, `${seller.name} online order`, accountId);
      paid = true;
    }
    const row = { id, pickupCode: uniqueCode('order'), sellerId: input.sellerId, buyerId, buyerAccountId: accountId, items, ...t, payMode: input.payMode, paid, status: 'placed', note: (input.note ?? '').slice(0, 200), createdAt: clock.now(), readyAt: null, collectedAt: null };
    db.insert(schema.shopOrders).values(row).run();
    const buyer = getCompany(buyerId);
    notify(input.sellerId, 'order', `🛍️ New order from ${buyer.emoji} ${buyer.name}`, `${items.map((l) => `${l.qty}× ${l.name}`).join(', ')} · ${paid ? 'paid online' : 'pays at pickup'}`);
    toCompany(input.sellerId, { type: 'pos', event: 'order', id });
    return row;
  });
}

export function markReady(sellerId: string, orderId: string) {
  const o = db.select().from(schema.shopOrders).where(and(eq(schema.shopOrders.id, orderId), eq(schema.shopOrders.sellerId, sellerId))).get();
  if (!o) throw notFound('No such order.');
  if (o.status !== 'placed') throw conflict(`This order is already ${o.status}.`);
  db.update(schema.shopOrders).set({ status: 'ready', readyAt: clock.now() }).where(eq(schema.shopOrders.id, orderId)).run();
  const seller = getCompany(sellerId);
  notify(o.buyerId, 'order', `📦 Your order from ${seller.name} is ready!`, `Show pickup code ${o.pickupCode} at their counter${o.paid ? '' : ` and pay ${o.total} BT`}.`);
  toCompany(o.buyerId, { type: 'pos', event: 'ready', id: o.id });
  return { ok: true };
}

/** At the counter: find the order from the customer's pickup code. */
export function findPickup(sellerId: string, code: string) {
  const o = db.select().from(schema.shopOrders).where(and(eq(schema.shopOrders.pickupCode, normalizeCode(code)), eq(schema.shopOrders.sellerId, sellerId))).get();
  if (!o) throw notFound('No order with that pickup code at this shop.');
  const buyer = findCompany(o.buyerId);
  return { ...o, buyer: buyer ? { name: buyer.name, emoji: buyer.emoji } : null };
}

/**
 * Hand the order over. Prepaid orders are delivered right away; unpaid ones open a
 * register sale for the customer to pay on their phone (delivery happens on payment).
 */
export function collectOrder(sellerId: string, accountId: string, orderId: string) {
  return atomic(() => {
    const o = db.select().from(schema.shopOrders).where(and(eq(schema.shopOrders.id, orderId), eq(schema.shopOrders.sellerId, sellerId))).get();
    if (!o) throw notFound('No such order.');
    if (o.status === 'collected' || o.status === 'cancelled') throw conflict(`This order is already ${o.status}.`);
    if (o.paid) {
      deliver(sellerId, o.buyerId, o.items, qualityOf(o.items));
      db.update(schema.shopOrders).set({ status: 'collected', collectedAt: clock.now() }).where(eq(schema.shopOrders.id, o.id)).run();
      toCompany(o.buyerId, { type: 'pos', event: 'collected', id: o.id });
      return { collected: true, checkout: null };
    }
    const existing = db.select().from(schema.posCheckouts).where(and(eq(schema.posCheckouts.orderId, o.id), eq(schema.posCheckouts.status, 'open'))).get();
    if (existing && existing.expiresAt > clock.now()) return { collected: false, checkout: existing };
    const now = clock.now();
    const row = { id: newId('pos'), code: uniqueCode('pos'), sellerId, buyerId: null, orderId: o.id, items: o.items, subtotal: o.subtotal, discountPct: 0, tax: o.tax, total: o.total, status: 'open', createdBy: accountId, paidBy: null, createdAt: now, paidAt: null, expiresAt: now + CHECKOUT_TTL_MS };
    db.insert(schema.posCheckouts).values(row).run();
    return { collected: false, checkout: row };
  });
}

/** Cancel an order (seller any time before pickup; buyer while it is still "placed"). Stock and money go back. */
export function cancelOrder(companyId: string, orderId: string, actorId: string) {
  return atomic(() => {
    const o = db.select().from(schema.shopOrders).where(eq(schema.shopOrders.id, orderId)).get();
    if (!o || (o.sellerId !== companyId && o.buyerId !== companyId)) throw notFound('No such order.');
    if (o.status === 'collected' || o.status === 'cancelled') throw conflict(`This order is already ${o.status}.`);
    if (o.buyerId === companyId && o.status !== 'placed') throw badRequest('The shop has already packed this order. Ask them to cancel it.');
    if (o.paid) {
      const have = balanceOf(companyWallet(o.sellerId));
      if (have < o.subtotal) throw insufficientFunds(o.subtotal, have);
      post({
        kind: 'refund.pos',
        memo: `Refund for order ${o.pickupCode}`,
        actorId,
        legs: [{ from: companyWallet(o.sellerId), to: companyWallet(o.buyerId), amount: o.subtotal }, ...(o.tax > 0 ? [{ from: SYS.TREASURY, to: companyWallet(o.buyerId), amount: o.tax }] : [])],
      });
    }
    for (const l of o.items) addStock(o.sellerId, 'product', l.productId, l.qty, l.quality ?? 50);
    db.update(schema.shopOrders).set({ status: 'cancelled' }).where(eq(schema.shopOrders.id, o.id)).run();
    db.update(schema.posCheckouts).set({ status: 'cancelled' }).where(and(eq(schema.posCheckouts.orderId, o.id), eq(schema.posCheckouts.status, 'open'))).run();
    const other = companyId === o.sellerId ? o.buyerId : o.sellerId;
    notify(other, 'order', `❌ Order ${o.pickupCode} was cancelled`, o.paid ? `${o.total} BT refunded.` : '');
    toCompany(other, { type: 'pos', event: 'cancelled', id: o.id });
    return { ok: true };
  });
}

// ------------------------------------------------------------ views
export function posView(sellerId: string) {
  const since = clock.now() - DAY_MS;
  const products = db
    .select()
    .from(schema.inventory)
    .where(and(eq(schema.inventory.companyId, sellerId), eq(schema.inventory.itemType, 'product'), sql`${schema.inventory.qty} > 0`))
    .all()
    .map((i) => {
      const p = findProduct(i.itemId);
      return p ? { productId: p.id, name: p.name, emoji: p.emoji, stock: i.qty, quality: i.quality, price: shelfPrice(sellerId, p.id) } : null;
    })
    .filter(Boolean);
  const checkouts = db.select().from(schema.posCheckouts).where(eq(schema.posCheckouts.sellerId, sellerId)).orderBy(desc(schema.posCheckouts.createdAt)).limit(30).all();
  const orders = db.select().from(schema.shopOrders).where(and(eq(schema.shopOrders.sellerId, sellerId), inArray(schema.shopOrders.status, ['placed', 'ready']))).orderBy(desc(schema.shopOrders.createdAt)).all();
  const paidToday = checkouts.filter((c) => c.status === 'paid' && (c.paidAt ?? 0) > since);
  return {
    products,
    taxBps: cfg().economy.salesTaxBps,
    open: checkouts.filter((c) => c.status === 'open' && c.expiresAt > clock.now()),
    recent: checkouts.filter((c) => c.status === 'paid').slice(0, 15).map((c) => ({ ...c, buyer: c.buyerId ? findCompany(c.buyerId)?.name ?? '?' : null })),
    orders: orders.map((o) => ({ ...o, buyer: findCompany(o.buyerId)?.name ?? '?', buyerEmoji: findCompany(o.buyerId)?.emoji ?? '❓' })),
    today: { sales: paidToday.length, takings: paidToday.reduce((s, c) => s + c.subtotal, 0) },
  };
}

export function myOrders(buyerId: string) {
  return db
    .select()
    .from(schema.shopOrders)
    .where(eq(schema.shopOrders.buyerId, buyerId))
    .orderBy(desc(schema.shopOrders.createdAt))
    .limit(30)
    .all()
    .map((o) => ({ ...o, seller: findCompany(o.sellerId)?.name ?? '?', sellerEmoji: findCompany(o.sellerId)?.emoji ?? '❓' }));
}
