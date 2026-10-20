/**
 * Player market: one order book per item. Buy orders lock Bits in escrow, sell
 * orders lock the items. Matching uses the waiting order's price; the seller pays
 * the sales tax out of the proceeds.
 */
import { and, asc, desc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { ITEMS, ITEM_IDS, isItem, type ItemId } from '@dw/shared/live';
import { schema, type Db } from '../db';
import type { Account, Company } from '../http/router';
import { clock, DAY } from '../lib/time';
import { newId } from '../lib/ids';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { addNews, assertAllowed, getSettings, hint, notify, topics } from './core';
import { post, W } from './money';
import { addItem, takeItem } from './stock';

/** Sales tax on a sale; union members trading with each other pay half. */
export async function taxFor(db: Db, sellerId: string, buyerId: string, amount: number) {
  const s = await getSettings(db);
  let pct = s.salesTaxPct;
  if (s.unionTaxDiscount) {
    const m = await db.select().from(schema.unionMembers).where(inArray(schema.unionMembers.companyId, [sellerId, buyerId]));
    if (m.length === 2 && m[0].unionId === m[1].unionId) pct /= 2;
  }
  return Math.floor((amount * pct) / 100);
}

/** Pay a seller: buyer wallet (or escrow) -> seller, minus tax -> Treasury. */
export async function settleSale(db: Db, o: { from: string; sellerId: string; buyerId: string; item: string; qty: number; price: number; venue: 'market' | 'shop' | 'pos'; actorId?: string | null }) {
  const amount = o.qty * o.price;
  const tax = await taxFor(db, o.sellerId, o.buyerId, amount);
  await post(
    db,
    `sale.${o.venue}`,
    [
      { from: o.from, to: W.company(o.sellerId), amount: amount - tax },
      { from: o.from, to: W.treasury, amount: tax },
    ],
    { memo: `${o.qty}× ${ITEMS[o.item as ItemId]?.name ?? o.item} @ ${o.price}`, actorId: o.actorId },
  );
  await db.insert(schema.trades).values({ id: newId('trd', 12), item: o.item, price: o.price, qty: o.qty, buyerId: o.buyerId, sellerId: o.sellerId, tax, venue: o.venue, createdAt: clock.now() });
  return tax;
}

export async function placeOrder(db: Db, account: Account, company: Company, o: { item: string; side: 'buy' | 'sell'; price: number; qty: number }) {
  await assertAllowed(db, company.id, 'market');
  if (!isItem(o.item)) throw badRequest('Unknown item.');
  const price = Math.floor(o.price);
  const qty = Math.floor(o.qty);
  if (price < 1 || price > 1_000_000) throw badRequest('Price must be 1 to 1,000,000 BT.');
  if (qty < 1 || qty > 100_000) throw badRequest('Quantity must be 1 to 100,000.');
  const open = await db.select({ n: sql<number>`count(*)::int` }).from(schema.orders).where(and(eq(schema.orders.companyId, company.id), eq(schema.orders.status, 'open')));
  if (open[0].n >= 40) throw conflict('You can have up to 40 open orders.');

  if (o.side === 'buy') await post(db, 'market.escrow', [{ from: W.company(company.id), to: W.escrow, amount: price * qty }], { memo: `Buy order: ${qty}× ${ITEMS[o.item].name}`, actorId: account.id });
  else await takeItem(db, company.id, o.item, qty);

  const id = newId('ord', 12);
  await db.insert(schema.orders).values({ id, companyId: company.id, accountId: account.id, item: o.item, side: o.side, price, qty, filled: 0, status: 'open', createdAt: clock.now() });

  // match against waiting orders on the other side
  let left = qty;
  const fills: Array<{ qty: number; price: number }> = [];
  const makers = await db
    .select()
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.item, o.item),
        eq(schema.orders.side, o.side === 'buy' ? 'sell' : 'buy'),
        eq(schema.orders.status, 'open'),
        ne(schema.orders.companyId, company.id),
        o.side === 'buy' ? sql`${schema.orders.price} <= ${price}` : sql`${schema.orders.price} >= ${price}`,
      ),
    )
    .orderBy(o.side === 'buy' ? asc(schema.orders.price) : desc(schema.orders.price), asc(schema.orders.createdAt))
    .limit(100)
    .for('update');
  for (const m of makers) {
    if (left <= 0) break;
    const q = Math.min(left, m.qty - m.filled);
    if (q <= 0) continue;
    const p = m.price;
    const buyerId = o.side === 'buy' ? company.id : m.companyId;
    const sellerId = o.side === 'buy' ? m.companyId : company.id;
    await settleSale(db, { from: W.escrow, sellerId, buyerId, item: o.item, qty: q, price: p, venue: 'market', actorId: account.id });
    // a buyer who bid more than the ask gets the difference back
    if (o.side === 'buy' && price > p) await post(db, 'market.refund', [{ from: W.escrow, to: W.company(company.id), amount: (price - p) * q }]);
    await addItem(db, buyerId, o.item, q);
    const mFilled = m.filled + q;
    await db.update(schema.orders).set({ filled: mFilled, status: mFilled >= m.qty ? 'filled' : 'open' }).where(eq(schema.orders.id, m.id));
    await notify(db, { companyId: m.companyId }, 'market', `📈 ${m.side === 'buy' ? 'Bought' : 'Sold'} ${q}× ${ITEMS[o.item].emoji} ${ITEMS[o.item].name} @ ${p}`, `${company.emoji} ${company.name} took your order.`);
    left -= q;
    fills.push({ qty: q, price: p });
  }
  const filled = qty - left;
  await db.update(schema.orders).set({ filled, status: left === 0 ? 'filled' : 'open' }).where(eq(schema.orders.id, id));
  const value = fills.reduce((s, f) => s + f.qty * f.price, 0);
  if (value >= 2000) await addNews(db, 'market', `📈 Big deal: ${filled}× ${ITEMS[o.item].emoji} ${ITEMS[o.item].name} changed hands for ${value} BT`, `${company.emoji} ${company.name} was in on it.`, company.id);
  await hint(db, topics.all, { t: 'market', item: o.item });
  await hint(db, topics.company(company.id), { t: 'stock' });
  return { id, filled, left, fills };
}

export async function cancelOrder(db: Db, company: Company, orderId: string) {
  const r = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).for('update');
  const o = r[0];
  if (!o) throw notFound('No such order.');
  if (o.companyId !== company.id) throw forbidden('That is not your order.');
  if (o.status !== 'open') throw conflict('That order is already closed.');
  const left = o.qty - o.filled;
  if (o.side === 'buy') await post(db, 'market.refund', [{ from: W.escrow, to: W.company(company.id), amount: left * o.price }], { memo: 'Cancelled buy order' });
  else await addItem(db, company.id, o.item, left);
  await db.update(schema.orders).set({ status: 'cancelled' }).where(eq(schema.orders.id, orderId));
  await hint(db, topics.all, { t: 'market', item: o.item });
  return { ok: true };
}

/** Bids, asks (grouped by price), recent trades and my open orders for one item. */
export async function book(db: Db, item: string, companyId: string | null) {
  if (!isItem(item)) throw badRequest('Unknown item.');
  const level = async (side: 'buy' | 'sell') =>
    db
      .select({ price: schema.orders.price, qty: sql<number>`sum(${schema.orders.qty} - ${schema.orders.filled})::int`, orders: sql<number>`count(*)::int` })
      .from(schema.orders)
      .where(and(eq(schema.orders.item, item), eq(schema.orders.side, side), eq(schema.orders.status, 'open')))
      .groupBy(schema.orders.price)
      .orderBy(side === 'buy' ? desc(schema.orders.price) : asc(schema.orders.price))
      .limit(15);
  const recent = await db.select().from(schema.trades).where(eq(schema.trades.item, item)).orderBy(desc(schema.trades.createdAt)).limit(20);
  const mine = companyId ? await db.select().from(schema.orders).where(and(eq(schema.orders.item, item), eq(schema.orders.companyId, companyId), eq(schema.orders.status, 'open'))).orderBy(desc(schema.orders.createdAt)) : [];
  return { item, bids: await level('buy'), asks: await level('sell'), recent, mine };
}

/** One row per item: last price, 24 h volume, best bid and ask. */
export async function overview(db: Db) {
  const since = clock.now() - DAY;
  const vol = await db
    .select({ item: schema.trades.item, qty: sql<number>`sum(${schema.trades.qty})::int`, value: sql<number>`sum(${schema.trades.qty} * ${schema.trades.price})::int` })
    .from(schema.trades)
    .where(gt(schema.trades.createdAt, since))
    .groupBy(schema.trades.item);
  const last = await lastPrices(db);
  const best = await db
    .select({ item: schema.orders.item, side: schema.orders.side, max: sql<number>`max(${schema.orders.price})::int`, min: sql<number>`min(${schema.orders.price})::int` })
    .from(schema.orders)
    .where(eq(schema.orders.status, 'open'))
    .groupBy(schema.orders.item, schema.orders.side);
  return ITEM_IDS.map((id) => ({
    item: id,
    last: last[id] ?? null,
    volume: vol.find((v) => v.item === id)?.qty ?? 0,
    value: vol.find((v) => v.item === id)?.value ?? 0,
    bid: best.find((b) => b.item === id && b.side === 'buy')?.max ?? null,
    ask: best.find((b) => b.item === id && b.side === 'sell')?.min ?? null,
  }));
}

/** Last traded price per item (falls back to nothing; callers use basePrice). */
export async function lastPrices(db: Db): Promise<Record<string, number>> {
  const r = await db.execute(sql`SELECT DISTINCT ON (item) item, price FROM live.trades ORDER BY item, created_at DESC`);
  const list = (Array.isArray(r) ? r : (r as { rows: Array<{ item: string; price: number }> }).rows) as Array<{ item: string; price: number }>;
  return Object.fromEntries(list.map((x) => [x.item, Number(x.price)]));
}

export async function myOrders(db: Db, companyId: string) {
  return db.select().from(schema.orders).where(and(eq(schema.orders.companyId, companyId), eq(schema.orders.status, 'open'))).orderBy(desc(schema.orders.createdAt));
}
