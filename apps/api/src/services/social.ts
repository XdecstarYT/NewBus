/** Chat (global, company, union, direct messages) and leaderboards. */
import { and, desc, eq, gt, lt, sql } from 'drizzle-orm';
import { ITEMS, type ItemId } from '@dw/shared/live';
import { schema, type Db } from '../db';
import { bumpQuest } from './progress';
import { estateValues } from './estate';
import type { Account, Company } from '../http/router';
import { clock, MINUTE } from '../lib/time';
import { badRequest, forbidden } from '../lib/errors';
import { hint, topics } from './core';
import { lastPrices } from './market';
import { membership } from './unions';

/** Channels: global, co:<id>, union:<id>, dm:<accountA>:<accountB> (ids sorted). */
async function canUse(db: Db, account: Account, company: Company | null, channel: string) {
  if (channel === 'global') return true;
  if (account.role === 'OWNER' && !channel.startsWith('dm:')) return true;
  if (channel.startsWith('co:')) return company?.id === channel.slice(3);
  if (channel.startsWith('union:')) {
    if (!company) return false;
    return (await membership(db, company.id))?.unionId === channel.slice(6);
  }
  if (channel.startsWith('dm:')) return channel.split(':').slice(1).includes(account.id);
  return false;
}

export const dmChannel = (a: string, b: string) => `dm:${[a, b].sort().join(':')}`;

async function ping(db: Db, channel: string) {
  if (channel === 'global') return hint(db, topics.all, { t: 'chat', ch: channel });
  if (channel.startsWith('co:')) return hint(db, topics.company(channel.slice(3)), { t: 'chat', ch: channel });
  if (channel.startsWith('union:')) {
    const ms = await db.select({ c: schema.unionMembers.companyId }).from(schema.unionMembers).where(eq(schema.unionMembers.unionId, channel.slice(6)));
    for (const m of ms) await hint(db, topics.company(m.c), { t: 'chat', ch: channel });
    return;
  }
  for (const id of channel.split(':').slice(1)) await hint(db, topics.account(id), { t: 'chat', ch: channel });
}

export async function send(db: Db, account: Account, company: Company | null, channel: string, text: string) {
  if (!(await canUse(db, account, company, channel))) throw forbidden('You can not post there.');
  if (account.mutedUntil && account.mutedUntil > clock.now()) throw forbidden(`You are muted for ${Math.ceil((account.mutedUntil - clock.now()) / MINUTE)} more min.`, 'muted');
  const t = text.trim().slice(0, 400);
  if (!t) throw badRequest('Say something!');
  const recent = await db.$count(schema.chat, and(eq(schema.chat.accountId, account.id), gt(schema.chat.createdAt, clock.now() - MINUTE)));
  if (recent >= 10) throw forbidden('Slow down! 10 messages a minute.', 'rate_limited');
  const name = company ? `${company.emoji} ${account.name} (${company.name})` : account.role === 'OWNER' ? `👑 ${account.name}` : account.name;
  const row = (await db.insert(schema.chat).values({ channel, accountId: account.id, companyId: company?.id ?? null, name, text: t, createdAt: clock.now() }).returning())[0];
  await ping(db, channel);
  await bumpQuest(db, account.id, 'chat');
  return row;
}

export async function history(db: Db, account: Account, company: Company | null, channel: string, before?: number) {
  if (!(await canUse(db, account, company, channel))) throw forbidden('You can not read that channel.');
  const rows = await db
    .select()
    .from(schema.chat)
    .where(and(eq(schema.chat.channel, channel), eq(schema.chat.deleted, false), before ? lt(schema.chat.id, before) : undefined))
    .orderBy(desc(schema.chat.id))
    .limit(80);
  return rows.reverse();
}

/** The channels this player can see, including DM threads they are in. */
export async function channels(db: Db, account: Account, company: Company | null) {
  const out: Array<{ id: string; label: string }> = [{ id: 'global', label: '🌍 Everyone' }];
  if (company) out.push({ id: `co:${company.id}`, label: `${company.emoji} ${company.name}` });
  const m = company ? await membership(db, company.id) : null;
  if (m) {
    const u = (await db.select().from(schema.unions).where(eq(schema.unions.id, m.unionId)))[0];
    if (u) out.push({ id: `union:${u.id}`, label: `${u.emoji} ${u.name}` });
  }
  const dms = await db
    .selectDistinct({ channel: schema.chat.channel })
    .from(schema.chat)
    .where(and(sql`${schema.chat.channel} like 'dm:%'`, sql`${schema.chat.channel} like ${`%${account.id}%`}`));
  for (const d of dms) {
    const other = d.channel.split(':').slice(1).find((x) => x !== account.id);
    const a = other ? (await db.select({ name: schema.accounts.name }).from(schema.accounts).where(eq(schema.accounts.id, other)))[0] : null;
    out.push({ id: d.channel, label: `✉️ ${a?.name ?? '?'}` });
  }
  return out;
}

/** Everyone you can DM: every active login with its company. */
export async function people(db: Db) {
  return db
    .select({ id: schema.accounts.id, name: schema.accounts.name, role: schema.accounts.role, company: schema.companies.name, emoji: schema.companies.emoji })
    .from(schema.accounts)
    .leftJoin(schema.companies, eq(schema.companies.id, schema.accounts.companyId))
    .where(eq(schema.accounts.status, 'active'));
}

// ------------------------------------------------------------ leaderboards
/** Net worth = Bits + stock valued at the last traded price (or the reference price). */
export async function leaderboard(db: Db) {
  const cos = await db.select().from(schema.companies).where(eq(schema.companies.status, 'active'));
  const wallets = await db.select().from(schema.wallets).where(sql`${schema.wallets.id} like 'co:%'`);
  const inv = await db.select().from(schema.inventory).where(gt(schema.inventory.qty, 0));
  const prices = await lastPrices(db);
  const estate = await estateValues(db);
  const value = (item: string) => prices[item] ?? ITEMS[item as ItemId]?.basePrice ?? 0;
  return cos
    .map((c) => {
      const bits = wallets.find((w) => w.id === `co:${c.id}`)?.balance ?? 0;
      const stock = inv.filter((i) => i.companyId === c.id).reduce((s, i) => s + i.qty * value(i.item), 0);
      const property = estate[c.id] ?? 0;
      return { id: c.id, name: c.name, emoji: c.emoji, color: c.color, bits, stock, property, netWorth: bits + stock + property, prestige: c.prestige, xp: c.xp };
    })
    .sort((a, b) => b.netWorth - a.netWorth);
}
