/**
 * Chat: global, company, guild and DM channels. Profanity filter, per-account
 * rate limits, slow mode, mutes, blocks, reports, moderator tools and an owner
 * kill switch. Every message is checked against live permissions.
 */
import { and, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { clock } from '../lib/time';
import { newId } from '../lib/ids';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { getAccount, revokeSessions } from './auth';
import { resolveAccess } from '../permissions';
import { flag } from './flags';
import { cfg } from './settings';
import { bus } from '../lib/bus';
import { audit } from './audit';
import { findCompany } from './companies';

// Family-friendly filter: mild words get replaced with a monkey emoji.
const BAD = ['damn', 'hell', 'crap', 'stupid', 'idiot', 'dumb', 'shut up', 'sucks', 'loser', 'jerk', 'moron', 'butt', 'poop', 'freaking', 'wtf', 'omfg'];
const BAD_RE = new RegExp(`\\b(${BAD.map((w) => w.replace(/\s+/g, '\\s+')).join('|')})\\b`, 'gi');
export function filterText(text: string): string {
  return text.replace(BAD_RE, '🙊').replace(/\s{3,}/g, '  ').trim();
}

export function dmChannel(a: string, b: string) {
  return `dm:${[a, b].sort().join(':')}`;
}

function guildOf(companyId: string | null) {
  if (!companyId) return null;
  return db.select({ g: schema.guildMembers.guildId }).from(schema.guildMembers).where(eq(schema.guildMembers.companyId, companyId)).get()?.g ?? null;
}

/** Can this account read/post in the channel? */
export function canUseChannel(accountId: string, channel: string): boolean {
  const acc = getAccount(accountId);
  if (!acc || acc.status !== 'active') return false;
  const a = resolveAccess(acc);
  if (a.role === 'OWNER') return true;
  if (a.role === 'MODERATOR') return channel === 'global' || channel.startsWith('company:') || channel.startsWith('guild:');
  if (!a.modules.chat) return false;
  if (channel === 'global') return true;
  if (channel.startsWith('company:')) return channel === `company:${a.companyId}`;
  if (channel.startsWith('guild:')) return a.modules.guilds && channel === `guild:${guildOf(a.companyId)}`;
  if (channel.startsWith('dm:')) return channel.split(':').slice(1).includes(accountId);
  return false;
}

const recent = new Map<string, number[]>();
const lastInChannel = new Map<string, number>();

export function sendMessage(accountId: string, channel: string, raw: string) {
  const acc = getAccount(accountId);
  if (!acc) throw forbidden('Unknown sender.');
  if (flag('chatKillSwitch') && acc.role !== 'OWNER') throw forbidden('Chat is switched off by the Owner right now. 🔇', 'chat_off');
  if (!canUseChannel(accountId, channel)) throw forbidden('You can not chat in that channel.', 'chat_denied');
  const mute = db.select().from(schema.mutes).where(eq(schema.mutes.accountId, accountId)).get();
  if (mute && mute.until > clock.now()) throw forbidden(`You are muted for ${Math.ceil((mute.until - clock.now()) / 60_000)} more minute(s).`, 'muted');
  const text = filterText(String(raw ?? '').slice(0, 400));
  if (!text) throw badRequest('Say something!');
  const c = cfg();
  const now = Date.now();
  // per-account rate limit
  const times = (recent.get(accountId) ?? []).filter((t) => now - t < 60_000);
  if (times.length >= c.chat.maxPerMinute && acc.role !== 'OWNER') throw badRequest('Whoa, chatty! Slow down a little.', 'chat_rate');
  // slow mode (per account per channel)
  const key = `${accountId}:${channel}`;
  if (c.chat.slowModeMs > 0 && (acc.role === 'COMPANY_ADMIN' || acc.role === 'STAFF')) {
    const last = lastInChannel.get(key) ?? 0;
    if (now - last < c.chat.slowModeMs) throw badRequest(`Slow mode is on: wait ${Math.ceil((c.chat.slowModeMs - (now - last)) / 1000)}s.`, 'slow_mode');
  }
  times.push(now);
  recent.set(accountId, times);
  lastInChannel.set(key, now);
  if (channel.startsWith('dm:')) {
    const other = channel.split(':').slice(1).find((x) => x !== accountId)!;
    const blocked = db.select().from(schema.blocks).where(and(eq(schema.blocks.accountId, other), eq(schema.blocks.blockedId, accountId))).get();
    if (blocked) throw forbidden('That player is not accepting your messages.', 'blocked');
  }
  const co = acc.companyId ? findCompany(acc.companyId) : null;
  const senderName = acc.role === 'OWNER' ? '👑 The Owner' : acc.role === 'MODERATOR' ? `🛡️ ${acc.displayName}` : `${co?.emoji ?? ''} ${acc.displayName} (${co?.name ?? '?'})`;
  const row = { id: newId('msg'), channel, accountId, companyId: acc.companyId, senderName, text, deleted: false, createdAt: clock.now() };
  db.insert(schema.chatMessages).values(row).run();
  bus.publish(`chat:${channel}`, { type: 'chat', message: row });
  // @mentions -> notifications
  const mentioned = [...text.matchAll(/@(\d{2,8})/g)].map((m) => m[1]);
  for (const num of mentioned) {
    const target = db.select().from(schema.accounts).where(eq(schema.accounts.accountNumber, num)).get();
    if (target?.companyId) {
      db.insert(schema.notifications).values({ id: newId('ntf'), companyId: target.companyId, accountId: target.id, kind: 'mention', title: `💬 ${senderName} mentioned you`, body: text.slice(0, 120), reward: null, claimed: false, read: false, createdAt: clock.now() }).run();
      bus.publish(`company:${target.companyId}`, { type: 'notification', item: { title: `💬 ${senderName} mentioned you`, body: text } });
    }
  }
  return row;
}

export function history(accountId: string, channel: string, limit = 100) {
  if (!canUseChannel(accountId, channel)) throw forbidden('You can not read that channel.', 'chat_denied');
  const blocked = new Set(db.select().from(schema.blocks).where(eq(schema.blocks.accountId, accountId)).all().map((b) => b.blockedId));
  return db
    .select()
    .from(schema.chatMessages)
    .where(and(eq(schema.chatMessages.channel, channel), eq(schema.chatMessages.deleted, false)))
    .orderBy(desc(schema.chatMessages.createdAt))
    .limit(Math.min(limit, 200))
    .all()
    .filter((m) => !blocked.has(m.accountId))
    .reverse();
}

export function myChannels(accountId: string) {
  const acc = getAccount(accountId)!;
  const a = resolveAccess(acc);
  const out: Array<{ id: string; label: string }> = [];
  if (a.role === 'OWNER' || a.role === 'MODERATOR' || a.modules.chat) out.push({ id: 'global', label: '🌍 Global' });
  if (a.companyId && a.modules.chat) out.push({ id: `company:${a.companyId}`, label: '🏢 Company' });
  const g = guildOf(a.companyId);
  if (g && a.modules.chat && a.modules.guilds) out.push({ id: `guild:${g}`, label: '🛡️ Guild' });
  // DMs this account has been part of
  const dms = db
    .select({ channel: schema.chatMessages.channel })
    .from(schema.chatMessages)
    .where(and(sql`${schema.chatMessages.channel} LIKE 'dm:%'`, sql`${schema.chatMessages.channel} LIKE ${'%' + accountId + '%'}`))
    .groupBy(schema.chatMessages.channel)
    .all();
  for (const d of dms) {
    const other = d.channel.split(':').slice(1).find((x) => x !== accountId);
    const o = other ? getAccount(other) : null;
    if (o) out.push({ id: d.channel, label: `✉️ ${o.displayName} (${o.accountNumber})` });
  }
  return out;
}

export function block(accountId: string, targetId: string, on: boolean) {
  if (on) db.insert(schema.blocks).values({ accountId, blockedId: targetId }).onConflictDoNothing().run();
  else db.delete(schema.blocks).where(and(eq(schema.blocks.accountId, accountId), eq(schema.blocks.blockedId, targetId))).run();
  return { ok: true };
}

export function report(reporterId: string, targetType: 'message' | 'company' | 'account', targetId: string, reason: string) {
  const id = newId('rpt');
  db.insert(schema.reports).values({ id, reporterId, targetType, targetId, reason: reason.slice(0, 300), status: 'open', notes: null, createdAt: clock.now() }).run();
  bus.publish('owner', { type: 'owner_refresh', reason: 'report' });
  return { id };
}

// ------------------------------------------------------------ moderation
export function listReports(status = 'open') {
  const rows = db.select().from(schema.reports).where(eq(schema.reports.status, status)).orderBy(desc(schema.reports.createdAt)).limit(200).all();
  return rows.map((r) => ({
    ...r,
    message: r.targetType === 'message' ? db.select().from(schema.chatMessages).where(eq(schema.chatMessages.id, r.targetId)).get() ?? null : null,
    reporter: getAccount(r.reporterId)?.displayName,
  }));
}

export function resolveReport(id: string, status: 'resolved' | 'dismissed', notes: string, actorId: string) {
  db.update(schema.reports).set({ status, notes }).where(eq(schema.reports.id, id)).run();
  audit({ actorId, action: `moderation.report_${status}`, targetType: 'report', targetId: id, newValue: { notes } });
}

export function deleteMessage(id: string, actorId: string) {
  const m = db.select().from(schema.chatMessages).where(eq(schema.chatMessages.id, id)).get();
  if (!m) throw notFound('No such message.');
  db.update(schema.chatMessages).set({ deleted: true }).where(eq(schema.chatMessages.id, id)).run();
  bus.publish(`chat:${m.channel}`, { type: 'chat_delete', id });
  audit({ actorId, action: 'moderation.delete_message', targetType: 'message', targetId: id, oldValue: { text: m.text } });
}

export function mute(accountId: string, minutes: number, reason: string, actorId: string) {
  const until = clock.now() + minutes * 60_000;
  db.insert(schema.mutes).values({ accountId, until, reason, byId: actorId }).onConflictDoUpdate({ target: schema.mutes.accountId, set: { until, reason, byId: actorId } }).run();
  audit({ actorId, action: 'moderation.mute', targetType: 'account', targetId: accountId, newValue: { minutes, reason } });
  return { until };
}

export function unmute(accountId: string, actorId: string) {
  db.delete(schema.mutes).where(eq(schema.mutes.accountId, accountId)).run();
  audit({ actorId, action: 'moderation.unmute', targetType: 'account', targetId: accountId });
}

export function kick(accountId: string, actorId: string) {
  revokeSessions(accountId);
  bus.publish(`account:${accountId}`, { type: 'logout' });
  audit({ actorId, action: 'moderation.kick', targetType: 'account', targetId: accountId });
}

export function chatLogs(channel: string | null, limit = 300) {
  const q = db.select().from(schema.chatMessages);
  return (channel ? q.where(eq(schema.chatMessages.channel, channel)) : q).orderBy(desc(schema.chatMessages.createdAt)).limit(limit).all();
}

export function activeMutes() {
  return db.select().from(schema.mutes).where(gt(schema.mutes.until, clock.now())).all().map((m) => ({ ...m, name: getAccount(m.accountId)?.displayName, number: getAccount(m.accountId)?.accountNumber }));
}

export function pruneChat(keepDays = 14) {
  db.delete(schema.chatMessages).where(lt(schema.chatMessages.createdAt, clock.now() - keepDays * 86400_000)).run();
}

export { inArray, guildOf };
