import { describe, it, expect, beforeAll } from 'vitest';
import type { Express } from 'express';
import { setupGame, agent, login, makeCompany } from './helpers';
import { MAX_FAILED_LOGINS, getAccountByNumber } from '../src/services/auth';
import { clock } from '../src/lib/time';
import { db, schema } from '../src/db';
import { eq } from 'drizzle-orm';

let app: Express;
describe('auth & sessions', () => {
  beforeAll(() => {
    app = setupGame();
  });

  it('seeds the owner as account "01" (a zero-padded string)', () => {
    const owner = getAccountByNumber('01');
    expect(owner?.role).toBe('OWNER');
    expect(getAccountByNumber('1')).toBeUndefined();
    expect(owner!.passwordHash).not.toContain('Diddy');
  });

  it('logs in with 01 / Diddy and reads /me', async () => {
    const a = await login(app, '01', 'Diddy');
    const me = await a.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.account.accountNumber).toBe('01');
    expect(me.body.account.role).toBe('OWNER');
  });

  it('rejects bad passwords with a generic message', async () => {
    const a = await agent(app);
    const r = await a.post('/api/auth/login', { accountNumber: '01', password: 'nope' });
    expect(r.status).toBe(401);
    const r2 = await a.post('/api/auth/login', { accountNumber: '99', password: 'nope' });
    expect(r2.status).toBe(401);
    expect(r2.body.message).toBe(r.body.message);
  });

  it('requires a CSRF token for writes', async () => {
    const request = (await import('supertest')).default;
    const r = await request(app).post('/api/auth/login').send({ accountNumber: '01', password: 'Diddy' });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('csrf');
  });

  it('locks the badge after repeated failures, then unlocks after the timeout', async () => {
    makeCompany({ name: 'Lockme', accountNumber: '50', password: 'right-pass' });
    const a = await agent(app);
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) await a.post('/api/auth/login', { accountNumber: '50', password: 'wrong' });
    const locked = await a.post('/api/auth/login', { accountNumber: '50', password: 'right-pass' });
    expect(locked.status).toBe(423);
    clock.advance(16 * 60_000);
    const ok = await a.post('/api/auth/login', { accountNumber: '50', password: 'right-pass' });
    expect(ok.status).toBe(200);
    clock.set(null);
  });

  it('rotates the session id on every login and supports force logout', async () => {
    makeCompany({ name: 'Rotator', accountNumber: '51', password: 'pw-51-pw' });
    const a1 = await login(app, '51', 'pw-51-pw');
    const a2 = await login(app, '51', 'pw-51-pw');
    const acc = getAccountByNumber('51')!;
    const sessions = db.select().from(schema.sessions).where(eq(schema.sessions.accountId, acc.id)).all();
    expect(new Set(sessions.map((s) => s.id)).size).toBe(sessions.length);
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    const owner = await login(app, '01', 'Diddy');
    expect((await owner.post(`/api/owner/accounts/${acc.id}/logout`)).status).toBe(200);
    expect((await a1.get('/api/auth/me')).status).toBe(401);
    expect((await a2.get('/api/auth/me')).status).toBe(401);
  });

  it('forces a password change when the owner says so', async () => {
    makeCompany({ name: 'Newbie', accountNumber: '52', password: 'temp-pass', mustChangePassword: true });
    const a = await login(app, '52', 'temp-pass');
    const me = await a.get('/api/auth/me');
    expect(me.body.account.mustChangePassword).toBe(true);
    const blocked = await a.put('/api/auth/settings', { theme: 'dark' });
    expect(blocked.status).toBe(200); // auth paths still work
    const ch = await a.post('/api/auth/change-password', { currentPassword: 'temp-pass', newPassword: 'brand-new-pass' });
    expect(ch.status).toBe(200);
    expect(ch.body.account.mustChangePassword).toBe(false);
    await login(app, '52', 'brand-new-pass');
  });

  it('non-owners cannot reach the owner panel', async () => {
    makeCompany({ name: 'Sneaky', accountNumber: '53', password: 'sneaky-pw' });
    const a = await login(app, '53', 'sneaky-pw');
    const r = await a.get('/api/owner/companies');
    expect(r.status).toBe(403);
  });
});
