import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Express } from 'express';
import { setupGame, makeCompany, login } from './helpers';
import { db, schema } from '../src/db';
import * as packages from '../src/services/packages';
import { balanceOf, verifyLedger, SYS } from '../src/services/ledger';
import { companyWallet } from '../src/services/money';
import { setFlag } from '../src/services/flags';
import { clock } from '../src/lib/time';

let app: Express;
const base = { emoji: '📦', message: 'Found it!', mystery: false, expiresInDays: null, targetCompanyId: null };

describe('real-life packages', () => {
  beforeAll(() => {
    app = setupGame();
  });

  it('codes are typeable and normalise from messy input or a scanned URL', () => {
    const c = packages.makeCode();
    expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(packages.normalizeCode(c.toLowerCase().replace('-', ' '))).toBe(c);
    expect(packages.normalizeCode(`https://game.example/redeem/${c}`)).toBe(c);
  });

  it('opening pays Bits from the Treasury, gives pods + decor, and only once per company', () => {
    const { company, account } = makeCompany({ name: 'Unboxer' });
    const { codes } = packages.createBatch({ ...base, name: 'Birthday Box', cards: 1, maxClaims: 5, contents: { bits: 1000, pods: [{ type: 'basic', count: 1 }], items: ['rubber-duck'], boost: { mult: 1.5, minutes: 10 } } }, 'owner');
    const treasury = balanceOf(SYS.TREASURY);
    const bal = balanceOf(companyWallet(company.id));
    const workers = db.select().from(schema.workers).where(eq(schema.workers.companyId, company.id)).all().length;
    const r = packages.redeem(company.id, account.id, codes[0]);
    expect(r.got.length).toBe(4);
    expect(balanceOf(companyWallet(company.id))).toBe(bal + 1000);
    expect(balanceOf(SYS.TREASURY)).toBe(treasury - 1000);
    expect(db.select().from(schema.workers).where(eq(schema.workers.companyId, company.id)).all().length).toBe(workers + 1);
    expect(db.select().from(schema.items).where(eq(schema.items.companyId, company.id)).all().some((i) => i.itemKey === 'rubber-duck')).toBe(true);
    expect(() => packages.redeem(company.id, account.id, codes[0])).toThrow(/already opened/);
    expect(verifyLedger().sum).toBe(0);
  });

  it('respects max claims, target company, expiry and void', () => {
    const a = makeCompany({ name: 'Pkg A' });
    const b = makeCompany({ name: 'Pkg B' });
    const single = packages.createBatch({ ...base, name: 'Solo', cards: 1, maxClaims: 1, contents: { bits: 10 } }, 'owner').codes[0];
    packages.redeem(a.company.id, a.account.id, single);
    expect(() => packages.redeem(b.company.id, b.account.id, single)).toThrow(/used up/);
    const addressed = packages.createBatch({ ...base, name: 'For A', cards: 1, maxClaims: 9, targetCompanyId: a.company.id, contents: { bits: 10 } }, 'owner').codes[0];
    expect(() => packages.redeem(b.company.id, b.account.id, addressed)).toThrow(/different company/);
    const expiring = packages.createBatch({ ...base, name: 'Old', cards: 1, maxClaims: 9, expiresInDays: 1, contents: { bits: 10 } }, 'owner').codes[0];
    clock.set(clock.now() + 2 * 86400_000);
    expect(() => packages.redeem(b.company.id, b.account.id, expiring)).toThrow(/expired/);
    clock.set(null);
    const batch = packages.createBatch({ ...base, name: 'Void me', cards: 3, maxClaims: 9, contents: { bits: 10 } }, 'owner');
    packages.voidPackages({ batchId: batch.batchId }, 'owner');
    expect(() => packages.redeem(b.company.id, b.account.id, batch.codes[1])).toThrow(/does not match/);
  });

  it('mystery packages hide their contents until opened; the flag switches it all off', () => {
    const a = makeCompany({ name: 'Peeker' });
    const code = packages.createBatch({ ...base, name: 'Mystery', mystery: true, cards: 1, maxClaims: 1, contents: { bits: 50 } }, 'owner').codes[0];
    expect(packages.peek(a.company.id, a.account.id, code).contents).toBeNull();
    setFlag('realPackages', false);
    expect(() => packages.redeem(a.company.id, a.account.id, code)).toThrow(/switched off/);
    setFlag('realPackages', true);
  });

  it('wrong guesses are limited through the API', async () => {
    const { account } = makeCompany({ name: 'Guesser', accountNumber: '99940', password: 'guess123' });
    const p = await login(app, account.accountNumber, 'guess123');
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await p.post('/api/game/packages/redeem', { code: 'ZZZZ-ZZZZ' })).status;
    expect(last).toBe(403);
    const owner = await login(app, '01', 'Diddy');
    expect((await owner.get('/api/owner/packages')).status).toBe(200);
    expect((await p.get('/api/owner/packages')).status).toBe(403);
  });
});
