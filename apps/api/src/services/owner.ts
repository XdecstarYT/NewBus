/** The Owner's powers: the Treasury, money tools, companies, moderation, reward codes, season reset. */
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { ITEMS, isItem, type ItemId } from '@dw/shared/live';
import { schema, type Db } from '../db';
import type { Account, Company } from '../http/router';
import { clock, DAY, HOUR } from '../lib/time';
import { shortCode } from '../lib/ids';
import { badRequest, conflict, notFound } from '../lib/errors';
import { addNews, audit, getSettings, notify } from './core';
import { balance, ledgerCheck, pay, payUpTo, W } from './money';
import { addItem, inventoryOf } from './stock';
import { facilitiesOf } from './production';
import { teamOf } from './accounts';
import { sanctionsList } from './justice';

export async function overview(db: Db) {
  const now = clock.now();
  const check = await ledgerCheck(db);
  const players24h = await db.$count(schema.accounts, gt(schema.accounts.lastSeen, now - DAY));
  const online = await db.$count(schema.accounts, gt(schema.accounts.lastSeen, now - 5 * 60_000));
  const trades24h = await db.select({ n: sql<number>`count(*)::int`, v: sql<number>`coalesce(sum(${schema.trades.qty} * ${schema.trades.price}),0)::int`, tax: sql<number>`coalesce(sum(${schema.trades.tax}),0)::int` }).from(schema.trades).where(gt(schema.trades.createdAt, now - DAY));
  const shifts24h = await db.select({ n: sql<number>`count(*)::int`, b: sql<number>`coalesce(sum(${schema.workLog.batches}),0)::int` }).from(schema.workLog).where(gt(schema.workLog.createdAt, now - DAY));
  return {
    moneySupply: check.supply,
    ledgerOk: check.sum === 0,
    treasury: await balance(db, W.treasury),
    escrow: await balance(db, W.escrow),
    companies: await db.$count(schema.companies),
    accounts: await db.$count(schema.accounts),
    players24h,
    online,
    trades24h: trades24h[0],
    shifts24h: shifts24h[0],
    settings: await getSettings(db),
  };
}

export async function companiesList(db: Db) {
  const cos = await db.select().from(schema.companies).orderBy(desc(schema.companies.createdAt));
  const out = [];
  for (const c of cos) {
    const team = await db.$count(schema.accounts, eq(schema.accounts.companyId, c.id));
    out.push({ ...c, balance: await balance(db, W.company(c.id)), team });
  }
  return out;
}

export async function companyDetail(db: Db, id: string) {
  const c = (await db.select().from(schema.companies).where(eq(schema.companies.id, id)))[0];
  if (!c) throw notFound('No such company.');
  return {
    ...c,
    balance: await balance(db, W.company(id)),
    inventory: await inventoryOf(db, id),
    facilities: await facilitiesOf(db, id),
    team: await teamOf(db, id),
    sanctions: await sanctionsList(db, id),
    ledger: await db.select().from(schema.ledger).where(sql`${schema.ledger.fromWallet} = ${W.company(id)} or ${schema.ledger.toWallet} = ${W.company(id)}`).orderBy(desc(schema.ledger.id)).limit(60),
  };
}

export async function setCompanyStatus(db: Db, actor: Account, id: string, status: 'active' | 'suspended') {
  await db.update(schema.companies).set({ status }).where(eq(schema.companies.id, id));
  if (status === 'suspended') {
    const accs = await db.select({ id: schema.accounts.id }).from(schema.accounts).where(eq(schema.accounts.companyId, id));
    for (const a of accs) await db.delete(schema.sessions).where(eq(schema.sessions.accountId, a.id));
  }
  await audit(db, actor.id, `company.${status}`, id);
  return { ok: true };
}

// ------------------------------------------------------------ money tools
/** Create new Bits (the only way money appears besides starting grants). */
export async function mint(db: Db, actor: Account, amount: number, toCompanyId: string | null, memo: string) {
  const amt = Math.floor(amount);
  if (amt < 1 || amt > 100_000_000) throw badRequest('Mint 1 to 100,000,000 BT.');
  await pay(db, W.mint, toCompanyId ? W.company(toCompanyId) : W.treasury, amt, 'owner.mint', memo || 'Minted by the Owner', actor.id);
  if (toCompanyId) await notify(db, { companyId: toCompanyId }, 'money', `💰 The Owner sent you ${amt} BT`, memo);
  await audit(db, actor.id, 'owner.mint', toCompanyId ?? 'treasury', { amount: amt, memo });
  return { ok: true };
}

/** Pay a company from the Treasury (prizes, grants, refunds). */
export async function grant(db: Db, actor: Account, companyId: string, amount: number, memo: string) {
  await pay(db, W.treasury, W.company(companyId), Math.floor(amount), 'owner.grant', memo || 'Grant from the Treasury', actor.id);
  await notify(db, { companyId }, 'money', `🎁 Treasury grant: ${Math.floor(amount)} BT`, memo);
  await audit(db, actor.id, 'owner.grant', companyId, { amount, memo });
  return { ok: true };
}

export async function fine(db: Db, actor: Account, companyId: string, amount: number, memo: string) {
  const taken = await payUpTo(db, W.company(companyId), W.treasury, amount, 'justice.fine', memo || 'Fine');
  await notify(db, { companyId }, 'justice', `🧾 Fined ${taken} BT by the Owner`, memo);
  await audit(db, actor.id, 'owner.fine', companyId, { amount: taken, memo });
  return { taken };
}

/** Destroy Treasury Bits (shrink the money supply). */
export async function burn(db: Db, actor: Account, amount: number) {
  await pay(db, W.treasury, W.mint, Math.floor(amount), 'owner.burn', 'Burned by the Owner', actor.id);
  await audit(db, actor.id, 'owner.burn', 'treasury', { amount });
  return { ok: true };
}

export async function ledgerList(db: Db, wallet?: string) {
  return db
    .select()
    .from(schema.ledger)
    .where(wallet ? sql`${schema.ledger.fromWallet} = ${wallet} or ${schema.ledger.toWallet} = ${wallet}` : undefined)
    .orderBy(desc(schema.ledger.id))
    .limit(200);
}

// ------------------------------------------------------------ moderation
export async function deleteMessage(db: Db, actor: Account, id: number) {
  await db.update(schema.chat).set({ deleted: true }).where(eq(schema.chat.id, id));
  await audit(db, actor.id, 'chat.delete', String(id));
  return { ok: true };
}

export async function mute(db: Db, actor: Account, accountId: string, hours: number) {
  await db.update(schema.accounts).set({ mutedUntil: hours > 0 ? clock.now() + hours * HOUR : null }).where(eq(schema.accounts.id, accountId));
  await audit(db, actor.id, 'chat.mute', accountId, { hours });
  return { ok: true };
}

// ------------------------------------------------------------ real-life reward codes (QR cards)
export async function createCodes(db: Db, actor: Account, o: { label: string; bits: number; items: Record<string, number>; uses: number; count: number }) {
  for (const k of Object.keys(o.items)) if (!isItem(k)) throw badRequest(`Unknown item ${k}.`);
  const codes: string[] = [];
  for (let i = 0; i < Math.max(1, Math.min(100, o.count)); i++) {
    const code = shortCode(8);
    await db.insert(schema.rewardCodes).values({ code, label: o.label.slice(0, 80) || 'Reward', bits: Math.max(0, Math.floor(o.bits)), items: o.items, usesLeft: Math.max(1, Math.floor(o.uses)), createdBy: actor.id, createdAt: clock.now() });
    codes.push(code);
  }
  await audit(db, actor.id, 'reward.create', null, { count: codes.length, bits: o.bits, items: o.items });
  return { codes };
}

export async function listCodes(db: Db) {
  return db.select().from(schema.rewardCodes).orderBy(desc(schema.rewardCodes.createdAt)).limit(200);
}

/** A player scans a QR card: Bits come out of the Treasury, items are a gift from the Owner. */
export async function redeem(db: Db, account: Account, company: Company, raw: string) {
  const code = String(raw).trim().toUpperCase().replace(/^.*\/REDEEM\//, '').replace(/[^A-Z0-9]/g, '');
  const r = (await db.select().from(schema.rewardCodes).where(eq(schema.rewardCodes.code, code)).for('update'))[0];
  if (!r) throw notFound('That code does not exist. Check the card!');
  if (r.usesLeft < 1) throw conflict('That card has already been used up.');
  if ((await db.select().from(schema.rewardRedemptions).where(and(eq(schema.rewardRedemptions.code, code), eq(schema.rewardRedemptions.companyId, company.id)))).length) throw conflict('Your company already redeemed this card.');
  if (r.bits) await pay(db, W.treasury, W.company(company.id), r.bits, 'reward.redeem', r.label, account.id);
  for (const [item, n] of Object.entries(r.items)) await addItem(db, company.id, item, n);
  await db.update(schema.rewardCodes).set({ usesLeft: r.usesLeft - 1 }).where(eq(schema.rewardCodes.code, code));
  await db.insert(schema.rewardRedemptions).values({ code, companyId: company.id, at: clock.now() });
  return { label: r.label, bits: r.bits, items: r.items, names: Object.keys(r.items).map((i) => `${ITEMS[i as ItemId].emoji} ${ITEMS[i as ItemId].name}`) };
}

// ------------------------------------------------------------ season reset
/** Wipe the economy and start everyone fresh (accounts, companies and unions stay). */
export async function seasonReset(db: Db, actor: Account) {
  const s = await getSettings(db);
  for (const t of [schema.inventory, schema.orders, schema.trades, schema.listings, schema.checkouts, schema.pickups, schema.ledger, schema.workLog, schema.wallets, schema.facilities, schema.sanctions, schema.rewardRedemptions, schema.jobs, schema.submissions, schema.customerOrders, schema.contracts, schema.quests, schema.ownerRequests, schema.loans, schema.auctions, schema.projects, schema.projectContribs, schema.plots]) await db.delete(t);
  await db.delete(schema.settings).where(sql`${schema.settings.key} in ('boosts', 'event', 'energyBoost', 'mayor')`);
  const cos = await db.select().from(schema.companies);
  const now = clock.now();
  for (const c of cos) {
    await db.update(schema.companies).set({ installs: {}, prestige: 0, xp: 0, toolUses: 0 }).where(eq(schema.companies.id, c.id));
    await db.insert(schema.facilities).values({ companyId: c.id, type: c.industry, level: 1, createdAt: now });
    if (s.startingGrant) await pay(db, W.mint, W.company(c.id), s.startingGrant, 'grant.start', 'New season starting grant');
    await addItem(db, c.id, 'bread', 6);
  }
  await db.update(schema.accounts).set({ energy: 100, energyAt: now, xp: 0 });
  await audit(db, actor.id, 'season.reset');
  await addNews(db, 'season', '🌅 A new season begins!', 'Every company starts fresh. May the best traders win.');
  return { ok: true, companies: cos.length };
}
