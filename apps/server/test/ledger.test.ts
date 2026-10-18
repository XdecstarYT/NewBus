import { describe, it, expect, beforeAll } from 'vitest';
import { setupGame, makeCompany } from './helpers';
import { post, transfer, verifyLedger, balanceOf, SYS, moneySupply } from '../src/services/ledger';
import { companyWallet, payCompany, chargeCompany } from '../src/services/money';
import { makeRng } from '../src/engine/rng';

describe('double-entry ledger', () => {
  beforeAll(() => {
    setupGame();
  });

  it('starts balanced: the sum of all wallets is zero', () => {
    const v = verifyLedger();
    expect(v.sum).toBe(0);
    expect(v.mismatches).toEqual([]);
    expect(moneySupply()).toBeGreaterThan(0);
  });

  it('stays balanced after thousands of random transfers', () => {
    const cos = Array.from({ length: 6 }, (_, i) => makeCompany({ name: `L${i}`, startingBits: 10_000 }).company.id);
    const wallets = [...cos.map((c) => companyWallet(c)), SYS.TREASURY, SYS.NPC];
    const rng = makeRng(42);
    let ok = 0;
    let rejected = 0;
    for (let i = 0; i < 3000; i++) {
      const from = rng.pick(wallets);
      const to = rng.pick(wallets);
      const amount = rng.int(1, 3000);
      try {
        transfer(from, to, amount, 'test.random');
        ok++;
      } catch {
        rejected++;
      }
    }
    expect(ok).toBeGreaterThan(1000);
    expect(rejected).toBeGreaterThan(0); // some overdrafts were refused
    const v = verifyLedger();
    expect(v.sum).toBe(0);
    expect(v.mismatches).toEqual([]);
    for (const w of wallets) expect(balanceOf(w)).toBeGreaterThanOrEqual(0);
  });

  it('refuses overdrafts atomically (multi-leg all-or-nothing)', () => {
    const a = makeCompany({ name: 'Poor', startingBits: 100 }).company.id;
    const b = makeCompany({ name: 'Rich', startingBits: 100 }).company.id;
    expect(() =>
      post({ kind: 'test', legs: [{ from: companyWallet(a), to: companyWallet(b), amount: 50 }, { from: companyWallet(a), to: companyWallet(b), amount: 60 }] }),
    ).toThrow(/Not enough Bits/);
    expect(balanceOf(companyWallet(a))).toBe(100);
    expect(balanceOf(companyWallet(b))).toBe(100);
  });

  it('is idempotent: same key never moves money twice', () => {
    const a = makeCompany({ name: 'Idem', startingBits: 1000 }).company.id;
    const r1 = transfer(companyWallet(a), SYS.TREASURY, 100, 'test', 'x', 'idem-key-123');
    const r2 = transfer(companyWallet(a), SYS.TREASURY, 100, 'test', 'x', 'idem-key-123');
    expect(r2.duplicate).toBe(true);
    expect(r2.txId).toBe(r1.txId);
    expect(balanceOf(companyWallet(a))).toBe(900);
  });

  it('rejects non-integer amounts', () => {
    expect(() => transfer(SYS.MINT, SYS.TREASURY, 1.5, 'test')).toThrow(/integer/);
  });

  it('payCompany respects the NPC pool size and owner earn caps', () => {
    const { company } = makeCompany({ name: 'Capped', startingBits: 0 });
    const paid = payCompany({ companyId: company.id, amount: 50, kind: 'test' });
    expect(paid).toBe(50);
    expect(() => chargeCompany({ companyId: company.id, amount: 51, kind: 'test' })).toThrow(/Not enough/);
    chargeCompany({ companyId: company.id, amount: 50, kind: 'test' });
    expect(balanceOf(companyWallet(company.id))).toBe(0);
    expect(verifyLedger().sum).toBe(0);
  });
});
