/**
 * Tiny Request -> Response router (Web standard), so the same code runs as a
 * Netlify Function and in the local dev server. Handles sessions, CSRF,
 * JSON bodies and errors.
 */
import { and, eq, gt, sql } from 'drizzle-orm';
import type { ZodSchema, z } from 'zod';
import { databaseUrl, getDb, schema, type Db } from '../db';
import { GameError, badRequest, forbidden, unauthorized } from '../lib/errors';
import { clock, MINUTE } from '../lib/time';
import { sha256, token } from '../lib/ids';

export type Account = typeof schema.accounts.$inferSelect;
export type Company = typeof schema.companies.$inferSelect;

export interface Ctx {
  req: Request;
  url: URL;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  ip: string | null;
  db: Db;
  https: boolean;
  cookies: Record<string, string>;
  setCookies: string[];
  account: Account | null;
  company: Company | null;
}

/** Ctx for routes that require a login (account is set). */
export type AuthCtx = Ctx & { account: Account };
/** Ctx for routes that act for a company. */
export type CoCtx = Ctx & { account: Account; company: Company };

type Auth = 'public' | 'user' | 'company' | 'owner';
interface Route {
  method: string;
  re: RegExp;
  keys: string[];
  auth: Auth;
  /** reachable while the account still has to change its password */
  pw: boolean;
  fn: (c: any) => unknown;
}

const routes: Route[] = [];
const hooks: Array<(c: Ctx) => Promise<void>> = [];

export function route<A extends Auth>(method: string, path: string, auth: A, fn: (c: A extends 'public' ? Ctx : A extends 'user' | 'owner' ? AuthCtx : CoCtx) => unknown, opts: { pw?: boolean } = {}) {
  const keys: string[] = [];
  const re = new RegExp(`^${path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}/?$`);
  routes.push({ method, re, keys, auth, pw: !!opts.pw, fn });
}

/** Runs before every logged-in request (used to settle timed events). */
export function beforeEach(fn: (c: Ctx) => Promise<void>) {
  hooks.push(fn);
}

export function parse<S extends ZodSchema>(s: S, data: unknown): z.infer<S> {
  const r = s.safeParse(data ?? {});
  if (!r.success) {
    const first = r.error.issues[0];
    throw badRequest(`${first.path.join('.') || 'input'}: ${first.message}`, 'validation');
  }
  return r.data;
}

function parseCookies(header: string | null) {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export const SESSION_COOKIE = 'dw_s';
export const CSRF_COOKIE = 'dw_csrf';
export const SESSION_TTL = 30 * 24 * 3600_000;

export function cookie(c: Ctx, name: string, value: string, opts: { httpOnly?: boolean; maxAge?: number } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax'];
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  if (opts.maxAge != null) parts.push(`Max-Age=${Math.floor(opts.maxAge / 1000)}`);
  if (c.https) parts.push('Secure');
  c.setCookies.push(parts.join('; '));
}

async function loadSession(c: Ctx) {
  const t = c.cookies[SESSION_COOKIE];
  if (!t) return;
  const now = clock.now();
  const found = await c.db
    .select({ s: schema.sessions, a: schema.accounts })
    .from(schema.sessions)
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.sessions.accountId))
    .where(and(eq(schema.sessions.id, sha256(t)), gt(schema.sessions.expiresAt, now)))
    .limit(1);
  const row = found[0];
  if (!row || row.a.status !== 'active') return;
  c.account = row.a;
  if (row.a.companyId) {
    const co = await c.db.select().from(schema.companies).where(eq(schema.companies.id, row.a.companyId)).limit(1);
    c.company = co[0] ?? null;
  }
  if (now - row.s.lastSeen > MINUTE) {
    await c.db.update(schema.sessions).set({ lastSeen: now, expiresAt: now + SESSION_TTL }).where(eq(schema.sessions.id, row.s.id));
    await c.db.update(schema.accounts).set({ lastSeen: now }).where(eq(schema.accounts.id, row.a.id));
  }
}

function json(status: number, data: unknown, setCookies: string[]) {
  const h = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  for (const sc of setCookies) h.append('set-cookie', sc);
  return new Response(JSON.stringify(data ?? { ok: true }), { status, headers: h });
}

/** Turn whatever path the platform hands us (/api/x or /.netlify/functions/api/x) into /x. */
function apiPath(pathname: string) {
  return pathname.replace(/^\/\.netlify\/functions\/api/, '').replace(/^\/api/, '') || '/';
}

/** Turn a database connection failure into advice the Owner can act on. */
export function explainDbError(e: unknown): string | null {
  const err = e as { code?: string; message?: string };
  const msg = String(err?.message ?? '');
  const code = String(err?.code ?? '');
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'The database address in DATABASE_URL does not exist. Copy it again from Supabase → Connect → Transaction pooler.';
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'CONNECT_TIMEOUT' || /timeout/i.test(msg)) return 'Could not connect to the database in time. Check DATABASE_URL uses the Transaction pooler address (port 6543) and that the Supabase project is not paused.';
  if (code === '28P01' || /password authentication failed/i.test(msg)) return 'The database password in DATABASE_URL is wrong. Put your Supabase database password in place of [YOUR-PASSWORD] (no brackets). Reset it in Supabase → Project Settings → Database if you forgot it.';
  if (/tenant or user not found/i.test(msg)) return 'Supabase does not recognise the user in DATABASE_URL. Copy the whole Transaction pooler string again (the user looks like postgres.rkrxszigtrjmboesxvhn).';
  if (/invalid url|invalid connection|getaddrinfo/i.test(msg)) return 'DATABASE_URL is not a valid connection string. It should start with postgresql:// and come from Supabase → Connect → Transaction pooler.';
  if (/ssl|certificate/i.test(msg)) return `Database SSL problem: ${msg}`;
  if (code.startsWith('08') || /connection/i.test(msg)) return `Could not connect to the database: ${msg}`;
  return null;
}

/** /api/health: is the API running, is DATABASE_URL set, can we reach the database? */
async function health(): Promise<Response> {
  const out: Record<string, unknown> = { api: 'running', databaseUrlSet: !!databaseUrl(), time: new Date().toISOString() };
  try {
    const db = await getDb();
    await db.execute(sql`SELECT 1`);
    out.database = 'connected';
    out.ok = true;
  } catch (e) {
    out.ok = false;
    out.database = 'error';
    out.problem = e instanceof GameError ? e.message : explainDbError(e) ?? String((e as Error)?.message ?? e);
  }
  return new Response(JSON.stringify(out, null, 2), { status: out.ok ? 200 : 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

export async function handle(req: Request, ip: string | null = null): Promise<Response> {
  const url = new URL(req.url);
  if (apiPath(url.pathname) === '/health') return health();
  const https = url.protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https';
  const c: Ctx = { req, url, params: {}, query: url.searchParams, body: undefined, ip, db: null as unknown as Db, https, cookies: parseCookies(req.headers.get('cookie')), setCookies: [], account: null, company: null };
  try {
    const path = apiPath(url.pathname);
    let match: Route | undefined;
    let m: RegExpExecArray | null = null;
    for (const r of routes) {
      if (r.method !== req.method) continue;
      m = r.re.exec(path);
      if (m) {
        match = r;
        break;
      }
    }
    // every visitor gets a CSRF cookie (double-submit: the page echoes it in a header)
    if (!c.cookies[CSRF_COOKIE]) {
      c.cookies[CSRF_COOKIE] = token(18);
      cookie(c, CSRF_COOKIE, c.cookies[CSRF_COOKIE], { httpOnly: false, maxAge: SESSION_TTL });
    }
    if (!match || !m) throw new GameError(404, 'not_found', 'No such API route.');
    match.keys.forEach((k, i) => (c.params[k] = decodeURIComponent(m![i + 1])));
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (req.headers.get('x-csrf-token') !== c.cookies[CSRF_COOKIE]) throw forbidden('Security check failed. Refresh the page and try again.', 'csrf');
      const text = await req.text();
      if (text) {
        try {
          c.body = JSON.parse(text);
        } catch {
          throw badRequest('That request was scrambled.', 'bad_json');
        }
      }
    }
    c.db = await getDb();
    await loadSession(c);
    if (match.auth !== 'public') {
      if (!c.account) throw unauthorized();
      if (c.account.mustChangePassword && !match.pw) throw forbidden('Pick a new password first.', 'must_change_password');
      if (match.auth === 'owner' && c.account.role !== 'OWNER') throw forbidden('Owner only.', 'owner_only');
      if (match.auth === 'company') {
        if (!c.company) throw forbidden('You are not part of a company.', 'no_company');
        if (c.company.status !== 'active') throw forbidden('This company is suspended by the Owner.', 'company_suspended');
      }
      for (const h of hooks) await h(c);
    }
    const out = await match.fn(c);
    return json(200, out, c.setCookies);
  } catch (e) {
    if (e instanceof GameError) return json(e.status, { error: e.code, message: e.message, ...e.extra }, c.setCookies);
    console.error('api error', e);
    const db = explainDbError(e);
    if (db) return json(503, { error: 'database', message: db }, c.setCookies);
    return json(500, { error: 'server_error', message: 'Something caught fire in the server room. 🔥' }, c.setCookies);
  }
}
