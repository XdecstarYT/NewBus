import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './env';
import { randomToken } from './lib/ids';
import { sessionFromToken } from './services/auth';
import { resolveAccess } from './permissions';
import { errorHandler } from './routes/http';
import { forbidden } from './lib/errors';
import { clock } from './lib/time';
import { db, schema, sqlite } from './db';
import { eq } from 'drizzle-orm';
import { authRouter } from './routes/auth';
import { ownerRouter } from './routes/owner';
import { gameRouter } from './routes/game';
import { chatRouter, modRouter } from './routes/social';
import { flag } from './services/flags';
import { trackRequest } from './services/anticheat';

import { SESSION_COOKIE, CSRF_COOKIE } from './lib/cookies';
export { SESSION_COOKIE, CSRF_COOKIE };

const lastActiveTouch = new Map<string, number>();

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Security headers. The https-only ones (HSTS, upgrade-insecure-requests, COOP) are sent only
  // when the request really arrived over https, so plain-http play (home Wi-Fi) can never be
  // locked out by a wrong COOKIE_SECURE setting.
  const securityHeaders = (https: boolean) =>
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"], // animation libs set inline styles
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: https ? [] : null,
        },
      },
      strictTransportSecurity: https,
      crossOriginOpenerPolicy: https,
      crossOriginEmbedderPolicy: false,
    });
  const httpsHeaders = securityHeaders(true);
  const httpHeaders = securityHeaders(false);
  app.use((req, res, next) => (req.secure ? httpsHeaders : httpHeaders)(req, res, next));

  // Strict CORS: only configured origins, with credentials.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && env.corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token, X-View-As, X-Idempotency-Key');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(origin && env.corsOrigins.includes(origin) ? 204 : 403);
    next();
  });

  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  // Health check (no auth) - used by Docker and uptime monitors.
  app.get('/api/health', (_req, res) => {
    let dbOk = true;
    try {
      sqlite.prepare('SELECT 1').get();
    } catch {
      dbOk = false;
    }
    res.status(dbOk ? 200 : 503).json({ ok: dbOk, time: clock.now(), uptime: process.uptime() });
  });

  // CSRF: double-submit cookie. Any API GET issues the cookie; unsafe methods must echo it in a header.
  app.use('/api', (req, res, next) => {
    let token = req.cookies?.[CSRF_COOKIE];
    if (!token) {
      token = randomToken(18);
      res.cookie(CSRF_COOKIE, token, { httpOnly: false, sameSite: 'strict', secure: req.secure, path: '/' });
      req.cookies[CSRF_COOKIE] = token;
    }
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const header = req.get('x-csrf-token');
    if (!header || header !== token) return next(forbidden('CSRF check failed. Refresh the page and try again.', 'csrf'));
    next();
  });

  // Session -> request context (account + effective permissions, computed fresh every request).
  app.use('/api', (req, _res, next) => {
    const found = sessionFromToken(req.cookies?.[SESSION_COOKIE]);
    if (found) {
      const viewAs = found.account.role === 'OWNER' ? req.get('x-view-as') || null : null;
      req.ctx = { account: found.account, sessionId: found.session.id, access: resolveAccess(found.account, viewAs) };
      trackRequest(found.account.id);
      // keep company "active" for idle earnings (throttled)
      const cid = found.account.companyId;
      if (cid && !viewAs) {
        const last = lastActiveTouch.get(cid) ?? 0;
        if (clock.now() - last > 30_000) {
          lastActiveTouch.set(cid, clock.now());
          db.update(schema.companies).set({ lastActiveAt: clock.now() }).where(eq(schema.companies.id, cid)).run();
        }
      }
    }
    next();
  });

  // Read-only guard (owner "view as company", maintenance mode) and forced password change.
  app.use('/api', (req, _res, next) => {
    if (!req.ctx) return next();
    const isAuthPath = req.path.startsWith('/auth/');
    if (req.ctx.account.mustChangePassword && !isAuthPath && req.method !== 'GET') {
      return next(forbidden('Please change your temporary password first.', 'must_change_password'));
    }
    if (req.method !== 'GET' && !isAuthPath && req.ctx.access.readOnly) {
      const msg = req.ctx.access.viewAs ? 'View-as mode is read-only. Boss Byte is just looking!' : 'The game is in maintenance mode (read-only). Back soon!';
      return next(forbidden(msg, 'read_only'));
    }
    next();
  });

  const loginLimiter = rateLimit({ windowMs: 5 * 60_000, limit: env.isTest ? 10_000 : 20, standardHeaders: true, legacyHeaders: false, message: { error: 'rate_limited', message: 'Whoa there! Too many badge scans. Wait a few minutes.' } });
  const apiLimiter = rateLimit({ windowMs: 60_000, limit: env.isTest ? 100_000 : 900, standardHeaders: true, legacyHeaders: false, message: { error: 'rate_limited', message: 'Slow down, speedy! Too many requests.' } });

  app.use('/api/auth/login', loginLimiter);
  app.use('/api', apiLimiter);
  app.use('/api/auth', authRouter());
  app.use('/api/owner', ownerRouter());
  app.use('/api/game', gameRouter());
  app.use('/api/chat', chatRouter());
  app.use('/api/mod', modRouter());

  app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found', message: 'No such API route. Boss Byte checked twice.' }));

  // Serve the built web app in production.
  if (fs.existsSync(env.webDist)) {
    app.use(express.static(env.webDist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(env.webDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}

export function maintenanceOn() {
  return flag('maintenance');
}

export type { Request, Response, NextFunction };
