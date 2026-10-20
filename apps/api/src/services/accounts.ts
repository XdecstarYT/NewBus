/** Accounts, logins, sessions, companies and staff. */
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { isFacility, type FacilityId } from '@dw/shared/live';
import { schema, type Db } from '../db';
import type { Account, Ctx } from '../http/router';
import { cookie, SESSION_COOKIE, SESSION_TTL } from '../http/router';
import { clock, MINUTE } from '../lib/time';
import { newId, sha256, token } from '../lib/ids';
import { badRequest, conflict, forbidden, GameError, notFound } from '../lib/errors';
import { addNews, audit, getSettings, notify } from './core';
import { pay, W } from './money';
import { addItem } from './stock';

// Bundled as ESM (Netlify), bcryptjs can't require('crypto') itself, so hand it Node's generator.
bcrypt.setRandomFallback((n: number) => Array.from(randomBytes(n)));

const ROUNDS = 10;
export const hashPassword = (pw: string) => bcrypt.hashSync(pw, ROUNDS);
let dummy: string | null = null;
const DUMMY = () => (dummy ??= hashPassword('not-a-real-password'));

const WORDS = ['otter', 'pickle', 'rocket', 'waffle', 'cactus', 'banjo', 'noodle', 'comet', 'mango', 'turbo', 'pebble', 'zebra'];
export function tempPassword() {
  const w = WORDS[Math.floor(Math.random() * WORDS.length)];
  return `${w}-${Math.floor(1000 + Math.random() * 9000)}`;
}

/** "1" and "01" are the same account. */
export function normalizeNumber(raw: string) {
  const s = String(raw ?? '').trim();
  return /^\d$/.test(s) ? `0${s}` : s;
}

// ------------------------------------------------------------ owner
let ownerChecked = false;
/** Make sure the Owner account exists (number + password from the environment, default 01 / Diddy). */
export async function ensureOwner(db: Db) {
  if (ownerChecked) return;
  const number = normalizeNumber(process.env.OWNER_ACCOUNT_NUMBER || '01');
  const password = (process.env.OWNER_PASSWORD || 'Diddy').trim();
  const found = await db.select().from(schema.accounts).where(eq(schema.accounts.role, 'OWNER')).limit(1);
  const now = clock.now();
  if (!found.length) {
    await db
      .insert(schema.accounts)
      .values({ id: newId('acc'), number, passwordHash: hashPassword(password), role: 'OWNER', companyId: null, name: 'The Owner', mustChangePassword: password === 'Diddy', energyAt: now, createdAt: now })
      .onConflictDoNothing();
  } else if (process.env.OWNER_RESET_PASSWORD === 'true') {
    await db.update(schema.accounts).set({ passwordHash: hashPassword(password), failedLogins: 0, lockedUntil: null, status: 'active' }).where(eq(schema.accounts.id, found[0].id));
  }
  ownerChecked = true;
}

// ------------------------------------------------------------ sessions
export async function login(c: Ctx, number: string, password: string) {
  await ensureOwner(c.db);
  const now = clock.now();
  const r = await c.db.select().from(schema.accounts).where(eq(schema.accounts.number, normalizeNumber(number))).limit(1);
  const acc = r[0];
  if (!acc) {
    bcrypt.compareSync(password, DUMMY()); // same timing either way
    throw new GameError(401, 'bad_login', 'That account number and password do not match.');
  }
  if (acc.lockedUntil && acc.lockedUntil > now) throw new GameError(429, 'locked', `Too many wrong passwords. Try again in ${Math.ceil((acc.lockedUntil - now) / MINUTE)} min.`);
  const ok = bcrypt.compareSync(password, acc.passwordHash) || bcrypt.compareSync(password.trim(), acc.passwordHash);
  if (!ok) {
    const fails = acc.failedLogins + 1;
    await c.db.update(schema.accounts).set({ failedLogins: fails >= 5 ? 0 : fails, lockedUntil: fails >= 5 ? now + 15 * MINUTE : null }).where(eq(schema.accounts.id, acc.id));
    throw new GameError(401, 'bad_login', 'That account number and password do not match.');
  }
  if (acc.status !== 'active') throw forbidden('This login is switched off. Ask your company admin or the Owner.', 'disabled');
  if (acc.companyId) {
    const co = await c.db.select({ s: schema.companies.status }).from(schema.companies).where(eq(schema.companies.id, acc.companyId));
    if (co[0]?.s !== 'active') throw forbidden('This company is suspended by the Owner.', 'company_suspended');
  }
  const t = token();
  await c.db.insert(schema.sessions).values({ id: sha256(t), accountId: acc.id, createdAt: now, expiresAt: now + SESSION_TTL, lastSeen: now, ip: c.ip });
  await c.db.update(schema.accounts).set({ failedLogins: 0, lockedUntil: null, lastSeen: now }).where(eq(schema.accounts.id, acc.id));
  cookie(c, SESSION_COOKIE, t, { maxAge: SESSION_TTL });
  return acc;
}

export async function logout(c: Ctx) {
  const t = c.cookies[SESSION_COOKIE];
  if (t) await c.db.delete(schema.sessions).where(eq(schema.sessions.id, sha256(t)));
  cookie(c, SESSION_COOKIE, '', { maxAge: 0 });
}

export async function changePassword(db: Db, account: Account, current: string, next: string) {
  if (!bcrypt.compareSync(current, account.passwordHash)) throw badRequest('Your current password is wrong.', 'bad_password');
  if (next.length < 6) throw badRequest('Pick at least 6 characters.');
  if (next === current) throw badRequest('Pick a different password.');
  await db.update(schema.accounts).set({ passwordHash: hashPassword(next), mustChangePassword: false }).where(eq(schema.accounts.id, account.id));
}

export async function resetPassword(db: Db, accountId: string, actorId: string) {
  const pw = tempPassword();
  await db.update(schema.accounts).set({ passwordHash: hashPassword(pw), mustChangePassword: true, failedLogins: 0, lockedUntil: null }).where(eq(schema.accounts.id, accountId));
  await db.delete(schema.sessions).where(eq(schema.sessions.accountId, accountId));
  await audit(db, actorId, 'account.reset_password', accountId);
  return pw;
}

// ------------------------------------------------------------ numbers
export async function nextNumber(db: Db) {
  const r = await db.select({ n: sql<string>`coalesce(max(case when ${schema.accounts.number} ~ '^[0-9]+$' then ${schema.accounts.number}::int end), 1)` }).from(schema.accounts);
  return String(Number(r[0].n) + 1).padStart(2, '0');
}

async function newLogin(db: Db, o: { companyId: string | null; role: 'ADMIN' | 'STAFF'; name: string; number?: string; password?: string }) {
  const number = o.number ? normalizeNumber(o.number) : await nextNumber(db);
  if ((await db.select({ id: schema.accounts.id }).from(schema.accounts).where(eq(schema.accounts.number, number))).length) throw conflict(`Account number ${number} is taken.`);
  const password = o.password?.trim() || tempPassword();
  const now = clock.now();
  const id = newId('acc');
  await db.insert(schema.accounts).values({ id, number, passwordHash: hashPassword(password), role: o.role, companyId: o.companyId, name: o.name.trim().slice(0, 40) || 'Player', mustChangePassword: !o.password, energy: 100, energyAt: now, createdAt: now });
  return { id, number, password };
}

// ------------------------------------------------------------ companies
export interface NewCompany {
  name: string;
  emoji: string;
  color: string;
  slogan?: string;
  industry: string;
  adminName: string;
  number?: string;
  password?: string;
  grant?: number;
}

export async function createCompany(db: Db, actorId: string, o: NewCompany) {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    if (!isFacility(o.industry)) throw badRequest('Pick an industry.');
    const name = o.name.trim();
    if (name.length < 2) throw badRequest('Company names need at least 2 letters.');
    if ((await t.select({ id: schema.companies.id }).from(schema.companies).where(sql`lower(${schema.companies.name}) = lower(${name})`)).length) throw conflict('That company name is taken.');
    const now = clock.now();
    const id = newId('co');
    await t.insert(schema.companies).values({ id, name, emoji: o.emoji || '🏢', color: o.color || '#7c3aed', slogan: (o.slogan ?? '').slice(0, 120), industry: o.industry, createdAt: now });
    await t.insert(schema.facilities).values({ companyId: id, type: o.industry as FacilityId, level: 1, createdAt: now });
    const login = await newLogin(t, { companyId: id, role: 'ADMIN', name: o.adminName, number: o.number, password: o.password });
    const grant = Math.max(0, Math.floor(o.grant ?? (await getSettings(t)).startingGrant));
    if (grant) await pay(t, W.mint, W.company(id), grant, 'grant.start', `Starting grant for ${name}`, actorId);
    await addItem(t, id, 'bread', 6); // something to eat on day one
    await audit(t, actorId, 'company.create', id, { name, industry: o.industry, grant });
    await addNews(t, 'company', `${o.emoji || '🏢'} ${name} opens for business!`, o.slogan ?? '', id);
    return { id, name, admin: { number: login.number, password: login.password }, grant };
  });
}

export async function addStaff(db: Db, companyId: string, actor: Account, name: string) {
  if (actor.role !== 'ADMIN' && actor.role !== 'OWNER') throw forbidden('Only the company admin can add logins.');
  const n = (await db.select({ n: sql<number>`count(*)::int` }).from(schema.accounts).where(eq(schema.accounts.companyId, companyId)))[0].n;
  if (n >= 12) throw conflict('A company can have up to 12 logins.');
  const login = await newLogin(db, { companyId, role: 'STAFF', name });
  await audit(db, actor.id, 'staff.create', login.id, { companyId });
  await notify(db, { companyId }, 'team', `👋 ${name} joined the team`, `Login ${login.number}`);
  return login;
}

export async function setStaffStatus(db: Db, companyId: string, actor: Account, accountId: string, active: boolean) {
  if (actor.role !== 'ADMIN' && actor.role !== 'OWNER') throw forbidden('Only the company admin can do that.');
  const r = await db.select().from(schema.accounts).where(and(eq(schema.accounts.id, accountId), eq(schema.accounts.companyId, companyId)));
  if (!r[0]) throw notFound('No such login in your company.');
  if (r[0].role === 'ADMIN') throw badRequest('You can not switch off the admin login.');
  await db.update(schema.accounts).set({ status: active ? 'active' : 'disabled' }).where(eq(schema.accounts.id, accountId));
  if (!active) await db.delete(schema.sessions).where(eq(schema.sessions.accountId, accountId));
}

export async function teamOf(db: Db, companyId: string) {
  return db
    .select({ id: schema.accounts.id, number: schema.accounts.number, name: schema.accounts.name, role: schema.accounts.role, status: schema.accounts.status, xp: schema.accounts.xp, lastSeen: schema.accounts.lastSeen })
    .from(schema.accounts)
    .where(eq(schema.accounts.companyId, companyId));
}
