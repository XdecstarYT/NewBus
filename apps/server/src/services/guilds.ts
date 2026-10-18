/**
 * Guilds (alliances): create/join/leave, shared treasury (a ledger wallet with
 * owner-limited payouts), levels from deposits and quests, an income perk for
 * every member, a daily guild quest, parties (temporary income buffs) and
 * guild chat (channel guild:<id>).
 */
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db, schema, atomic, sqlite } from '../db';
import { clock, dayKey } from '../lib/time';
import { newId } from '../lib/ids';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { cfg } from './settings';
import { SYS, walletId, balanceOf, post } from './ledger';
import { chargeCompany, companyWallet, payCompany } from './money';
import { findCompany, getCompany } from './companies';
import { addModifier, registerMultiplier } from './multipliers';
import { addNews } from './news';
import { notify } from './notifications';
import { audit } from './audit';
import { bump, today } from './stats';
import { toCompany, bus } from '../lib/bus';

export type Guild = typeof schema.guilds.$inferSelect;

export const guildWallet = (guildId: string) => walletId('guild', guildId, 'main');

export function getGuild(id: string): Guild {
  const g = db.select().from(schema.guilds).where(eq(schema.guilds.id, id)).get();
  if (!g) throw notFound('No such guild.');
  return g;
}

export function guildIdOf(companyId: string): string | null {
  return db.select({ g: schema.guildMembers.guildId }).from(schema.guildMembers).where(eq(schema.guildMembers.companyId, companyId)).get()?.g ?? null;
}

function membership(companyId: string) {
  return db.select().from(schema.guildMembers).where(eq(schema.guildMembers.companyId, companyId)).get() ?? null;
}

function members(guildId: string) {
  return db.select().from(schema.guildMembers).where(eq(schema.guildMembers.guildId, guildId)).orderBy(asc(schema.guildMembers.joinedAt)).all();
}

function requireRank(companyId: string, guildId: string, ...roles: string[]) {
  const m = membership(companyId);
  if (!m || m.guildId !== guildId || !roles.includes(m.role)) throw forbidden('Only the guild leader (or officers) can do that.', 'guild_rank');
  return m;
}

function broadcastGuild(guildId: string, msg: Record<string, unknown>) {
  for (const m of members(guildId)) toCompany(m.companyId, msg);
}

// ------------------------------------------------------------ lifecycle
export function createGuild(companyId: string, input: { name: string; emoji: string; motto: string }, actorId: string) {
  return atomic(() => {
    if (membership(companyId)) throw conflict('Leave your current guild first.');
    const name = input.name.trim();
    if (name.length < 3) throw badRequest('Guild names need at least 3 letters.');
    if (db.select().from(schema.guilds).where(sql`lower(${schema.guilds.name}) = lower(${name})`).get()) throw conflict('That guild name is taken.');
    const c = cfg().guilds;
    chargeCompany({ companyId, amount: c.createCost, kind: 'guild.create', memo: `Founded ${name}`, actorId });
    const id = newId('gld');
    const now = clock.now();
    db.insert(schema.guilds).values({ id, name, emoji: input.emoji || '🛡️', motto: input.motto.slice(0, 120), leaderId: companyId, level: 1, xp: 0, open: true, createdAt: now }).run();
    db.insert(schema.guildMembers).values({ guildId: id, companyId, role: 'leader', joinedAt: now }).run();
    db.update(schema.companies).set({ guildId: id }).where(eq(schema.companies.id, companyId)).run();
    const co = getCompany(companyId);
    addNews('headline', `${input.emoji || '🛡️'} New guild "${name}" founded by ${co.name}!`, input.motto || 'Applications are open. Snacks provided.', companyId);
    audit({ actorId, action: 'guild.create', targetType: 'guild', targetId: id, newValue: { name } });
    return { id };
  });
}

export function joinGuild(companyId: string, guildId: string) {
  return atomic(() => {
    if (membership(companyId)) throw conflict('You are already in a guild.');
    const g = getGuild(guildId);
    if (!g.open) throw forbidden('This guild is invite-only right now.', 'guild_closed');
    if (members(guildId).length >= cfg().guilds.maxMembers) throw conflict('That guild is full.');
    db.insert(schema.guildMembers).values({ guildId, companyId, role: 'member', joinedAt: clock.now() }).run();
    db.update(schema.companies).set({ guildId }).where(eq(schema.companies.id, companyId)).run();
    const co = getCompany(companyId);
    broadcastGuild(guildId, { type: 'guild', event: 'joined', name: co.name });
    bus.publish(`chat:guild:${guildId}`, { type: 'chat', message: systemLine(`guild:${guildId}`, `${co.emoji} ${co.name} joined the guild! 🎉`) });
    return { ok: true };
  });
}

function systemLine(channel: string, text: string) {
  return { id: newId('msg'), channel, accountId: 'system', companyId: null, senderName: '🤖 Boss Byte', text, deleted: false, createdAt: clock.now() };
}

function removeMember(guildId: string, companyId: string) {
  db.delete(schema.guildMembers).where(and(eq(schema.guildMembers.guildId, guildId), eq(schema.guildMembers.companyId, companyId))).run();
  db.update(schema.companies).set({ guildId: null }).where(eq(schema.companies.id, companyId)).run();
  const rest = members(guildId);
  if (!rest.length) {
    // last one out: treasury returns to them, guild disbands
    const bal = balanceOf(guildWallet(guildId));
    if (bal > 0) post({ kind: 'guild.disband', legs: [{ from: guildWallet(guildId), to: companyWallet(companyId), amount: bal }] });
    db.delete(schema.guilds).where(eq(schema.guilds.id, guildId)).run();
    return;
  }
  const g = getGuild(guildId);
  if (g.leaderId === companyId) {
    const heir = rest.find((m) => m.role === 'officer') ?? rest[0];
    db.update(schema.guildMembers).set({ role: 'leader' }).where(and(eq(schema.guildMembers.guildId, guildId), eq(schema.guildMembers.companyId, heir.companyId))).run();
    db.update(schema.guilds).set({ leaderId: heir.companyId }).where(eq(schema.guilds.id, guildId)).run();
    notify(heir.companyId, 'guild', '👑 You are the new guild leader!', `${g.emoji} ${g.name} is yours to lead.`);
  }
}

export function leaveGuild(companyId: string) {
  return atomic(() => {
    const m = membership(companyId);
    if (!m) throw badRequest('You are not in a guild.');
    removeMember(m.guildId, companyId);
    return { ok: true };
  });
}

export function kickMember(companyId: string, targetId: string) {
  return atomic(() => {
    const me = membership(companyId);
    if (!me) throw badRequest('You are not in a guild.');
    requireRank(companyId, me.guildId, 'leader', 'officer');
    const t = membership(targetId);
    if (!t || t.guildId !== me.guildId) throw notFound('Not a member.');
    if (t.role === 'leader' || (t.role === 'officer' && me.role !== 'leader')) throw forbidden('You can not kick that member.');
    removeMember(me.guildId, targetId);
    notify(targetId, 'guild', '👋 You were removed from your guild', 'Plenty of other guilds out there!');
    return { ok: true };
  });
}

export function setRole(companyId: string, targetId: string, role: 'officer' | 'member' | 'leader') {
  return atomic(() => {
    const me = membership(companyId);
    if (!me) throw badRequest('You are not in a guild.');
    requireRank(companyId, me.guildId, 'leader');
    const t = membership(targetId);
    if (!t || t.guildId !== me.guildId || targetId === companyId) throw notFound('Not a member.');
    if (role === 'leader') {
      db.update(schema.guildMembers).set({ role: 'officer' }).where(and(eq(schema.guildMembers.guildId, me.guildId), eq(schema.guildMembers.companyId, companyId))).run();
      db.update(schema.guilds).set({ leaderId: targetId }).where(eq(schema.guilds.id, me.guildId)).run();
    }
    db.update(schema.guildMembers).set({ role }).where(and(eq(schema.guildMembers.guildId, me.guildId), eq(schema.guildMembers.companyId, targetId))).run();
    return { ok: true };
  });
}

export function updateGuild(companyId: string, patch: { motto?: string; emoji?: string; open?: boolean }) {
  const me = membership(companyId);
  if (!me) throw badRequest('You are not in a guild.');
  requireRank(companyId, me.guildId, 'leader');
  db.update(schema.guilds)
    .set({ ...(patch.motto != null ? { motto: patch.motto.slice(0, 120) } : {}), ...(patch.emoji ? { emoji: patch.emoji } : {}), ...(patch.open != null ? { open: patch.open } : {}) })
    .where(eq(schema.guilds.id, me.guildId))
    .run();
  return { ok: true };
}

// ------------------------------------------------------------ treasury + xp
function addXp(guildId: string, xp: number) {
  const g = getGuild(guildId);
  const c = cfg().guilds;
  let level = g.level;
  let total = g.xp + Math.floor(xp);
  while (level < c.maxLevel && total >= c.levelXp(level)) {
    total -= c.levelXp(level);
    level++;
  }
  db.update(schema.guilds).set({ xp: total, level }).where(eq(schema.guilds.id, guildId)).run();
  if (level > g.level) {
    broadcastGuild(guildId, { type: 'guild', event: 'levelup', level });
    addNews('headline', `${g.emoji} Guild ${g.name} reaches level ${level}!`, `Every member now earns +${Math.round(level * c.perkPerLevel * 100)}% income.`);
  }
}

export function deposit(companyId: string, amount: number, actorId: string) {
  return atomic(() => {
    const me = membership(companyId);
    if (!me) throw badRequest('You are not in a guild.');
    chargeCompany({ companyId, amount, to: guildWallet(me.guildId), kind: 'guild.deposit', memo: 'Guild treasury deposit', actorId });
    bump(companyId, 'guildDeposits', amount);
    bump(companyId, 'gifted', amount);
    addXp(me.guildId, amount * cfg().guilds.xpPerBitDeposited);
    return { balance: balanceOf(guildWallet(me.guildId)) };
  });
}

/** Leader pays a member from the treasury; capped per member per day (owner-tunable in economy config). */
export function payout(companyId: string, targetId: string, amount: number, actorId: string) {
  return atomic(() => {
    const me = membership(companyId);
    if (!me) throw badRequest('You are not in a guild.');
    requireRank(companyId, me.guildId, 'leader');
    const t = membership(targetId);
    if (!t || t.guildId !== me.guildId) throw notFound('Not a member.');
    const cap = cfg().guilds.maxPayoutPerDay;
    const already = today(targetId, 'guildPayouts');
    if (already + amount > cap) throw forbidden(`Guild payouts are capped at ${cap} BT per member per day (${cap - already} left).`, 'guild_cap');
    if (balanceOf(guildWallet(me.guildId)) < amount) throw badRequest('The guild treasury is too small for that.');
    payCompany({ companyId: targetId, amount, from: guildWallet(me.guildId), kind: 'guild.payout', memo: 'Guild treasury payout', actorId, earn: false, partial: false });
    bump(targetId, 'guildPayouts', amount);
    notify(targetId, 'guild', `🛡️ Guild payout: ${amount} BT`, 'From your guild treasury.');
    return { ok: true };
  });
}

export function throwParty(companyId: string, actorId: string) {
  return atomic(() => {
    const me = membership(companyId);
    if (!me) throw badRequest('You are not in a guild.');
    requireRank(companyId, me.guildId, 'leader', 'officer');
    const list = members(me.guildId);
    const c = cfg().guilds;
    const cost = c.partyCostPerMember * list.length;
    const have = balanceOf(guildWallet(me.guildId));
    if (have < cost) throw badRequest(`A party costs ${cost} BT from the treasury (you have ${have}).`);
    post({ kind: 'guild.party', actorId, memo: 'Guild party', legs: [{ from: guildWallet(me.guildId), to: SYS.TREASURY, amount: cost }] });
    for (const m of list) addModifier(m.companyId, 'income', c.partyIncomeMult, c.partyMinutes, 'guild-party');
    broadcastGuild(me.guildId, { type: 'guild', event: 'party', minutes: c.partyMinutes });
    return { ok: true, cost };
  });
}

// ------------------------------------------------------------ quests
function questTarget(memberCount: number, level: number) {
  return Math.round(cfg().guilds.questEarnPerMember * memberCount * (1 + (level - 1) * 0.15));
}

function questProgress(guildId: string) {
  const ids = members(guildId).map((m) => m.companyId);
  if (!ids.length) return 0;
  const key = `d:${dayKey()}:earned`;
  return (sqlite.prepare(`SELECT COALESCE(SUM(value),0) s FROM stats WHERE key = ? AND company_id IN (${ids.map(() => '?').join(',')})`).get(key, ...ids) as { s: number }).s;
}

/** Global hook: completes the daily quest for every guild that hit its target. */
export function guildQuestTick() {
  const day = dayKey();
  const c = cfg().guilds;
  for (const g of db.select().from(schema.guilds).all()) {
    if (g.questDay !== day) {
      db.update(schema.guilds).set({ questDay: day, questDone: false }).where(eq(schema.guilds.id, g.id)).run();
      g.questDone = false;
    }
    if (g.questDone) continue;
    const list = members(g.id);
    if (questProgress(g.id) < questTarget(list.length, g.level)) continue;
    atomic(() => {
      const reward = c.questRewardPerMember * list.length;
      const paid = Math.min(reward, balanceOf(SYS.TREASURY));
      if (paid > 0) post({ kind: 'guild.quest', memo: 'Daily guild quest', legs: [{ from: SYS.TREASURY, to: guildWallet(g.id), amount: paid }] });
      db.update(schema.guilds).set({ questDone: true }).where(eq(schema.guilds.id, g.id)).run();
      addXp(g.id, c.questXp);
      broadcastGuild(g.id, { type: 'guild', event: 'quest', reward: paid });
      for (const m of list) notify(m.companyId, 'guild', '🏆 Guild quest complete!', `${paid} BT went into the guild treasury.`);
    });
  }
}

// ------------------------------------------------------------ views
export function guildView(companyId: string) {
  const m = membership(companyId);
  const c = cfg().guilds;
  if (!m) return { guild: null, createCost: c.createCost };
  const g = getGuild(m.guildId);
  const list = members(g.id).map((x) => {
    const co = findCompany(x.companyId);
    return { companyId: x.companyId, role: x.role, joinedAt: x.joinedAt, name: co?.name ?? '?', emoji: co?.emoji ?? '❓', level: co?.level ?? 1, earnedToday: today(x.companyId, 'earned'), deposits: (sqlite.prepare(`SELECT value FROM stats WHERE company_id = ? AND key = 'guildDeposits'`).get(x.companyId) as { value: number } | undefined)?.value ?? 0 };
  });
  return {
    guild: {
      ...g,
      treasury: balanceOf(guildWallet(g.id)),
      perkPct: Math.round(g.level * c.perkPerLevel * 1000) / 10,
      nextLevelXp: c.levelXp(g.level),
      quest: { target: questTarget(list.length, g.level), progress: questProgress(g.id), done: g.questDay === dayKey() && g.questDone, reward: c.questRewardPerMember * list.length },
      partyCost: c.partyCostPerMember * list.length,
      maxMembers: c.maxMembers,
      maxPayoutPerDay: c.maxPayoutPerDay,
    },
    myRole: m.role,
    members: list,
    createCost: c.createCost,
  };
}

export function listGuilds() {
  const rows = db.select().from(schema.guilds).orderBy(desc(schema.guilds.level), desc(schema.guilds.xp)).all();
  return rows.map((g) => {
    const ids = members(g.id).map((m) => m.companyId);
    const earned = ids.length ? (sqlite.prepare(`SELECT COALESCE(SUM(lifetime_earned),0) s FROM companies WHERE id IN (${ids.map(() => '?').join(',')})`).get(...ids) as { s: number }).s : 0;
    return { id: g.id, name: g.name, emoji: g.emoji, motto: g.motto, level: g.level, open: g.open, members: ids.length, earned, treasury: balanceOf(guildWallet(g.id)), leader: findCompany(g.leaderId)?.name ?? '?' };
  });
}

/** Owner tools */
export function ownerDisband(guildId: string, actorId: string) {
  return atomic(() => {
    const g = getGuild(guildId);
    const bal = balanceOf(guildWallet(guildId));
    if (bal > 0) post({ kind: 'guild.disband', actorId, legs: [{ from: guildWallet(guildId), to: SYS.TREASURY, amount: bal }] });
    for (const m of members(guildId)) db.update(schema.companies).set({ guildId: null }).where(eq(schema.companies.id, m.companyId)).run();
    db.delete(schema.guildMembers).where(eq(schema.guildMembers.guildId, guildId)).run();
    db.delete(schema.guilds).where(eq(schema.guilds.id, guildId)).run();
    audit({ actorId, action: 'guild.disband', targetType: 'guild', targetId: guildId, oldValue: { name: g.name, treasury: bal } });
    return { ok: true };
  });
}

// Guild perk: +perkPerLevel income per guild level for every member.
const perkMemo = new Map<string, { at: number; v: number }>();
registerMultiplier('income', (co, now) => {
  if (!co.guildId) return 1;
  const hit = perkMemo.get(co.guildId);
  if (hit && now - hit.at < 30_000) return hit.v;
  const g = db.select({ level: schema.guilds.level }).from(schema.guilds).where(eq(schema.guilds.id, co.guildId)).get();
  const v = g ? 1 + g.level * cfg().guilds.perkPerLevel : 1;
  perkMemo.set(co.guildId, { at: now, v });
  return v;
});
