/**
 * Auctions. A seller puts up a lot of goods; bidders' money waits in escrow and
 * is handed back the moment someone outbids them. A bid in the last few game
 * minutes extends the clock so nobody can snipe. The Owner can auction brand-new
 * goods; that money goes to the Treasury.
 */
import { and, asc, desc, eq, lt, or, sql } from 'drizzle-orm';
import { GAME_HOUR, GAME_MINUTE, ITEMS, isItem, minNextBid, type ItemId } from '@dw/shared/live';
import { schema, type Db } from '../db';
import type { Account, Company } from '../http/router';
import { clock } from '../lib/time';
import { newId } from '../lib/ids';
import { badRequest, conflict, forbidden } from '../lib/errors';
import { addNews, assertAllowed, audit, hint, notify, topics } from './core';
import { pay, post, W } from './money';
import { addItem, takeItem } from './stock';
import { taxFor } from './market';

const lot = (a: { qty: number; item: string }) => `${a.qty}× ${ITEMS[a.item as ItemId]?.emoji ?? ''} ${ITEMS[a.item as ItemId]?.name ?? a.item}`;
const SNIPE = 30 * GAME_MINUTE;

export async function create(db: Db, actor: Account, seller: Company | null, o: { item: string; qty: number; startPrice: number; hours: number; note: string }) {
  if (!isItem(o.item)) throw badRequest('Unknown item.');
  if (seller) {
    await assertAllowed(db, seller.id, 'market');
    const open = await db.select({ n: sql<number>`count(*)::int` }).from(schema.auctions).where(and(eq(schema.auctions.sellerId, seller.id), eq(schema.auctions.status, 'open')));
    if (open[0].n >= 5) throw conflict('You can run up to 5 auctions at once.');
    await takeItem(db, seller.id, o.item, o.qty);
  }
  const now = clock.now();
  const id = newId('auc', 12);
  await db.insert(schema.auctions).values({ id, sellerId: seller?.id ?? null, item: o.item, qty: o.qty, startPrice: o.startPrice, bids: 0, note: o.note, status: 'open', createdAt: now, endsAt: now + o.hours * GAME_HOUR });
  if (!seller) await audit(db, actor.id, 'auction.owner', id, o);
  await addNews(db, 'auction', `🔨 Auction: ${lot(o)}`, `${seller ? `${seller.emoji} ${seller.name}` : '👑 The Owner'} starts the bidding at ${o.startPrice} BT.`, seller?.id ?? null);
  await hint(db, topics.all, { t: 'auctions' });
  return { id };
}

export async function bid(db: Db, account: Account, company: Company, id: string, amount: number) {
  await assertAllowed(db, company.id, 'market');
  const a = (await db.select().from(schema.auctions).where(eq(schema.auctions.id, id)).for('update'))[0];
  const now = clock.now();
  if (!a || a.status !== 'open' || a.endsAt <= now) throw conflict('That auction has ended.');
  if (a.sellerId === company.id) throw badRequest('You can not bid on your own auction.');
  if (a.topBidderId === company.id) throw conflict('You already have the top bid.');
  const min = minNextBid(a.startPrice, a.topBid);
  if (amount < min) throw badRequest(`Bid at least ${min} BT.`);
  await pay(db, W.company(company.id), W.escrow, amount, 'auction.bid', `Bid on ${lot(a)}`, account.id);
  if (a.topBidderId && a.topBid) {
    await pay(db, W.escrow, W.company(a.topBidderId), a.topBid, 'auction.refund', `Outbid on ${lot(a)}`);
    await notify(db, { companyId: a.topBidderId }, 'auction', `🔨 You were outbid on ${lot(a)}`, `New top bid: ${amount} BT. Your ${a.topBid} BT is back.`);
  }
  const endsAt = a.endsAt - now < SNIPE ? now + SNIPE : a.endsAt;
  await db.update(schema.auctions).set({ topBid: amount, topBidderId: company.id, bids: a.bids + 1, endsAt }).where(eq(schema.auctions.id, id));
  await hint(db, topics.all, { t: 'auctions' });
  return { ok: true, endsAt, extended: endsAt !== a.endsAt };
}

export async function cancel(db: Db, actor: Account, company: Company | null, id: string) {
  const a = (await db.select().from(schema.auctions).where(eq(schema.auctions.id, id)).for('update'))[0];
  if (!a || a.status !== 'open') throw conflict('That auction has ended.');
  if (company ? a.sellerId !== company.id : actor.role !== 'OWNER') throw forbidden('Not your auction.');
  if (a.topBid) throw conflict('Someone already bid. The auction has to run to the end.');
  if (a.sellerId) await addItem(db, a.sellerId, a.item, a.qty);
  await db.update(schema.auctions).set({ status: 'cancelled' }).where(eq(schema.auctions.id, id));
  await hint(db, topics.all, { t: 'auctions' });
  return { ok: true };
}

export async function list(db: Db, companyId: string | null) {
  const now = clock.now();
  const rows = await db
    .select()
    .from(schema.auctions)
    .where(or(and(eq(schema.auctions.status, 'open'), sql`${schema.auctions.endsAt} > ${now}`), sql`${schema.auctions.endsAt} > ${now - 24 * GAME_HOUR}`))
    .orderBy(asc(schema.auctions.status), desc(schema.auctions.createdAt))
    .limit(60);
  const cos = await db.select({ id: schema.companies.id, name: schema.companies.name, emoji: schema.companies.emoji }).from(schema.companies);
  const co = (id: string | null) => (id ? (cos.find((c) => c.id === id) ?? null) : null);
  return rows.map((r) => ({ ...r, seller: co(r.sellerId), topBidder: co(r.topBidderId), minBid: minNextBid(r.startPrice, r.topBid), mine: r.sellerId === companyId, leading: !!companyId && r.topBidderId === companyId }));
}

export async function sweepAuctions(db: Db, now: number) {
  for (const a of await db.select().from(schema.auctions).where(and(eq(schema.auctions.status, 'open'), lt(schema.auctions.endsAt, now)))) {
    if (!a.topBid || !a.topBidderId) {
      if (a.sellerId) await addItem(db, a.sellerId, a.item, a.qty);
      await db.update(schema.auctions).set({ status: 'unsold' }).where(eq(schema.auctions.id, a.id));
      if (a.sellerId) await notify(db, { companyId: a.sellerId }, 'auction', `🔨 No bids on ${lot(a)}`, 'Your goods are back in your warehouse.');
      continue;
    }
    await addItem(db, a.topBidderId, a.item, a.qty);
    let tax = 0;
    if (a.sellerId) {
      tax = await taxFor(db, a.sellerId, a.topBidderId, a.topBid);
      await post(db, 'sale.auction', [
        { from: W.escrow, to: W.company(a.sellerId), amount: a.topBid - tax },
        { from: W.escrow, to: W.treasury, amount: tax },
      ], { memo: `Auction: ${lot(a)}` });
      await notify(db, { companyId: a.sellerId }, 'auction', `🔨 Sold! ${lot(a)} for ${a.topBid} BT`, `You get ${a.topBid - tax} BT after tax.`);
    } else {
      await pay(db, W.escrow, W.treasury, a.topBid, 'auction.owner', `Owner auction: ${lot(a)}`);
    }
    await db.insert(schema.trades).values({ id: newId('trd', 12), item: a.item, price: Math.max(1, Math.round(a.topBid / a.qty)), qty: a.qty, buyerId: a.topBidderId, sellerId: a.sellerId ?? 'owner', tax, venue: 'auction', createdAt: now });
    await db.update(schema.auctions).set({ status: 'sold' }).where(eq(schema.auctions.id, a.id));
    await notify(db, { companyId: a.topBidderId }, 'auction', `🏆 You won ${lot(a)}`, `${a.topBid} BT. The goods are in your warehouse.`);
    const w = (await db.select().from(schema.companies).where(eq(schema.companies.id, a.topBidderId)))[0];
    await addNews(db, 'auction', `🔨 ${w?.emoji ?? ''} ${w?.name ?? 'Someone'} won ${lot(a)} for ${a.topBid} BT`, '', a.topBidderId);
  }
}
