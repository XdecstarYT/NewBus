/**
 * Real estate: land plots in the 3D town. Unowned land is bought from the Town
 * (the Treasury); owned plots can be put up for sale to other players, house
 * included. Building places real items as blocks; removing a block gives it back.
 */
import { asc, eq, sql } from 'drizzle-orm';
import { BLOCKS, ITEMS, MAX_OPS, WORLD, blockKey, blockType, buildingValue, inPlot, landPrice, plotId, supported, type Block, type ItemId } from '@dw/shared/live';
import { schema, type Db } from '../db';
import type { Account, Company } from '../http/router';
import { clock } from '../lib/time';
import { newId } from '../lib/ids';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { addNews, assertAllowed, audit, getSettings, hint, notify, topics } from './core';
import { pay, post, W } from './money';
import { addItem, takeItem } from './stock';
import { lastPrices, taxFor } from './market';
import { addXp } from './progress';

const MAX_PLOTS = 6;

/** Create the town's plots the first time anyone looks. */
async function ensurePlots(db: Db) {
  const n = (await db.select({ n: sql<number>`count(*)::int` }).from(schema.plots))[0].n;
  if (n >= WORLD * WORLD) return;
  const now = clock.now();
  const rows = [];
  for (let gx = 0; gx < WORLD; gx++) for (let gy = 0; gy < WORLD; gy++) rows.push({ id: plotId(gx, gy), gx, gy, blocks: [] as Block[], updatedAt: now });
  await db.insert(schema.plots).values(rows).onConflictDoNothing();
}

async function priceFn(db: Db) {
  const last = await lastPrices(db);
  return (item: string) => last[item] ?? ITEMS[item as ItemId]?.basePrice ?? 0;
}

export async function world(db: Db, viewer: Company | null) {
  await ensurePlots(db);
  const s = await getSettings(db);
  const price = await priceFn(db);
  const plots = await db.select().from(schema.plots).orderBy(asc(schema.plots.gx), asc(schema.plots.gy));
  const cos = await db.select({ id: schema.companies.id, name: schema.companies.name, emoji: schema.companies.emoji, color: schema.companies.color }).from(schema.companies);
  return {
    plots: plots.map((p) => {
      const land = landPrice(p.gx, p.gy, s.landPrice);
      return { ...p, owner: cos.find((c) => c.id === p.ownerId) ?? null, mine: !!viewer && p.ownerId === viewer.id, land, value: land + buildingValue(p.blocks, price) };
    }),
    landBase: s.landPrice,
  };
}

/** Value of every company's land and houses (for the leaderboard). */
export async function estateValues(db: Db) {
  const s = await getSettings(db);
  const price = await priceFn(db);
  const out: Record<string, number> = {};
  for (const p of await db.select().from(schema.plots).where(sql`${schema.plots.ownerId} is not null`)) out[p.ownerId!] = (out[p.ownerId!] ?? 0) + landPrice(p.gx, p.gy, s.landPrice) + buildingValue(p.blocks, price);
  return out;
}

async function load(db: Db, id: string) {
  await ensurePlots(db);
  const p = (await db.select().from(schema.plots).where(eq(schema.plots.id, id)).for('update'))[0];
  if (!p) throw notFound('No such plot.');
  return p;
}

/** Buy empty land from the Town, or a plot another player has up for sale. */
export async function buy(db: Db, account: Account, company: Company, id: string) {
  await assertAllowed(db, company.id, 'build');
  const p = await load(db, id);
  if (p.ownerId === company.id) throw conflict('You already own this plot.');
  const mine = (await db.select({ n: sql<number>`count(*)::int` }).from(schema.plots).where(eq(schema.plots.ownerId, company.id)))[0].n;
  if (mine >= MAX_PLOTS) throw conflict(`A company can own up to ${MAX_PLOTS} plots.`);
  const now = clock.now();
  let paid: number;
  if (!p.ownerId) {
    paid = landPrice(p.gx, p.gy, (await getSettings(db)).landPrice);
    await pay(db, W.company(company.id), W.treasury, paid, 'estate.land', `Land plot ${p.gx + 1}-${p.gy + 1}`, account.id);
  } else {
    if (!p.forSale || !p.askPrice) throw conflict('That plot is not for sale.');
    paid = p.askPrice;
    const seller = p.ownerId;
    const tax = await taxFor(db, seller, company.id, paid);
    await post(db, 'sale.estate', [
      { from: W.company(company.id), to: W.company(seller), amount: paid - tax },
      { from: W.company(company.id), to: W.treasury, amount: tax },
    ], { memo: `Plot ${p.gx + 1}-${p.gy + 1}${p.blocks.length ? ' with house' : ''}`, actorId: account.id });
    await db.insert(schema.trades).values({ id: newId('trd', 12), item: 'plot', price: paid, qty: 1, buyerId: company.id, sellerId: seller, tax, venue: 'estate', createdAt: now });
    await notify(db, { companyId: seller }, 'estate', `🏡 Sold! Your plot went for ${paid} BT`, `${company.emoji} ${company.name} bought it. You get ${paid - tax} BT after tax.`);
    if (paid >= 3000) await addNews(db, 'estate', `🏡 ${company.emoji} ${company.name} bought a property for ${paid} BT`, p.name ? `"${p.name}"` : '', company.id);
  }
  await db.update(schema.plots).set({ ownerId: company.id, forSale: false, askPrice: null, boughtFor: paid, boughtAt: now, updatedAt: now }).where(eq(schema.plots.id, id));
  await hint(db, topics.all, { t: 'world' });
  return { paid };
}

export async function setSale(db: Db, company: Company, id: string, price: number | null) {
  const p = await load(db, id);
  if (p.ownerId !== company.id) throw forbidden('Not your plot.');
  await db.update(schema.plots).set({ forSale: price !== null, askPrice: price, updatedAt: clock.now() }).where(eq(schema.plots.id, id));
  if (price !== null) await addNews(db, 'estate', `🪧 For sale: ${p.name ? `"${p.name}"` : `plot ${p.gx + 1}-${p.gy + 1}`}${p.blocks.length ? ' with a house' : ''} for ${price} BT`, '', company.id);
  await hint(db, topics.all, { t: 'world' });
  return { ok: true };
}

export async function rename(db: Db, company: Company, id: string, name: string) {
  const p = await load(db, id);
  if (p.ownerId !== company.id) throw forbidden('Not your plot.');
  await db.update(schema.plots).set({ name: name.trim().slice(0, 40), updatedAt: clock.now() }).where(eq(schema.plots.id, id));
  await hint(db, topics.all, { t: 'world' });
  return { ok: true };
}

export interface BuildOp {
  op: 'add' | 'remove';
  x: number;
  y: number;
  z: number;
  b?: number;
}

/**
 * Apply a batch of block edits in order. Added blocks use up items from the
 * warehouse, removed ones go back; only the difference is moved, all or nothing.
 */
export async function build(db: Db, account: Account, company: Company, id: string, ops: BuildOp[]) {
  await assertAllowed(db, company.id, 'build');
  if (ops.length > MAX_OPS) throw badRequest(`Up to ${MAX_OPS} changes at a time.`);
  const p = await load(db, id);
  if (p.ownerId !== company.id) throw forbidden('You can only build on your own plots.');
  const map = new Map<string, Block>(p.blocks.map((b) => [blockKey(b[0], b[1], b[2]), b]));
  const net: Record<string, number> = {};
  let added = 0;
  for (const o of ops) {
    if (!inPlot(o.x, o.y, o.z)) throw badRequest('That block is outside your plot.');
    const k = blockKey(o.x, o.y, o.z);
    if (o.op === 'add') {
      const t = blockType(o.b ?? 0);
      if (!t) throw badRequest('Unknown block.');
      if (map.has(k)) continue;
      const keys = new Set(map.keys());
      if (!supported(keys, o.x, o.y, o.z)) throw badRequest('Blocks need something to rest on: the ground or another block.');
      map.set(k, [o.x, o.y, o.z, t.id]);
      net[t.item] = (net[t.item] ?? 0) + 1;
      added++;
    } else {
      const old = map.get(k);
      if (!old) continue;
      map.delete(k);
      const t = blockType(old[3]);
      if (t) net[t.item] = (net[t.item] ?? 0) - 1;
    }
  }
  for (const [item, n] of Object.entries(net)) {
    if (n > 0) await takeItem(db, company.id, item, n);
    else if (n < 0) await addItem(db, company.id, item, -n);
  }
  const blocks = [...map.values()];
  await db.update(schema.plots).set({ blocks, updatedAt: clock.now() }).where(eq(schema.plots.id, id));
  if (added) await addXp(db, account.id, Math.ceil(added / 4));
  await hint(db, topics.all, { t: 'world' });
  await hint(db, topics.company(company.id), { t: 'stock' });
  return { blocks: blocks.length, used: net };
}

/** Owner: take a plot back (the house stays on it). */
export async function reclaim(db: Db, actor: Account, id: string) {
  const p = await load(db, id);
  if (!p.ownerId) return { ok: true };
  await db.update(schema.plots).set({ ownerId: null, forSale: false, askPrice: null, updatedAt: clock.now() }).where(eq(schema.plots.id, id));
  await notify(db, { companyId: p.ownerId }, 'estate', `🏛️ The Owner took back your plot ${p.gx + 1}-${p.gy + 1}`, '');
  await audit(db, actor.id, 'estate.reclaim', id);
  await hint(db, topics.all, { t: 'world' });
  return { ok: true };
}

/** The items that can be built with. */
export const BLOCK_ITEMS = [...new Set(BLOCKS.map((b) => b.item))];
