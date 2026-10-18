import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { loginSchema, changePasswordSchema } from '@dw/shared';
import { h, parse, ctx, requireAuth } from './http';
import { login, logout, changePassword, listSessions, revokeSessions, getAccount } from '../services/auth';
import { resolveAccess } from '../permissions';
import { env } from '../env';
import { db, schema } from '../db';
import { getFlags } from '../services/flags';
import { cfg } from '../services/settings';
import { findCompany } from '../services/companies';
import { findIndustry } from '../services/catalog';
import { SESSION_COOKIE } from '../lib/cookies';
import { SESSION_TTL_MS } from '../services/auth';
import { audit } from '../services/audit';

export function publicFlags() {
  const f = getFlags();
  return { maintenance: f.maintenance, lotto: f.lotto, chatKillSwitch: f.chatKillSwitch, tradeFairs: f.tradeFairs, insurance: f.insurance, peerLending: f.peerLending, mentorship: f.mentorship, shorting: f.shorting };
}

export function mePayload(accountId: string, viewAs?: string | null) {
  const acc = getAccount(accountId)!;
  const access = resolveAccess(acc, viewAs);
  const company = access.companyId ? findCompany(access.companyId) : undefined;
  const ind = company ? findIndustry(company.industryId) : undefined;
  const announcement = db.select().from(schema.settings).where(eq(schema.settings.key, 'announcement')).get()?.value ?? null;
  return {
    account: {
      id: acc.id,
      accountNumber: acc.accountNumber,
      displayName: acc.displayName,
      role: acc.role,
      jobTitle: acc.jobTitle,
      mustChangePassword: acc.mustChangePassword,
      tutorialDone: acc.tutorialDone,
      totpEnabled: acc.totpEnabled,
      settings: acc.settings ?? {},
    },
    access: {
      companyId: access.companyId,
      modules: access.modules,
      limits: access.limits,
      readOnly: access.readOnly,
      viewAs: access.viewAs,
      moderatorTools: access.moderatorTools,
    },
    company: company
      ? {
          id: company.id,
          name: company.name,
          emoji: company.emoji,
          color: company.color,
          slogan: company.slogan,
          industryId: company.industryId,
          industryName: ind?.name,
          industryEmoji: ind?.emoji,
          level: company.level,
          status: company.status,
        }
      : null,
    flags: publicFlags(),
    announcement,
    tickMs: cfg().tick.intervalMs,
  };
}

export function authRouter() {
  const r = Router();

  r.post(
    '/login',
    h((req, res) => {
      const body = parse(loginSchema, req.body);
      const { token, account } = login(body.accountNumber, body.password, body.totp, { ip: req.ip, userAgent: req.get('user-agent') });
      res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: env.cookieSecure, maxAge: SESSION_TTL_MS, path: '/' });
      return mePayload(account.id);
    }),
  );

  r.post(
    '/logout',
    h((req, res) => {
      logout(req.cookies?.[SESSION_COOKIE]);
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      return { ok: true };
    }),
  );

  r.get(
    '/me',
    requireAuth,
    h((req) => mePayload(ctx(req).account.id, ctx(req).access.viewAs ? ctx(req).access.companyId : null)),
  );

  r.post(
    '/change-password',
    requireAuth,
    h((req) => {
      const body = parse(changePasswordSchema, req.body);
      changePassword(ctx(req).account.id, body.currentPassword, body.newPassword);
      // rotate: kill other sessions after a password change
      revokeSessions(ctx(req).account.id, ctx(req).sessionId);
      return mePayload(ctx(req).account.id);
    }),
  );

  r.get(
    '/sessions',
    requireAuth,
    h((req) => ({ sessions: listSessions(ctx(req).account.id), current: ctx(req).sessionId.slice(0, 12) })),
  );

  r.post(
    '/sessions/logout-others',
    requireAuth,
    h((req) => {
      revokeSessions(ctx(req).account.id, ctx(req).sessionId);
      audit({ actorId: ctx(req).account.id, action: 'auth.logout_others', targetType: 'account', targetId: ctx(req).account.id });
      return { ok: true };
    }),
  );

  r.post(
    '/tutorial',
    requireAuth,
    h((req) => {
      const { done } = parse(z.object({ done: z.boolean() }), req.body);
      db.update(schema.accounts).set({ tutorialDone: done }).where(eq(schema.accounts.id, ctx(req).account.id)).run();
      return { ok: true };
    }),
  );

  r.put(
    '/settings',
    requireAuth,
    h((req) => {
      const settings = parse(z.record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean(), z.null()])), req.body);
      const merged = { ...(ctx(req).account.settings ?? {}), ...settings };
      if (Object.keys(merged).length > 40) return { ok: false };
      db.update(schema.accounts).set({ settings: merged }).where(eq(schema.accounts.id, ctx(req).account.id)).run();
      return { ok: true, settings: merged };
    }),
  );

  return r;
}
