/**
 * Shops (fixed-price storefronts), pickup orders (stock held until the buyer pays
 * at the counter), the POS register (QR / 6-letter code) and transfers.
 */
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { ITEMS, isItem, type ItemId } from '@dw/shared/live';
import { schema, type Db } from '../db';
import type { Line } from '../db/schema';
import type { Account, Company } from '../http/router';
import { clock, MINUTE } from '../lib/time';
import { newId, shortCode } from '../lib/ids';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { assertAllowed, hint, notify, topics } from './core';
import { pay, W, balance } from './money';
import { settleSale } from './market';
import { addItem, qtyOf, takeItem } from './stock';

const CHECKOUT_TTL = 15 * MINUTE;
const itemName = (i: string) => `${ITEMS[i as ItemId]?.emoji ?? ''} ${ITEMS[i as ItemId]?.name ?? i}`.trim();

async function company(db: Db, id: string) {
  const r = await db.select().from(schema.companies).where(eq(schema.companies.id, id));
  if (!r[0] || r[0].status !== 'active') throw notFound('That shop is closed.');
  return r[0];
}

// ------------------------------------------------------------ listings
export async function setListing(db: Db, company: Company, item: string, price: number, active: boolean) {
  if (!isItem(item)) throw badRequest('Unknown item.');
  const p = Math.floor(price);
  if (p < 1 || p > 1_000_000) throw badRequest('Price must be 1 to 1,000,000 BT.');
  await db
    .insert(schema.listings)
    .values({ companyId: company.id, item, price: p, active })
    .onConflictDoUpdate({ target: [schema.listings.companyId, schema.listings.item], set: { price: p, active } });
  await hint(db, topics.all, { t: 'shops' });
  return { ok: true };
}

export async function listingsOf(db: Db, companyId: string) {
  return db.select().from(schema.listings).where(eq(schema.listings.companyId, companyId));
}

/** Shops with at least one listed item in stock. */
export async function directory(db: Db, viewerId: string | null) {
  const rows = await db
    .select({ companyId: schema.listings.companyId, n: sql<number>`count(*)::int` })
    .from(schema.listings)
    .innerJoin(schema.inventory, and(eq(schema.inventory.companyId, schema.listings.companyId), eq(schema.inventory.item, schema.listings.item)))
    .where(and(eq(schema.listings.active, true), gt(schema.inventory.qty, 0)))
    .groupBy(schema.listings.companyId);
  if (!rows.length) return [];
  const cos = await db.select().from(schema.companies).where(inArray(schema.companies.id, rows.map((r) => r.companyId)));
  return rows
    .filter((r) => r.companyId !== viewerId)
    .map((r) => {
      const c = cos.find((x) => x.id === r.companyId);
      return c && c.status === 'active' ? { id: c.id, name: c.name, emoji: c.emoji, color: c.color, slogan: c.slogan, items: r.n } : null;
    })
    .filter(Boolean);
}

export async function storefront(db: Db, sellerId: string) {
  const co = await company(db, sellerId);
  const list = await db
    .select({ item: schema.listings.item, price: schema.listings.price, stock: schema.inventory.qty })
    .from(schema.listings)
    .innerJoin(schema.inventory, and(eq(schema.inventory.companyId, schema.listings.companyId), eq(schema.inventory.item, schema.listings.item)))
    .where(and(eq(schema.listings.companyId, sellerId), eq(schema.listings.active, true), gt(schema.inventory.qty, 0)));
  return { seller: { id: co.id, name: co.name, emoji: co.emoji, color: co.color, slogan: co.slogan }, items: list };
}

/** Price each requested line from the seller's listings. */
async function priceLines(db: Db, sellerId: string, lines: Array<{ item: string; qty: number }>): Promise<Line[]> {
  const listed = await listingsOf(db, sellerId);
  const merged = new Map<string, number>();
  for (const l of lines) merged.set(l.item, (merged.get(l.item) ?? 0) + Math.floor(l.qty));
  return [...merged.entries()].map(([item, qty]) => {
    const li = listed.find((x) => x.item === item && x.active);
    if (!li) throw badRequest(`${itemName(item)} is not for sale here.`);
    if (qty < 1) throw badRequest('Quantities must be at least 1.');
    return { item, qty, price: li.price };
  });
}

const totalOf = (lines: Line[]) => lines.reduce((s, l) => s + l.qty * l.price, 0);

async function assertCanTrade(db: Db, buyer: Company, sellerId: string) {
  if (buyer.id === sellerId) throw badRequest('You can not buy from your own shop.');
  await assertAllowed(db, sellerId, 'shop');
}

/** Buy now: pay and receive the items immediately. */
export async function buyNow(db: Db, account: Account, buyer: Company, sellerId: string, lines: Array<{ item: string; qty: number }>) {
  await assertCanTrade(db, buyer, sellerId);
  const seller = await company(db, sellerId);
  const priced = await priceLines(db, sellerId, lines);
  const need = totalOf(priced);
  const have = await balance(db, W.company(buyer.id));
  if (have < need) throw badRequest(`Not enough Bits: that costs ${need} BT and you have ${have} BT.`, 'insufficient_funds');
  for (const l of priced) {
    await takeItem(db, sellerId, l.item, l.qty);
    await settleSale(db, { from: W.company(buyer.id), sellerId, buyerId: buyer.id, item: l.item, qty: l.qty, price: l.price, venue: 'shop', actorId: account.id });
    await addItem(db, buyer.id, l.item, l.qty);
  }
  await notify(db, { companyId: sellerId }, 'shop', `🛒 ${buyer.emoji} ${buyer.name} bought from your shop`, `${priced.map((l) => `${l.qty}× ${itemName(l.item)}`).join(', ')} · ${need} BT`);
  await hint(db, topics.company(buyer.id), { t: 'stock' });
  await hint(db, topics.all, { t: 'shops' });
  return { total: need, seller: seller.name, lines: priced };
}

// ------------------------------------------------------------ pickup orders
export async function orderPickup(db: Db, account: Account, buyer: Company, sellerId: string, lines: Array<{ item: string; qty: number }>, note: string) {
  await assertCanTrade(db, buyer, sellerId);
  await company(db, sellerId);
  const open = await db.select({ n: sql<number>`count(*)::int` }).from(schema.pickups).where(and(eq(schema.pickups.buyerId, buyer.id), inArray(schema.pickups.status, ['waiting', 'ready'])));
  if (open[0].n >= 10) throw conflict('You already have 10 orders waiting. Pick some up first!');
  const priced = await priceLines(db, sellerId, lines);
  for (const l of priced) await takeItem(db, sellerId, l.item, l.qty); // held for this buyer
  const row = { id: newId('pk', 12), code: await uniqueCode(db), sellerId, buyerId: buyer.id, lines: priced, total: totalOf(priced), status: 'waiting', note: note.slice(0, 200), createdAt: clock.now(), doneAt: null };
  await db.insert(schema.pickups).values(row);
  await notify(db, { companyId: sellerId }, 'shop', `🛍️ Pickup order from ${buyer.emoji} ${buyer.name}`, `${priced.map((l) => `${l.qty}× ${itemName(l.item)}`).join(', ')} · pays ${row.total} BT at the counter`);
  return row;
}

export async function markReady(db: Db, seller: Company, id: string) {
  const p = await pickupOf(db, id);
  if (p.sellerId !== seller.id) throw forbidden('Not your order.');
  if (p.status !== 'waiting') throw conflict('This order is not waiting.');
  await db.update(schema.pickups).set({ status: 'ready' }).where(eq(schema.pickups.id, id));
  await notify(db, { companyId: p.buyerId }, 'shop', `📦 Your order is ready for pickup`, `Show code ${p.code} at ${seller.emoji} ${seller.name}.`);
  return { ok: true };
}

/** At the counter: open a register sale for the pickup; the buyer pays it with the code / QR. */
export async function startPickupPayment(db: Db, account: Account, seller: Company, id: string) {
  const p = await pickupOf(db, id);
  if (p.sellerId !== seller.id) throw forbidden('Not your order.');
  if (!['waiting', 'ready'].includes(p.status)) throw conflict('This order is closed.');
  return newCheckout(db, account, seller.id, p.lines, p.id);
}

export async function findPickup(db: Db, seller: Company, code: string) {
  const r = await db.select().from(schema.pickups).where(and(eq(schema.pickups.code, normalizeCode(code)), eq(schema.pickups.sellerId, seller.id)));
  if (!r[0]) throw notFound('No pickup order with that code here.');
  const b = await db.select({ name: schema.companies.name, emoji: schema.companies.emoji }).from(schema.companies).where(eq(schema.companies.id, r[0].buyerId));
  return { ...r[0], buyer: b[0] ?? null };
}

export async function cancelPickup(db: Db, by: Company, id: string) {
  const p = await pickupOf(db, id);
  if (p.sellerId !== by.id && p.buyerId !== by.id) throw forbidden('Not your order.');
  if (!['waiting', 'ready'].includes(p.status)) throw conflict('This order is closed.');
  for (const l of p.lines) await addItem(db, p.sellerId, l.item, l.qty); // back on the shelf
  await db.update(schema.pickups).set({ status: 'cancelled', doneAt: clock.now() }).where(eq(schema.pickups.id, id));
  await db.update(schema.checkouts).set({ status: 'cancelled' }).where(and(eq(schema.checkouts.orderId, id), eq(schema.checkouts.status, 'open')));
  await notify(db, { companyId: p.sellerId === by.id ? p.buyerId : p.sellerId }, 'shop', `❌ Pickup order ${p.code} was cancelled`);
  return { ok: true };
}

async function pickupOf(db: Db, id: string) {
  const r = await db.select().from(schema.pickups).where(eq(schema.pickups.id, id)).for('update');
  if (!r[0]) throw notFound('No such order.');
  return r[0];
}

export async function pickupsFor(db: Db, companyId: string, as: 'buyer' | 'seller') {
  const col = as === 'buyer' ? schema.pickups.buyerId : schema.pickups.sellerId;
  const rows = await db.select().from(schema.pickups).where(eq(col, companyId)).orderBy(desc(schema.pickups.createdAt)).limit(40);
  const ids = [...new Set(rows.map((r) => (as === 'buyer' ? r.sellerId : r.buyerId)))];
  const cos = ids.length ? await db.select({ id: schema.companies.id, name: schema.companies.name, emoji: schema.companies.emoji }).from(schema.companies).where(inArray(schema.companies.id, ids)) : [];
  return rows.map((r) => ({ ...r, other: cos.find((c) => c.id === (as === 'buyer' ? r.sellerId : r.buyerId)) ?? null }));
}

// ------------------------------------------------------------ POS register
export function normalizeCode(raw: string) {
  const s = String(raw ?? '').trim();
  const fromUrl = /\/pay\/([A-Za-z0-9]+)/.exec(s)?.[1] ?? s;
  return fromUrl.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function uniqueCode(db: Db) {
  for (let i = 0; i < 20; i++) {
    const code = shortCode();
    const a = await db.select({ id: schema.checkouts.id }).from(schema.checkouts).where(eq(schema.checkouts.code, code));
    const b = await db.select({ id: schema.pickups.id }).from(schema.pickups).where(eq(schema.pickups.code, code));
    if (!a.length && !b.length) return code;
  }
  throw conflict('Could not make a code. Try again.');
}

async function newCheckout(db: Db, account: Account, sellerId: string, lines: Line[], orderId: string | null) {
  const now = clock.now();
  const row = { id: newId('chk', 12), code: await uniqueCode(db), sellerId, buyerId: null, orderId, lines, total: totalOf(lines), status: 'open', createdBy: account.id, createdAt: now, paidAt: null, expiresAt: now + CHECKOUT_TTL };
  await db.insert(schema.checkouts).values(row);
  return row;
}

/** Ring up a sale at the register. Prices come from the request (the cashier types them) or the shop listing. */
export async function ringUp(db: Db, account: Account, seller: Company, lines: Array<{ item: string; qty: number; price?: number }>) {
  await assertAllowed(db, seller.id, 'shop');
  if (!lines.length) throw badRequest('Add something to the sale.');
  const listed = await listingsOf(db, seller.id);
  const priced: Line[] = [];
  for (const l of lines) {
    if (!isItem(l.item)) throw badRequest('Unknown item.');
    const price = Math.floor(l.price ?? listed.find((x) => x.item === l.item)?.price ?? 0);
    if (price < 1) throw badRequest(`Set a price for ${itemName(l.item)}.`);
    const qty = Math.floor(l.qty);
    if (qty < 1) throw badRequest('Quantities must be at least 1.');
    if ((await qtyOf(db, seller.id, l.item)) < qty) throw badRequest(`Not enough ${itemName(l.item)} in stock.`);
    priced.push({ item: l.item, qty, price });
  }
  return newCheckout(db, account, seller.id, priced, null);
}

export async function viewCheckout(db: Db, code: string) {
  const r = await db.select().from(schema.checkouts).where(eq(schema.checkouts.code, normalizeCode(code)));
  const c = r[0];
  if (!c) throw notFound('No sale with that code. Check the letters on the register.');
  const s = await db.select({ id: schema.companies.id, name: schema.companies.name, emoji: schema.companies.emoji }).from(schema.companies).where(eq(schema.companies.id, c.sellerId));
  const status = c.status === 'open' && c.expiresAt < clock.now() ? 'expired' : c.status;
  return { ...c, status, seller: s[0] ?? null };
}

export async function payCheckout(db: Db, account: Account, buyer: Company, code: string) {
  const r = await db.select().from(schema.checkouts).where(eq(schema.checkouts.code, normalizeCode(code))).for('update');
  const c = r[0];
  if (!c) throw notFound('No sale with that code.');
  if (c.status !== 'open') throw conflict(c.status === 'paid' ? 'This sale is already paid.' : `This sale was ${c.status}.`);
  if (c.expiresAt < clock.now()) throw badRequest('This sale expired. Ask the cashier to ring it up again.');
  if (c.sellerId === buyer.id) throw badRequest('You can not pay your own register.');
  const pickup = c.orderId ? await pickupOf(db, c.orderId) : null;
  if (pickup && pickup.buyerId !== buyer.id) throw forbidden('This pickup belongs to another customer.');
  const have = await balance(db, W.company(buyer.id));
  if (have < c.total) throw badRequest(`Not enough Bits: you need ${c.total} BT and have ${have} BT.`, 'insufficient_funds');
  for (const l of c.lines) {
    if (!pickup) await takeItem(db, c.sellerId, l.item, l.qty); // pickups were held already
    await settleSale(db, { from: W.company(buyer.id), sellerId: c.sellerId, buyerId: buyer.id, item: l.item, qty: l.qty, price: l.price, venue: 'pos', actorId: account.id });
    await addItem(db, buyer.id, l.item, l.qty);
  }
  const now = clock.now();
  await db.update(schema.checkouts).set({ status: 'paid', buyerId: buyer.id, paidAt: now }).where(eq(schema.checkouts.id, c.id));
  if (pickup) await db.update(schema.pickups).set({ status: 'collected', doneAt: now }).where(eq(schema.pickups.id, pickup.id));
  await hint(db, topics.company(c.sellerId), { t: 'pos', event: 'paid', code: c.code, total: c.total, buyer: buyer.name });
  await hint(db, topics.company(buyer.id), { t: 'stock' });
  return { ok: true, total: c.total, lines: c.lines };
}

export async function cancelCheckout(db: Db, seller: Company, id: string) {
  const r = await db.select().from(schema.checkouts).where(and(eq(schema.checkouts.id, id), eq(schema.checkouts.sellerId, seller.id)));
  if (!r[0]) throw notFound('No such sale.');
  if (r[0].status !== 'open') throw conflict('Only open sales can be cancelled.');
  await db.update(schema.checkouts).set({ status: 'cancelled' }).where(eq(schema.checkouts.id, id));
  return { ok: true };
}

export async function recentSales(db: Db, sellerId: string) {
  return db.select().from(schema.checkouts).where(and(eq(schema.checkouts.sellerId, sellerId), eq(schema.checkouts.status, 'paid'))).orderBy(desc(schema.checkouts.paidAt)).limit(10);
}

// ------------------------------------------------------------ transfers
export async function sendBits(db: Db, account: Account, from: Company, toId: string, amount: number, memo: string) {
  await assertAllowed(db, from.id, 'transfers');
  const to = await company(db, toId);
  if (to.id === from.id) throw badRequest('That is your own company.');
  const amt = Math.floor(amount);
  if (amt < 1) throw badRequest('Send at least 1 BT.');
  await pay(db, W.company(from.id), W.company(to.id), amt, 'transfer.bits', memo.slice(0, 120) || `From ${from.name}`, account.id);
  await notify(db, { companyId: to.id }, 'transfer', `💸 ${from.emoji} ${from.name} sent you ${amt} BT`, memo.slice(0, 120));
  return { ok: true };
}

export async function sendItems(db: Db, account: Account, from: Company, toId: string, item: string, qty: number, memo: string) {
  await assertAllowed(db, from.id, 'transfers');
  if (!isItem(item)) throw badRequest('Unknown item.');
  const to = await company(db, toId);
  if (to.id === from.id) throw badRequest('That is your own company.');
  const n = Math.floor(qty);
  if (n < 1) throw badRequest('Send at least 1.');
  await takeItem(db, from.id, item, n);
  await addItem(db, to.id, item, n);
  await db.insert(schema.auditLog).values({ actorId: account.id, action: 'transfer.items', target: to.id, data: { from: from.id, item, qty: n, memo }, createdAt: clock.now() });
  await notify(db, { companyId: to.id }, 'transfer', `📦 ${from.emoji} ${from.name} sent you ${n}× ${itemName(item)}`, memo.slice(0, 120));
  await hint(db, topics.company(to.id), { t: 'stock' });
  return { ok: true };
}
