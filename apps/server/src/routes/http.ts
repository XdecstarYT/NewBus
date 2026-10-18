import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { ZodSchema, z } from 'zod';
import type { Module } from '@dw/shared';
import type { AccessContext } from '../permissions';
import type { Account } from '../services/auth';
import { GameError, badRequest, forbidden, unauthorized } from '../lib/errors';
import { log } from '../lib/log';

export interface Ctx {
  account: Account;
  sessionId: string;
  access: AccessContext;
}

declare module 'express-serve-static-core' {
  interface Request {
    ctx?: Ctx;
  }
}

/** Wrap a (sync or async) handler; its return value is sent as JSON. */
export function h(fn: (req: Request, res: Response) => unknown): RequestHandler {
  return (req, res, next) => {
    try {
      const out = fn(req, res);
      if (out instanceof Promise) out.then((v) => !res.headersSent && res.json(v ?? { ok: true })).catch(next);
      else if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (e) {
      next(e);
    }
  };
}

export function parse<S extends ZodSchema>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const first = r.error.issues[0];
    throw badRequest(`${first.path.join('.') || 'input'}: ${first.message}`, 'validation', { issues: r.error.issues.slice(0, 5) });
  }
  return r.data;
}

export function ctx(req: Request): Ctx {
  if (!req.ctx) throw unauthorized();
  return req.ctx;
}

/** The company this request acts for (own company or view-as target). */
export function companyOf(req: Request): string {
  const c = ctx(req);
  if (!c.access.companyId) throw forbidden('You are not attached to a company.', 'no_company');
  return c.access.companyId;
}

export const requireAuth: RequestHandler = (req, _res, next) => (req.ctx ? next() : next(unauthorized()));

export const requireRole =
  (...roles: string[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.ctx) return next(unauthorized());
    if (!roles.includes(req.ctx.account.role)) return next(forbidden('Owner-only area. Boss Byte is guarding the door.', 'role'));
    next();
  };

export const requireCompany: RequestHandler = (req, _res, next) => {
  if (!req.ctx) return next(unauthorized());
  if (!req.ctx.access.companyId) return next(forbidden('You are not attached to a company.', 'no_company'));
  next();
};

/** Deny unless the module is on for this login (flag + company toggle + staff toggle). */
export const requireModule =
  (...mods: Module[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.ctx) return next(unauthorized());
    const missing = mods.find((m) => !req.ctx!.access.modules[m]);
    if (missing) return next(forbidden(`Boss Byte says: ask the Owner to unlock ${missing}!`, 'module_locked', { module: missing }));
    next();
  };

export const requireModTool =
  (tool: string): RequestHandler =>
  (req, _res, next) => {
    if (!req.ctx) return next(unauthorized());
    const a = req.ctx.access;
    if (a.role === 'OWNER' || (a.role === 'MODERATOR' && a.moderatorTools.includes(tool))) return next();
    next(forbidden('Moderator tool not granted.', 'mod_tool'));
  };

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof GameError) {
    res.status(err.status).json({ error: err.code, message: err.message, ...err.extra });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'bad_json', message: 'That JSON was scrambled.' });
    return;
  }
  log.error('unhandled', { path: req.path, err: String(err?.stack ?? err) });
  res.status(500).json({ error: 'server_error', message: 'Something caught fire in the server room. 🔥' });
}
