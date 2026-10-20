import { z } from 'zod';
import { and, desc, eq, or } from 'drizzle-orm';
import { ITEM_IDS } from '@dw/shared/live';
import { schema } from '../db';
import { parse, route } from '../http/router';
import { tx } from '../http/tx';
import { forbidden } from '../lib/errors';
import * as accounts from '../services/accounts';
import * as prod from '../services/production';
import * as market from '../services/market';
import * as shop from '../services/shop';
import { energyNow, energyStats } from '../services/energy';
import { inventoryOf } from '../services/stock';
import { balance, W } from '../services/money';
import { activeSanctions, hint, topics } from '../services/core';

const id = z.string().min(1).max(80);
const item = z.enum(ITEM_IDS);
const qty = z.number().int().min(1).max(100_000);
const lines = z.array(z.object({ item, qty })).min(1).max(30);

// ------------------------------------------------------------ home / office
route('GET', '/game/home', 'company', async (c) => {
  const stats = await energyStats(c.db, c.company);
  return {
    company: { ...c.company, level: prod.companyLevel(c.company.xp) },
    balance: await balance(c.db, W.company(c.company.id)),
    inventory: await inventoryOf(c.db, c.company.id),
    facilities: await prod.facilitiesOf(c.db, c.company.id),
    energy: { now: Math.floor(energyNow(c.account, stats)), ...stats },
    sanctions: await activeSanctions(c.db, c.company.id),
    team: await accounts.teamOf(c.db, c.company.id),
  };
});

route('POST', '/game/work', 'company', async (c) => {
  const v = parse(z.object({ facility: id, recipe: id, batches: z.number().int().min(1).max(50), useTools: z.boolean().default(true) }), c.body);
  return tx(c, (db) => prod.work(db, c.account, c.company, v));
});
route('POST', '/game/eat', 'company', async (c) => {
  const v = parse(z.object({ item, qty: z.number().int().min(1).max(20).default(1) }), c.body);
  return tx(c, (db) => prod.eat(db, c.account, c.company, v.item, v.qty));
});
route('POST', '/game/install', 'company', async (c) => {
  const v = parse(z.object({ item, qty: z.number().int().min(1).max(100).default(1) }), c.body);
  return tx(c, (db) => prod.install(db, c.company, v.item, v.qty));
});
route('POST', '/game/build', 'company', async (c) => {
  const v = parse(z.object({ facility: id }), c.body);
  return tx(c, (db) => prod.build(db, c.account, c.company, v.facility));
});
route('POST', '/game/upgrade', 'company', async (c) => {
  const v = parse(z.object({ facility: id }), c.body);
  return tx(c, (db) => prod.upgrade(db, c.account, c.company, v.facility));
});

// ------------------------------------------------------------ company + team
route('PATCH', '/game/company', 'company', async (c) => {
  if (c.account.role !== 'ADMIN') throw forbidden('Only the company admin can change this.');
  const v = parse(z.object({ slogan: z.string().max(120).optional(), emoji: z.string().min(1).max(8).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }), c.body);
  await c.db.update(schema.companies).set(v).where(eq(schema.companies.id, c.company.id));
  return { ok: true };
});
route('GET', '/game/team', 'company', async (c) => accounts.teamOf(c.db, c.company.id));
route('POST', '/game/team', 'company', async (c) => {
  const v = parse(z.object({ name: z.string().min(1).max(40) }), c.body);
  return tx(c, (db) => accounts.addStaff(db, c.company.id, c.account, v.name));
});
route('POST', '/game/team/:id/status', 'company', async (c) => {
  const v = parse(z.object({ active: z.boolean() }), c.body);
  await accounts.setStaffStatus(c.db, c.company.id, c.account, c.params.id, v.active);
  return { ok: true };
});
route('POST', '/game/team/:id/reset', 'company', async (c) => {
  if (c.account.role !== 'ADMIN') throw forbidden('Only the company admin can reset passwords.');
  const t = await accounts.teamOf(c.db, c.company.id);
  if (!t.find((x) => x.id === c.params.id)) throw forbidden('Not in your company.');
  return { password: await accounts.resetPassword(c.db, c.params.id, c.account.id) };
});

// ------------------------------------------------------------ market
route('GET', '/game/market', 'company', async (c) => ({ items: await market.overview(c.db), mine: await market.myOrders(c.db, c.company.id) }));
route('GET', '/game/market/:item', 'company', async (c) => market.book(c.db, c.params.item, c.company.id));
route('POST', '/game/orders', 'company', async (c) => {
  const v = parse(z.object({ item, side: z.enum(['buy', 'sell']), price: z.number().int().min(1).max(1_000_000), qty }), c.body);
  return tx(c, (db) => market.placeOrder(db, c.account, c.company, v));
});
route('POST', '/game/orders/:id/cancel', 'company', async (c) => tx(c, (db) => market.cancelOrder(db, c.company, c.params.id)));

// ------------------------------------------------------------ shops, pickups, POS
route('GET', '/game/shop', 'company', async (c) => ({
  listings: await shop.listingsOf(c.db, c.company.id),
  inventory: await inventoryOf(c.db, c.company.id),
  pickups: await shop.pickupsFor(c.db, c.company.id, 'seller'),
  sales: await shop.recentSales(c.db, c.company.id),
}));
route('POST', '/game/shop/listing', 'company', async (c) => {
  const v = parse(z.object({ item, price: z.number().int().min(1).max(1_000_000), active: z.boolean().default(true) }), c.body);
  return shop.setListing(c.db, c.company, v.item, v.price, v.active);
});
route('GET', '/game/shops', 'company', async (c) => shop.directory(c.db, c.company.id));
route('GET', '/game/shops/:id', 'company', async (c) => shop.storefront(c.db, c.params.id));
route('POST', '/game/shops/:id/buy', 'company', async (c) => {
  const v = parse(z.object({ lines }), c.body);
  return tx(c, (db) => shop.buyNow(db, c.account, c.company, c.params.id, v.lines));
});
route('POST', '/game/shops/:id/pickup', 'company', async (c) => {
  const v = parse(z.object({ lines, note: z.string().max(200).default('') }), c.body);
  return tx(c, (db) => shop.orderPickup(db, c.account, c.company, c.params.id, v.lines, v.note));
});
route('GET', '/game/pickups', 'company', async (c) => shop.pickupsFor(c.db, c.company.id, 'buyer'));
route('GET', '/game/pickups/find/:code', 'company', async (c) => shop.findPickup(c.db, c.company, c.params.code));
route('POST', '/game/pickups/:id/ready', 'company', async (c) => tx(c, (db) => shop.markReady(db, c.company, c.params.id)));
route('POST', '/game/pickups/:id/pay', 'company', async (c) => tx(c, (db) => shop.startPickupPayment(db, c.account, c.company, c.params.id)));
route('POST', '/game/pickups/:id/cancel', 'company', async (c) => tx(c, (db) => shop.cancelPickup(db, c.company, c.params.id)));
route('POST', '/game/pos', 'company', async (c) => {
  const v = parse(z.object({ lines: z.array(z.object({ item, qty, price: z.number().int().min(1).max(1_000_000).optional() })).min(1).max(30) }), c.body);
  return tx(c, (db) => shop.ringUp(db, c.account, c.company, v.lines));
});
route('POST', '/game/pos/:id/cancel', 'company', async (c) => shop.cancelCheckout(c.db, c.company, c.params.id));
route('GET', '/game/pay/:code', 'company', async (c) => shop.viewCheckout(c.db, c.params.code));
route('POST', '/game/pay/:code', 'company', async (c) => tx(c, (db) => shop.payCheckout(db, c.account, c.company, c.params.code)));

// ------------------------------------------------------------ transfers
route('POST', '/game/send/bits', 'company', async (c) => {
  const v = parse(z.object({ to: id, amount: z.number().int().min(1).max(100_000_000), memo: z.string().max(120).default('') }), c.body);
  return tx(c, (db) => shop.sendBits(db, c.account, c.company, v.to, v.amount, v.memo));
});
route('POST', '/game/send/items', 'company', async (c) => {
  const v = parse(z.object({ to: id, item, qty, memo: z.string().max(120).default('') }), c.body);
  return tx(c, (db) => shop.sendItems(db, c.account, c.company, v.to, v.item, v.qty, v.memo));
});
route('GET', '/game/companies', 'user', async (c) =>
  c.db.select({ id: schema.companies.id, name: schema.companies.name, emoji: schema.companies.emoji, color: schema.companies.color }).from(schema.companies).where(eq(schema.companies.status, 'active')),
);

// ------------------------------------------------------------ notifications + news
route('GET', '/game/notifications', 'user', async (c) => {
  const mine = c.company ? or(eq(schema.notifications.companyId, c.company.id), eq(schema.notifications.accountId, c.account.id)) : eq(schema.notifications.accountId, c.account.id);
  return c.db.select().from(schema.notifications).where(mine).orderBy(desc(schema.notifications.createdAt)).limit(50);
});
route('POST', '/game/notifications/read', 'user', async (c) => {
  const mine = c.company ? or(eq(schema.notifications.companyId, c.company.id), eq(schema.notifications.accountId, c.account.id)) : eq(schema.notifications.accountId, c.account.id);
  await c.db.update(schema.notifications).set({ read: true }).where(and(mine, eq(schema.notifications.read, false)));
  if (c.company) await hint(c.db, topics.company(c.company.id), { t: 'notify' });
  return { ok: true };
});
route('GET', '/game/news', 'user', async (c) => c.db.select().from(schema.news).orderBy(desc(schema.news.createdAt)).limit(60));

// a company card for anyone (profiles, pickers)
route('GET', '/game/companies/:id', 'user', async (c) => {
  const r = await c.db.select().from(schema.companies).where(eq(schema.companies.id, c.params.id));
  if (!r[0]) throw forbidden('No such company.');
  const facs = await prod.facilitiesOf(c.db, r[0].id);
  const team = await c.db.select({ name: schema.accounts.name, role: schema.accounts.role }).from(schema.accounts).where(and(eq(schema.accounts.companyId, r[0].id), eq(schema.accounts.status, 'active')));
  const { toolUses: _t, ...pub } = r[0];
  return { ...pub, level: prod.companyLevel(r[0].xp), facilities: facs.map((f) => ({ type: f.type, level: f.level })), team };
});

