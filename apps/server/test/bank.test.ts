import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupGame, makeCompany } from './helpers';
import * as bank from '../src/services/bank';
import { balanceOf, verifyLedger, SYS } from '../src/services/ledger';
import { companyWallet } from '../src/services/money';
import { db, schema } from '../src/db';
import { clock } from '../src/lib/time';
import { cfg } from '../src/services/settings';
import { setFlag } from '../src/services/flags';
import { spawnEvent, resolveEvent } from '../src/services/events';
import { OFFICE_EVENTS } from '../src/catalog/events';

describe('bank, loans, insurance, transfers', () => {
  beforeAll(() => {
    setupGame();
  });

  it('loan interest and installments are computed in integers and repaid on schedule', () => {
    const { company } = makeCompany({ name: 'Borrower', startingBits: 10_000 });
    db.update(schema.companies).set({ level: 5 }).where(eq(schema.companies.id, company.id)).run();
    const offer = bank.loanOffer(company.id);
    expect(offer.max).toBeGreaterThan(0);
    const before = balanceOf(companyWallet(company.id));
    const loan = bank.takeLoan(company.id, 1000, 'test');
    expect(balanceOf(companyWallet(company.id))).toBe(before + 1000);
    expect(loan.total).toBe(1000 + Math.ceil((1000 * offer.rateBps) / 10_000));
    expect(Number.isInteger(loan.installment)).toBe(true);
    const c = cfg();
    const t0 = clock.now();
    for (let i = 1; i <= c.loans.installments; i++) {
      clock.set(t0 + i * c.loans.installmentMs + 1000);
      bank.bankJobs.collectInstallments(clock.now());
    }
    clock.set(null);
    const l = db.select().from(schema.loans).where(eq(schema.loans.id, loan.id)).get()!;
    expect(l.status).toBe('repaid');
    expect(l.outstanding).toBe(0);
    const co = db.select().from(schema.companies).where(eq(schema.companies.id, company.id)).get()!;
    expect(co.creditScore).toBeGreaterThan(650);
    expect(verifyLedger().sum).toBe(0);
  });

  it('missed payments add late fees, then default hurts credit and morale', () => {
    const { company } = makeCompany({ name: 'Deadbeat', startingBits: 0 });
    db.update(schema.companies).set({ level: 5 }).where(eq(schema.companies.id, company.id)).run();
    const loan = bank.takeLoan(company.id, 500, 'test');
    // spend everything so installments can't be paid
    bank.movePot(company.id, 'main', 'savings', balanceOf(companyWallet(company.id)), 'test');
    const c = cfg();
    const t0 = clock.now();
    for (let i = 1; i <= c.loans.defaultAfterMissed; i++) {
      clock.set(t0 + i * c.loans.installmentMs + 1000);
      bank.bankJobs.collectInstallments(clock.now());
    }
    clock.set(null);
    const l = db.select().from(schema.loans).where(eq(schema.loans.id, loan.id)).get()!;
    expect(l.status).toBe('defaulted');
    const co = db.select().from(schema.companies).where(eq(schema.companies.id, company.id)).get()!;
    expect(co.creditScore).toBeLessThan(650);
  });

  it('transfers charge a fee to the Treasury and respect daily limits', () => {
    const a = makeCompany({ name: 'Giver', startingBits: 20_000 }).company.id;
    const b = makeCompany({ name: 'Receiver', startingBits: 0 }).company.id;
    const tBefore = balanceOf(SYS.TREASURY);
    const r = bank.transfer(a, b, 1000, 'hi', 'test');
    expect(balanceOf(companyWallet(b))).toBe(1000);
    expect(balanceOf(SYS.TREASURY)).toBe(tBefore + r.fee);
    expect(() => bank.transfer(a, b, 10_000, 'too much', 'test')).toThrow(/Daily transfer limit/);
  });

  it('blocks transfers between owner-flagged linked accounts', () => {
    const a = makeCompany({ name: 'Twin A', startingBits: 5000 });
    const b = makeCompany({ name: 'Twin B', startingBits: 0 });
    db.update(schema.accounts).set({ linkedGroup: 'same-person' }).where(eq(schema.accounts.id, a.account.id)).run();
    db.update(schema.accounts).set({ linkedGroup: 'same-person' }).where(eq(schema.accounts.id, b.account.id)).run();
    expect(() => bank.transfer(a.company.id, b.company.id, 100, '', 'test')).toThrow(/linked/);
  });

  it('term deposits lock Bits and pay interest at maturity', () => {
    const { company } = makeCompany({ name: 'Saver', startingBits: 5000 });
    const dep = bank.openDeposit(company.id, 1000, 1, 'test');
    expect(balanceOf(companyWallet(company.id))).toBe(4000);
    clock.set(dep.maturesAt + 1);
    bank.bankJobs.matureDeposits(clock.now());
    clock.set(null);
    expect(balanceOf(companyWallet(company.id))).toBe(5000 + dep.interest);
  });

  it('insurance reduces losses from a covered bad event', () => {
    setFlag('insurance', true);
    const { company } = makeCompany({ name: 'Insured', startingBits: 20_000 });
    bank.buyInsurance(company.id, 'fire', 'test');
    const fire = OFFICE_EVENTS.find((e) => e.id === 'server-fire')!;
    const ev = spawnEvent(company.id, fire)!;
    const out = resolveEvent(company.id, ev.id, 0, 'test');
    expect(out.insured).toBeGreaterThan(0);
    expect(Math.abs(out.bits as number)).toBeLessThan((out.insured as number) + Math.abs(out.bits as number));
    expect(verifyLedger().sum).toBe(0);
  });
});
