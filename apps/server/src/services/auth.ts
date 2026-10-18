import bcrypt from 'bcryptjs';
import { and, eq, gt, ne, sql } from 'drizzle-orm';
import { padAccountNumber, type Role } from '@dw/shared';
import { db, schema } from '../db';
import { newId, randomToken, sha256, friendlyPassword } from '../lib/ids';
import { clock, DAY_MS, MINUTE_MS } from '../lib/time';
import { GameError, badRequest, conflict, unauthorized } from '../lib/errors';
import { verifyTotp } from '../lib/totp';
import { env } from '../env';
import { audit } from './audit';

export const SESSION_TTL_MS = 7 * DAY_MS;
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * MINUTE_MS;
const BCRYPT_ROUNDS = env.isTest ? 4 : 11;

export type Account = typeof schema.accounts.$inferSelect;

export function hashPassword(pw: string): string {
  return bcrypt.hashSync(pw, BCRYPT_ROUNDS);
}
let _dummy: string | null = null;
const dummyHash = () => (_dummy ??= hashPassword('not-a-real-password'));
export function checkPassword(pw: string, hash: string): boolean {
  return bcrypt.compareSync(pw, hash);
}

export function getAccount(id: string): Account | undefined {
  return db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get();
}
export function getAccountByNumber(n: string): Account | undefined {
  return db.select().from(schema.accounts).where(eq(schema.accounts.accountNumber, n)).get();
}

/** Next free zero-padded account number ("02", "03", ...). */
export function nextAccountNumber(): string {
  const rows = db.select({ n: schema.accounts.accountNumber }).from(schema.accounts).all();
  const used = new Set(rows.map((r) => r.n));
  let max = 0;
  for (const r of rows) if (/^\d+$/.test(r.n)) max = Math.max(max, parseInt(r.n, 10));
  let n = max + 1;
  while (used.has(padAccountNumber(n))) n++;
  return padAccountNumber(n);
}

export function createAccount(input: {
  role: Role;
  accountNumber?: string;
  password?: string;
  displayName: string;
  companyId?: string | null;
  jobTitle?: string | null;
  mustChangePassword?: boolean;
  createdBy?: string | null;
  moderatorTools?: string[];
}): { account: Account; tempPassword: string } {
  const accountNumber = input.accountNumber ?? nextAccountNumber();
  if (!/^\d{2,8}$/.test(accountNumber)) throw badRequest('Account numbers are 2-8 digits, like "01".');
  if (getAccountByNumber(accountNumber)) throw conflict(`Account number ${accountNumber} is already taken.`, 'account_taken');
  const tempPassword = input.password ?? friendlyPassword();
  const account: Account = {
    id: newId('acc'),
    accountNumber,
    passwordHash: hashPassword(tempPassword),
    role: input.role,
    companyId: input.companyId ?? null,
    displayName: input.displayName,
    jobTitle: input.jobTitle ?? null,
    status: 'active',
    mustChangePassword: input.mustChangePassword ?? false,
    createdBy: input.createdBy ?? null,
    createdAt: clock.now(),
    lastLogin: null,
    lastSeen: null,
    failedLogins: 0,
    lockedUntil: null,
    totpSecret: null,
    totpEnabled: false,
    linkedGroup: null,
    moderatorTools: input.moderatorTools ?? null,
    settings: {},
    tutorialDone: false,
  };
  db.insert(schema.accounts).values(account).run();
  return { account, tempPassword };
}

export interface LoginResult {
  token: string;
  account: Account;
}

/**
 * Verify credentials and open a brand-new session (session id rotates on every login).
 * Repeated failures lock the account for LOCKOUT_MS.
 */
export function login(accountNumber: string, password: string, totp: string | undefined, meta: { ip?: string; userAgent?: string }): LoginResult {
  const acc = getAccountByNumber(accountNumber);
  const now = clock.now();
  // Same message for unknown account and bad password (no account enumeration).
  const fail = () => new GameError(401, 'bad_credentials', 'Badge rejected! Wrong account number or password.');
  if (!acc) {
    checkPassword(password, dummyHash()); // timing equaliser
    throw fail();
  }
  if (acc.lockedUntil && acc.lockedUntil > now) {
    const mins = Math.ceil((acc.lockedUntil - now) / MINUTE_MS);
    throw new GameError(423, 'locked', `Too many wrong guesses. The badge scanner is cooling off for ${mins} more minute(s).`);
  }
  if (!checkPassword(password, acc.passwordHash)) {
    const failed = acc.failedLogins + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    db.update(schema.accounts)
      .set({ failedLogins: lock ? 0 : failed, lockedUntil: lock ? now + LOCKOUT_MS : null })
      .where(eq(schema.accounts.id, acc.id))
      .run();
    if (lock) audit({ actorId: acc.id, action: 'auth.lockout', targetType: 'account', targetId: acc.id, ip: meta.ip });
    throw fail();
  }
  if (acc.status !== 'active') throw new GameError(403, 'suspended', `This badge is ${acc.status}. Talk to the Owner.`);
  if (acc.totpEnabled && acc.totpSecret) {
    if (!totp) throw new GameError(401, 'totp_required', 'Two-factor code required.');
    if (!verifyTotp(acc.totpSecret, totp, now)) throw fail();
  }
  const token = randomToken();
  db.insert(schema.sessions)
    .values({
      id: sha256(token),
      accountId: acc.id,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
      lastSeen: now,
      ip: meta.ip ?? null,
      userAgent: (meta.userAgent ?? '').slice(0, 200),
    })
    .run();
  db.update(schema.accounts).set({ failedLogins: 0, lockedUntil: null, lastLogin: now, lastSeen: now }).where(eq(schema.accounts.id, acc.id)).run();
  audit({ actorId: acc.id, action: 'auth.login', targetType: 'account', targetId: acc.id, ip: meta.ip });
  return { token, account: { ...acc, lastLogin: now } };
}

/** Look up a session by raw cookie token; slides expiry. */
export function sessionFromToken(token: string | undefined): { session: typeof schema.sessions.$inferSelect; account: Account } | null {
  if (!token) return null;
  const now = clock.now();
  const sid = sha256(token);
  const session = db.select().from(schema.sessions).where(and(eq(schema.sessions.id, sid), gt(schema.sessions.expiresAt, now))).get();
  if (!session) return null;
  const account = getAccount(session.accountId);
  if (!account || account.status !== 'active') return null;
  if (now - session.lastSeen > MINUTE_MS) {
    db.update(schema.sessions).set({ lastSeen: now, expiresAt: now + SESSION_TTL_MS }).where(eq(schema.sessions.id, sid)).run();
    db.update(schema.accounts).set({ lastSeen: now }).where(eq(schema.accounts.id, account.id)).run();
  }
  return { session, account };
}

export function logout(token: string | undefined) {
  if (!token) return;
  db.delete(schema.sessions).where(eq(schema.sessions.id, sha256(token))).run();
}

/** Force-logout: kill every session for an account (optionally keep one). */
export function revokeSessions(accountId: string, exceptSessionId?: string) {
  if (exceptSessionId) db.delete(schema.sessions).where(and(eq(schema.sessions.accountId, accountId), ne(schema.sessions.id, exceptSessionId))).run();
  else db.delete(schema.sessions).where(eq(schema.sessions.accountId, accountId)).run();
}

export function listSessions(accountId: string) {
  return db
    .select({ id: schema.sessions.id, createdAt: schema.sessions.createdAt, lastSeen: schema.sessions.lastSeen, ip: schema.sessions.ip, userAgent: schema.sessions.userAgent })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.accountId, accountId), gt(schema.sessions.expiresAt, clock.now())))
    .all()
    .map((s) => ({ ...s, id: s.id.slice(0, 12) }));
}

export function changePassword(accountId: string, current: string, next: string) {
  const acc = getAccount(accountId);
  if (!acc) throw unauthorized();
  if (!checkPassword(current, acc.passwordHash)) throw badRequest('Current password is wrong.', 'bad_password');
  if (current === next) throw badRequest('New password must be different. Nice try though.');
  db.update(schema.accounts).set({ passwordHash: hashPassword(next), mustChangePassword: false }).where(eq(schema.accounts.id, accountId)).run();
  audit({ actorId: accountId, action: 'auth.password_changed', targetType: 'account', targetId: accountId });
}

export function resetPassword(accountId: string, actorId: string, password?: string, mustChange = true): string {
  const pw = password ?? friendlyPassword();
  db.update(schema.accounts)
    .set({ passwordHash: hashPassword(pw), mustChangePassword: mustChange, failedLogins: 0, lockedUntil: null })
    .where(eq(schema.accounts.id, accountId))
    .run();
  revokeSessions(accountId);
  audit({ actorId, action: 'account.password_reset', targetType: 'account', targetId: accountId });
  return pw;
}

export function pruneSessions() {
  db.delete(schema.sessions).where(sql`${schema.sessions.expiresAt} < ${clock.now()}`).run();
}
