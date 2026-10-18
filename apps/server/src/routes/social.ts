/**
 * Social routes: chat (any logged-in role, per-channel checks), moderation
 * (owner + moderators with the matching tool), and company-side guilds, wars,
 * trade fairs, mentorship, leaderboards and profiles. Owner extras too.
 */
import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, like, or } from 'drizzle-orm';
import { db, schema } from '../db';
import { h, parse, ctx, companyOf, requireAuth, requireModule, requireModTool, requireRole } from './http';
import { registerGameRoutes } from './game';
import { registerOwnerRoutes } from './owner-extras';
import * as chat from '../services/chat';
import * as guilds from '../services/guilds';
import * as wars from '../services/wars';
import * as fairs from '../services/fairs';
import * as mentor from '../services/mentorship';
import * as boards from '../services/leaderboards';
import * as newsgen from '../services/newsgen';
import { getAccount } from '../services/auth';
import { flag } from '../services/flags';
import { forbidden } from '../lib/errors';

const contestSchema = z.enum(Object.keys(wars.CONTESTS) as [wars.Contest, ...wars.Contest[]]);

/** /api/chat - usable by every role; the chat service checks each channel. */
export function chatRouter() {
  const r = Router();
  r.use(requireAuth);
  r.get('/channels', h((req) => ({ channels: chat.myChannels(ctx(req).account.id), killSwitch: flag('chatKillSwitch') })));
  r.get('/history', h((req) => chat.history(ctx(req).account.id, String(req.query.channel ?? 'global'), Number(req.query.limit ?? 100))));
  r.post('/send', h((req) => {
    const v = parse(z.object({ channel: z.string().max(80), text: z.string().min(1).max(400) }), req.body);
    if (ctx(req).access.viewAs) throw forbidden('View-as mode is read-only.');
    return chat.sendMessage(ctx(req).account.id, v.channel, v.text);
  }));
  r.post('/dm', h((req) => {
    const v = parse(z.object({ accountId: z.string().max(64) }), req.body);
    const me = ctx(req).account.id;
    if (!getAccount(v.accountId) || v.accountId === me) throw forbidden('Can not DM that account.');
    const channel = chat.dmChannel(me, v.accountId);
    if (!chat.canUseChannel(me, channel)) throw forbidden('Direct messages are not enabled for you.', 'chat_denied');
    return { channel };
  }));
  r.post('/block', h((req) => {
    const v = parse(z.object({ accountId: z.string().max(64), on: z.boolean() }), req.body);
    return chat.block(ctx(req).account.id, v.accountId, v.on);
  }));
  r.post('/report', h((req) => {
    const v = parse(z.object({ targetType: z.enum(['message', 'company', 'account']), targetId: z.string().max(64), reason: z.string().min(2).max(300) }), req.body);
    return chat.report(ctx(req).account.id, v.targetType, v.targetId, v.reason);
  }));
  return r;
}

/** /api/mod - moderation center for the owner and moderators (per granted tool). */
export function modRouter() {
  const r = Router();
  r.use(requireAuth, requireRole('OWNER', 'MODERATOR'));
  r.get('/tools', h((req) => ({ tools: ctx(req).access.moderatorTools })));
  r.get('/reports', requireModTool('reports'), h((req) => chat.listReports(String(req.query.status ?? 'open'))));
  r.post('/reports/:id', requireModTool('reports'), h((req) => {
    const v = parse(z.object({ status: z.enum(['resolved', 'dismissed']), notes: z.string().max(500).default('') }), req.body);
    chat.resolveReport(req.params.id, v.status, v.notes, ctx(req).account.id);
    return { ok: true };
  }));
  r.get('/logs', requireModTool('reports'), h((req) => chat.chatLogs(req.query.channel ? String(req.query.channel) : null, Math.min(Number(req.query.limit ?? 300), 2000))));
  r.post('/messages/:id/delete', requireModTool('reports'), h((req) => {
    chat.deleteMessage(req.params.id, ctx(req).account.id);
    return { ok: true };
  }));
  r.get('/mutes', requireModTool('mute'), h(() => chat.activeMutes()));
  r.post('/mute', requireModTool('mute'), h((req) => {
    const v = parse(z.object({ accountId: z.string().max(64), minutes: z.number().int().min(1).max(60 * 24 * 30), reason: z.string().max(200).default('') }), req.body);
    return chat.mute(v.accountId, v.minutes, v.reason, ctx(req).account.id);
  }));
  r.post('/unmute', requireModTool('mute'), h((req) => {
    chat.unmute(parse(z.object({ accountId: z.string().max(64) }), req.body).accountId, ctx(req).account.id);
    return { ok: true };
  }));
  r.post('/kick', requireModTool('kick'), h((req) => {
    const v = parse(z.object({ accountId: z.string().max(64) }), req.body);
    const target = getAccount(v.accountId);
    if (!target || target.role === 'OWNER') throw forbidden('You can not kick that account.');
    chat.kick(v.accountId, ctx(req).account.id);
    return { ok: true };
  }));
  r.get('/accounts', requireModTool('mute'), h((req) => {
    const q = String(req.query.q ?? '').trim();
    const base = db.select({ id: schema.accounts.id, accountNumber: schema.accounts.accountNumber, displayName: schema.accounts.displayName, role: schema.accounts.role, companyId: schema.accounts.companyId }).from(schema.accounts);
    return (q ? base.where(or(like(schema.accounts.displayName, `%${q}%`), eq(schema.accounts.accountNumber, q))) : base).limit(50).all();
  }));
  r.get('/audit', requireModTool('audit'), h((req) => {
    const prefix = req.query.action ? String(req.query.action) : '';
    return db.select().from(schema.auditLog).where(prefix ? like(schema.auditLog.action, `${prefix}%`) : undefined).orderBy(desc(schema.auditLog.id)).limit(Math.min(Number(req.query.limit ?? 200), 1000)).all();
  }));
  return r;
}

export function registerSocialRoutes() {
  registerGameRoutes((r) => {
    // guilds
    const g = Router();
    g.use(requireModule('guilds'));
    g.get('/', h((req) => guilds.guildView(companyOf(req))));
    g.get('/list', h(() => guilds.listGuilds()));
    g.post('/', h((req) => guilds.createGuild(companyOf(req), parse(z.object({ name: z.string().min(3).max(32), emoji: z.string().max(8).default('🛡️'), motto: z.string().max(120).default('') }), req.body), ctx(req).account.id)));
    g.post('/:id/join', h((req) => guilds.joinGuild(companyOf(req), req.params.id)));
    g.post('/leave', h((req) => guilds.leaveGuild(companyOf(req))));
    g.post('/kick', h((req) => guilds.kickMember(companyOf(req), parse(z.object({ companyId: z.string().max(64) }), req.body).companyId)));
    g.post('/role', h((req) => {
      const v = parse(z.object({ companyId: z.string().max(64), role: z.enum(['officer', 'member', 'leader']) }), req.body);
      return guilds.setRole(companyOf(req), v.companyId, v.role);
    }));
    g.patch('/', h((req) => guilds.updateGuild(companyOf(req), parse(z.object({ motto: z.string().max(120).optional(), emoji: z.string().max(8).optional(), open: z.boolean().optional() }), req.body))));
    g.post('/deposit', h((req) => guilds.deposit(companyOf(req), parse(z.object({ amount: z.number().int().min(1).max(1e9) }), req.body).amount, ctx(req).account.id)));
    g.post('/payout', h((req) => {
      const v = parse(z.object({ companyId: z.string().max(64), amount: z.number().int().min(1).max(1e9) }), req.body);
      return guilds.payout(companyOf(req), v.companyId, v.amount, ctx(req).account.id);
    }));
    g.post('/party', h((req) => guilds.throwParty(companyOf(req), ctx(req).account.id)));
    g.get('/mentorship', h((req) => mentor.mentorView(companyOf(req))));
    g.post('/mentorship/offer', h((req) => mentor.offer(companyOf(req), parse(z.object({ companyId: z.string().max(64) }), req.body).companyId)));
    g.post('/mentorship/:id/respond', h((req) => mentor.respondOffer(companyOf(req), req.params.id, parse(z.object({ accept: z.boolean() }), req.body).accept)));
    g.post('/mentorship/:id/end', h((req) => mentor.endMentorship(companyOf(req), req.params.id)));
    r.use('/guilds', g);

    // business wars + trade fairs
    const w = Router();
    w.use(requireModule('wars'));
    w.get('/', h((req) => wars.warsView(companyOf(req))));
    w.post('/challenge', h((req) => {
      const v = parse(z.object({ kind: z.enum(['company', 'guild']), targetId: z.string().max(64), contest: contestSchema, durationMin: z.number().int() }), req.body);
      return wars.challenge(companyOf(req), v, ctx(req).account.id);
    }));
    w.post('/:id/respond', h((req) => wars.respond(companyOf(req), req.params.id, parse(z.object({ accept: z.boolean() }), req.body).accept)));
    r.use('/wars', w);

    const f = Router();
    f.use(requireModule('products'));
    f.get('/', h((req) => fairs.fairView(companyOf(req))));
    f.post('/join', h((req) => {
      const v = parse(z.object({ productId: z.string().max(80), qty: z.number().int().min(1).max(10_000) }), req.body);
      return fairs.joinFair(companyOf(req), v.productId, v.qty, ctx(req).account.id);
    }));
    r.use('/fairs', f);

    // leaderboards + profiles
    r.get('/leaderboard', requireModule('leaderboard'), h((req) => {
      const board = boards.BOARDS.find((b) => b.id === req.query.board)?.id ?? 'global';
      return { boards: boards.BOARDS, ...boards.leaderboard(board, { companyId: companyOf(req), industryId: req.query.industryId ? String(req.query.industryId) : undefined }) };
    }));
    r.get('/profiles/:id', h((req) => boards.profile(req.params.id)));
    r.get('/directory', h(() => boards.directory()));
  });

  registerOwnerRoutes((r) => {
    r.get('/social', h(() => ({ guilds: guilds.listGuilds(), wars: wars.allWars(60), fairs: fairs.listFairs(), contests: wars.CONTESTS })));
    r.post('/wars', h((req) => {
      const v = parse(z.object({ kind: z.enum(['company', 'guild']), contest: contestSchema, sideIds: z.array(z.string().max(64)).min(2).max(50), durationMin: z.number().int().min(5).max(7 * 24 * 60), prize: z.number().int().min(0).max(1e9).optional(), consolation: z.number().int().min(0).max(1e9).optional(), startInMin: z.number().int().min(0).max(7 * 24 * 60).default(0), name: z.string().max(80).optional() }), req.body);
      return wars.createWar(v, ctx(req).account.id);
    }));
    r.post('/wars/:id/cancel', h((req) => wars.cancelWar(req.params.id, ctx(req).account.id)));
    r.post('/wars/:id/end', h((req) => wars.endWarNow(req.params.id, ctx(req).account.id)));
    r.post('/fairs', h((req) => fairs.startFair(parse(z.object({ name: z.string().max(80).optional(), theme: z.string().max(40).optional(), durationMin: z.number().int().min(5).max(24 * 60).optional(), prizePool: z.number().int().min(0).max(1e9).optional() }), req.body), ctx(req).account.id)));
    r.post('/fairs/close', h((req) => fairs.forceCloseFair(ctx(req).account.id)));
    r.post('/guilds/:id/disband', h((req) => guilds.ownerDisband(req.params.id, ctx(req).account.id)));
    r.post('/news/generate', h((req) => {
      const kind = parse(z.object({ kind: z.enum(['report', 'classified', 'column']) }), req.body).kind;
      if (kind === 'report') newsgen.marketReport(true);
      else if (kind === 'classified') newsgen.classified(true);
      else newsgen.bossColumn(true);
      return { ok: true };
    }));
  });
}

export { and };
