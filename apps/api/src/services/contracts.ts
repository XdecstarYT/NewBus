/**
 * Supply contracts between players: "deliver 50 steel by tomorrow for 900 BT".
 * The buyer's money waits in the Contracts wallet. Delivering pays the seller
 * (minus sales tax); missing the deadline refunds the buyer, who can then sue.
 */
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { ITEMS, isItem, type ItemId } from '@dw/shared/live';
import { schema, type Db } from '../db';
import type { Account, Company } from '../http/router';
import { clock, HOUR } from '../lib/time';
import { newId } from '../lib/ids';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { addNews, assertAllowed, hint, notify, topics } from './core';
import { pay, post, W } from './money';
import { addItem, takeItem } from './stock';
import { taxFor } from './market';
import { bumpQuest } from './progress';

const label = (c: { qty: number; item: string }) => `${c.qty}× ${ITEMS[c.item as ItemId]?.emoji ?? ''} ${ITEMS[c.item as ItemId]?.name ?? c.item}`;

export interface NewContract {
  item: string;
  qty: number;
  price: number;
  note: string;
  offeredTo?: string | null;
  acceptHours: number;
  deliverHours: number;
}

export async function create(db: Db, account: Account, buyer: Company, o: NewContract) {
  await assertAllowed(db, buyer.id, 'market');
  if (!isItem(o.item)) throw badRequest('Unknown item.');
  if (o.offeredTo === buyer.id) throw badRequest('You can not offer a contract to yourself.');
  if (o.offeredTo) {
    const t = await db.select({ id: schema.companies.id }).from(schema.companies).where(and(eq(schema.companies.id, o.offeredTo), eq(schema.companies.status, 'active')));
    if (!t.length) throw notFound('No such company.');
  }
  const open = await db.select({ n: sql<number>`count(*)::int` }).from(schema.contracts).where(and(eq(schema.contracts.buyerId, buyer.id), sql`${schema.contracts.status} in ('open','accepted')`));
  if (open[0].n >= 20) throw conflict('You can have up to 20 running contracts.');
  const now = clock.now();
  const id = newId('ctr', 12);
  await pay(db, W.company(buyer.id), W.contracts, o.price, 'contract.escrow', `Contract: ${label(o)}`, account.id);
  await db.insert(schema.contracts).values({
    id,
    buyerId: buyer.id,
    sellerId: null,
    offeredTo: o.offeredTo ?? null,
    item: o.item,
    qty: o.qty,
    price: o.price,
    note: o.note,
    status: 'open',
    createdAt: now,
    acceptBy: now + o.acceptHours * HOUR,
    deliverBy: now + (o.acceptHours + o.deliverHours) * HOUR,
  });
  if (o.offeredTo) await notify(db, { companyId: o.offeredTo }, 'contract', `📝 ${buyer.emoji} ${buyer.name} offers you a contract`, `${label(o)} for ${o.price} BT.`);
  await hint(db, topics.all, { t: 'contracts' });
  return { id };
}

async function load(db: Db, id: string) {
  const c = (await db.select().from(schema.contracts).where(eq(schema.contracts.id, id)).for('update'))[0];
  if (!c) throw notFound('No such contract.');
  return c;
}

export async function accept(db: Db, seller: Company, id: string) {
  await assertAllowed(db, seller.id, 'market');
  const c = await load(db, id);
  if (c.status !== 'open' || c.acceptBy <= clock.now()) throw conflict('That contract is no longer open.');
  if (c.buyerId === seller.id) throw badRequest('That is your own contract.');
  if (c.offeredTo && c.offeredTo !== seller.id) throw forbidden('That contract was offered to another company.');
  await db.update(schema.contracts).set({ status: 'accepted', sellerId: seller.id, acceptedAt: clock.now() }).where(eq(schema.contracts.id, id));
  await notify(db, { companyId: c.buyerId }, 'contract', `🤝 ${seller.emoji} ${seller.name} accepted your contract`, `${label(c)}: due ${new Date(c.deliverBy).toUTCString()}.`);
  await hint(db, topics.all, { t: 'contracts' });
  return { ok: true };
}

export async function deliver(db: Db, account: Account, seller: Company, id: string) {
  const c = await load(db, id);
  if (c.status !== 'accepted' || c.sellerId !== seller.id) throw conflict('Only the company that accepted this contract can deliver it.');
  if (c.deliverBy <= clock.now()) throw conflict('Too late: the delivery deadline has passed.');
  await takeItem(db, seller.id, c.item, c.qty);
  await addItem(db, c.buyerId, c.item, c.qty);
  const tax = await taxFor(db, seller.id, c.buyerId, c.price);
  await post(
    db,
    'sale.contract',
    [
      { from: W.contracts, to: W.company(seller.id), amount: c.price - tax },
      { from: W.contracts, to: W.treasury, amount: tax },
    ],
    { memo: `Contract: ${label(c)}`, actorId: account.id },
  );
  const now = clock.now();
  await db.insert(schema.trades).values({ id: newId('trd', 12), item: c.item, price: Math.max(1, Math.round(c.price / c.qty)), qty: c.qty, buyerId: c.buyerId, sellerId: seller.id, tax, venue: 'contract', createdAt: now });
  await db.update(schema.contracts).set({ status: 'delivered', doneAt: now }).where(eq(schema.contracts.id, id));
  await db.update(schema.companies).set({ prestige: sql`${schema.companies.prestige} + 2` }).where(eq(schema.companies.id, seller.id));
  await bumpQuest(db, account.id, 'contract');
  await notify(db, { companyId: c.buyerId }, 'contract', `📦 Contract delivered: ${label(c)}`, `${seller.emoji} ${seller.name} delivered on time.`);
  await hint(db, topics.company(seller.id), { t: 'stock' });
  await hint(db, topics.company(c.buyerId), { t: 'stock' });
  await hint(db, topics.all, { t: 'contracts' });
  return { paid: c.price - tax, tax };
}

export async function cancel(db: Db, buyer: Company, id: string) {
  const c = await load(db, id);
  if (c.buyerId !== buyer.id) throw forbidden('Not your contract.');
  if (c.status !== 'open') throw conflict('Only contracts nobody accepted yet can be cancelled.');
  await pay(db, W.contracts, W.company(buyer.id), c.price, 'contract.refund', `Cancelled: ${label(c)}`);
  await db.update(schema.contracts).set({ status: 'cancelled', doneAt: clock.now() }).where(eq(schema.contracts.id, id));
  await hint(db, topics.all, { t: 'contracts' });
  return { ok: true };
}

export async function list(db: Db, company: Company) {
  const now = clock.now();
  const rows = await db
    .select()
    .from(schema.contracts)
    .where(
      or(
        and(eq(schema.contracts.status, 'open'), sql`${schema.contracts.acceptBy} > ${now}`, sql`(${schema.contracts.offeredTo} is null or ${schema.contracts.offeredTo} = ${company.id})`),
        eq(schema.contracts.buyerId, company.id),
        eq(schema.contracts.sellerId, company.id),
      ),
    )
    .orderBy(desc(schema.contracts.createdAt))
    .limit(100);
  const cos = await db.select({ id: schema.companies.id, name: schema.companies.name, emoji: schema.companies.emoji }).from(schema.companies);
  const co = (id: string | null) => (id ? cos.find((c) => c.id === id) ?? null : null);
  return rows.map((r) => ({ ...r, buyer: co(r.buyerId), seller: co(r.sellerId), offeredToCo: co(r.offeredTo) }));
}

export async function sweepContracts(db: Db, now: number) {
  const stale = await db.select().from(schema.contracts).where(and(eq(schema.contracts.status, 'open'), lt(schema.contracts.acceptBy, now)));
  for (const c of stale) {
    await pay(db, W.contracts, W.company(c.buyerId), c.price, 'contract.refund', `Nobody took: ${label(c)}`);
    await db.update(schema.contracts).set({ status: 'expired', doneAt: now }).where(eq(schema.contracts.id, c.id));
    await notify(db, { companyId: c.buyerId }, 'contract', `⌛ Nobody took your contract: ${label(c)}`, 'Your money is back.');
  }
  const late = await db.select().from(schema.contracts).where(and(eq(schema.contracts.status, 'accepted'), lt(schema.contracts.deliverBy, now)));
  for (const c of late) {
    await pay(db, W.contracts, W.company(c.buyerId), c.price, 'contract.refund', `Not delivered: ${label(c)}`);
    await db.update(schema.contracts).set({ status: 'breached', doneAt: now }).where(eq(schema.contracts.id, c.id));
    await db.update(schema.companies).set({ prestige: sql`greatest(0, ${schema.companies.prestige} - 5)` }).where(eq(schema.companies.id, c.sellerId!));
    const s = (await db.select().from(schema.companies).where(eq(schema.companies.id, c.sellerId!)))[0];
    await notify(db, { companyId: c.buyerId }, 'contract', `💔 ${s?.name ?? 'The seller'} broke your contract`, 'Your money is back. You can take them to court for breach of contract.');
    await notify(db, { companyId: c.sellerId }, 'contract', `💔 You missed a contract deadline: ${label(c)}`, '-5 prestige. The buyer may sue you.');
    await addNews(db, 'contract', `💔 ${s?.emoji ?? ''} ${s?.name ?? 'A company'} broke a contract (${label(c)})`, '', c.sellerId);
  }
}
