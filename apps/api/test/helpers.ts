import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { handle } from '../src/handler';
import { getDb, useDb, type Db } from '../src/db';
import * as schema from '../src/db/schema';
import { createCompany, ensureOwner } from '../src/services/accounts';
import { eq } from 'drizzle-orm';

let started = false;
/** One in-process Postgres per test file. */
export async function setup(): Promise<Db> {
  if (!started) {
    useDb(drizzle(new PGlite(), { schema }) as unknown as Db);
    started = true;
  }
  const db = await getDb();
  await ensureOwner(db);
  return db;
}

export interface Client {
  get: (path: string) => Promise<{ status: number; body: any }>;
  post: (path: string, body?: unknown) => Promise<{ status: number; body: any }>;
  patch: (path: string, body?: unknown) => Promise<{ status: number; body: any }>;
}

/** A browser-like client: keeps cookies and sends the CSRF header. */
export function client(): Client {
  const jar = new Map<string, string>();
  const call = async (method: string, path: string, body?: unknown) => {
    const headers = new Headers({ cookie: [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ') });
    if (method !== 'GET') {
      headers.set('content-type', 'application/json');
      headers.set('x-csrf-token', jar.get('dw_csrf') ?? '');
    }
    const res = await handle(new Request(`http://test/api${path}`, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) }));
    for (const sc of res.headers.getSetCookie()) {
      const [kv] = sc.split(';');
      const i = kv.indexOf('=');
      jar.set(kv.slice(0, i), decodeURIComponent(kv.slice(i + 1)));
    }
    return { status: res.status, body: await res.json() };
  };
  return {
    get: (p) => call('GET', p),
    post: async (p, b) => {
      if (!jar.has('dw_csrf')) await call('GET', '/auth/me');
      return call('POST', p, b);
    },
    patch: async (p, b) => {
      if (!jar.has('dw_csrf')) await call('GET', '/auth/me');
      return call('PATCH', p, b);
    },
  };
}

export async function loginAs(number: string, password: string) {
  const c = client();
  const r = await c.post('/auth/login', { number, password });
  if (r.status !== 200) throw new Error(`login ${number} failed: ${JSON.stringify(r.body)}`);
  return c;
}

let n = 0;
/** Make a company with a known admin login; returns its id and a logged-in client. */
export async function makeCompany(db: Db, industry: string, opts: { grant?: number; name?: string } = {}) {
  n++;
  const owner = (await db.select().from(schema.accounts).where(eq(schema.accounts.role, 'OWNER')))[0];
  const number = String(100 + n + Math.floor(Math.random() * 800));
  const r = await createCompany(db, owner.id, { name: opts.name ?? `Test Co ${n} ${number}`, emoji: '🧪', color: '#123456', industry, adminName: 'Boss', number, password: 'pass1234', grant: opts.grant });
  return { id: r.id, client: await loginAs(number, 'pass1234') };
}
