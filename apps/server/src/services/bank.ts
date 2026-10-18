/**
 * Bit Bank: wallet pots (main/payroll/savings/investing), savings interest,
 * term deposits, transfers/gifting, staff payroll, loans (Treasury + peer),
 * credit score, insurance, wealth tax, Bit Lotto.
 */
import { and, desc, eq, inArray, like, lte, or, sql } from 'drizzle-orm';
import { db, schema, atomic, sqlite } from '../db';
import { cfg } from './settings';
import { clock, dayKey } from '../lib/time';
import { newId } from '../lib/ids';
import { SYS, post, balanceOf, walletId } from './ledger';
import { companyWallet, accountWallet, chargeCompany, payCompany } from './money';
import { getCompany } from './companies';
import { getCompanyPermissions } from '../permissions';
import { getAccount } from './auth';
import { flag } from './flags';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { bump, today } from './stats';
import { notify } from './notifications';
import { audit } from './audit';
import { liveRng } from '../engine/rng';
import { toCompany as pushToCompany } from '../lib/bus';
import { recordFlag } from './anticheat';

const POTS = ['main', 'payroll', 'savings', 'investing'] as const;

export function bankView(companyId: string) {
  const c = cfg();
  const co = getCompany(companyId);
  const pots = Object.fromEntries(POTS.map((p) => [p, balanceOf(companyWallet(companyId, p))]));
  const deposits = db.select().from(schema.savings).where(eq(schema.savings.companyId, companyId)).orderBy(desc(schema.savings.startsAt)).limit(20).all();
  const policies = db.select().from(schema.insurancePolicies).where(eq(schema.insurancePolicies.companyId, companyId)).orderBy(desc(schema.insurancePolicies.createdAt)).limit(10).all();
  const perms = getCompanyPermissions(companyId);
  return {
    pots,
    savingsRateBpsPerDay: c.bank.savingsRateBpsPerDay,
    savingsMax: c.bank.savingsMaxBalance,
    termOptions: c.bank.termOptions,
    deposits,
    insurance: { enabled: flag('insurance'), kinds: c.insurance.kinds, policies, durationMs: c.insurance.durationMs, payoutRatio: c.insurance.payoutRatio },
    transfer: {
      feeBps: c.economy.transferFeeBps,
      maxPerDay: perms.limits.maxTransferPerDay,
      sentToday: today(companyId, 'transferred'),
      recipients: perms.limits.transferRecipients,
    },
    lotto: { enabled: flag('lotto'), ...c.lotto, boughtToday: today(companyId, 'lotto') },
    creditScore: co.creditScore,
    wealthTax: { threshold: c.economy.wealthTaxThreshold, bpsPerDay: c.economy.wealthTaxBpsPerDay },
  };
}

export function movePot(companyId: string, from: string, to: string, amount: number, actorId: string, idempotencyKey?: string) {
  if (from === to) throw badRequest('Moving Bits to the same pot is a very short trip.');
  if (!POTS.includes(from as any) || !POTS.includes(to as any)) throw badRequest('Unknown pot.');
  const c = cfg();
  if (to === 'savings' && balanceOf(companyWallet(companyId, 'savings')) + amount > c.bank.savingsMaxBalance) throw badRequest(`Savings pot is capped at ${c.bank.savingsMaxBalance.toLocaleString()} BT.`);
  return post({ kind: 'bank.pot_move', memo: `${from} -> ${to}`, idempotencyKey, actorId, legs: [{ from: companyWallet(companyId, from), to: companyWallet(companyId, to), amount }] });
}

// ------------------------------------------------------------ term deposits
export function openDeposit(companyId: string, amount: number, hours: number, actorId: string) {
  return atomic(() => {
    const opt = cfg().bank.termOptions.find((o) => o.hours === hours);
    if (!opt) throw badRequest('Pick one of the offered terms.');
    const now = clock.now();
    const id = newId('dep');
    // locked Bits sit in a dedicated escrow wallet so they're out of reach until maturity
    post({ kind: 'bank.deposit', memo: `${hours}h term deposit`, actorId, legs: [{ from: companyWallet(companyId), to: walletId('company', companyId, `term-${id}`), amount }] });
    db.insert(schema.savings).values({ id, companyId, kind: 'term', amount, rateBps: opt.rateBps, startsAt: now, maturesAt: now + hours * 3600_000, status: 'active' }).run();
    bump(companyId, 'deposits');
    return { id, maturesAt: now + hours * 3600_000, interest: Math.floor((amount * opt.rateBps) / 10_000) };
  });
}

function matureDeposits(now: number) {
  const due = db.select().from(schema.savings).where(and(eq(schema.savings.status, 'active'), lte(schema.savings.maturesAt, now))).all();
  for (const d of due) {
    atomic(() => {
      const interest = Math.floor((d.amount * d.rateBps) / 10_000);
      post({ kind: 'bank.deposit_return', legs: [{ from: walletId('company', d.companyId, `term-${d.id}`), to: companyWallet(d.companyId), amount: d.amount }] });
      if (interest > 0) payCompany({ companyId: d.companyId, amount: interest, from: SYS.TREASURY, kind: 'income.interest', memo: 'Term deposit interest', partial: true, earn: true });
      db.update(schema.savings).set({ status: 'paid' }).where(eq(schema.savings.id, d.id)).run();
      notify(d.companyId, 'bank', `🏦 Term deposit matured: +${interest} BT interest`, 'Your Bits are back in your main wallet.');
    });
  }
}

/** Savings pot interest, paid periodically from the Treasury. */
function paySavingsInterest() {
  const c = cfg();
  const periods = (24 * 3600_000) / c.bank.interestPayoutMs;
  const rows = sqlite.prepare(`SELECT owner_id AS companyId, balance FROM wallets WHERE owner_type='company' AND pot='savings' AND balance > 0`).all() as Array<{ companyId: string; balance: number }>;
  for (const r of rows) {
    const interest = Math.floor((Math.min(r.balance, c.bank.savingsMaxBalance) * c.bank.savingsRateBpsPerDay) / 10_000 / periods);
    if (interest > 0) {
      try {
        post({ kind: 'income.interest', memo: 'Savings interest', legs: [{ from: SYS.TREASURY, to: companyWallet(r.companyId, 'savings'), amount: interest }] });
        bump(r.companyId, 'interest', interest);
      } catch {}
    }
  }
}

// ------------------------------------------------------------ transfers & gifting
function linkedGroups(companyId: string): Set<string> {
  return new Set(
    db
      .select({ g: schema.accounts.linkedGroup })
      .from(schema.accounts)
      .where(eq(schema.accounts.companyId, companyId))
      .all()
      .map((r) => r.g)
      .filter(Boolean) as string[],
  );
}

/** True when two companies are run by accounts the owner flagged as the same person. */
export function areLinked(a: string, b: string): boolean {
  const ga = linkedGroups(a);
  if (!ga.size) return false;
  for (const g of linkedGroups(b)) if (ga.has(g)) return true;
  return false;
}

export function transfer(fromCompany: string, toCompany: string, amount: number, memo: string, actorId: string, idempotencyKey?: string) {
  return atomic(() => {
    if (fromCompany === toCompany) throw badRequest('Sending Bits to yourself? Bold. Denied.');
    const perms = getCompanyPermissions(fromCompany);
    if (perms.limits.transferRecipients === 'nobody') throw forbidden('Transfers are switched off for your company.', 'limit');
    if (perms.limits.transferRecipients === 'same_company') throw forbidden('You may only move Bits inside your own company (use the pots).', 'limit');
    getCompany(toCompany);
    if (!getCompanyPermissions(toCompany).modules.transfers) throw forbidden("That company can't receive transfers.", 'limit');
    if (areLinked(fromCompany, toCompany)) {
      recordFlag('linked_transfer', fromCompany, `Blocked transfer of ${amount} to linked company ${toCompany}`, 2);
      throw forbidden('Transfers between linked accounts are blocked. (Boss Byte sees all.)', 'linked');
    }
    const sent = today(fromCompany, 'transferred');
    if (perms.limits.maxTransferPerDay != null && sent + amount > perms.limits.maxTransferPerDay) throw forbidden(`Daily transfer limit: ${perms.limits.maxTransferPerDay} BT (sent ${sent} today).`, 'limit');
    const fee = Math.max(1, Math.floor((amount * cfg().economy.transferFeeBps) / 10_000));
    const have = balanceOf(companyWallet(fromCompany));
    if (have < amount + fee) throw badRequest(`You need ${amount + fee} BT (including a ${fee} BT fee).`);
    const r = post({
      kind: 'transfer.gift',
      memo: memo || 'Gift',
      idempotencyKey,
      actorId,
      legs: [
        { from: companyWallet(fromCompany), to: companyWallet(toCompany), amount },
        { from: companyWallet(fromCompany), to: SYS.TREASURY, amount: fee, kind: 'fee.transfer' },
      ],
    });
    if (!r.duplicate) {
      bump(fromCompany, 'transferred', amount);
      bump(fromCompany, 'gifted', amount);
      bump(fromCompany, 'spent', amount + fee);
      const from = getCompany(fromCompany);
      notify(toCompany, 'gift', `🎁 ${from.emoji} ${from.name} sent you ${amount} BT`, memo);
      pushToCompany(toCompany, { type: 'balance' });
      if (amount >= 10_000) recordFlag('big_transfer', fromCompany, `Transfer of ${amount} BT to ${toCompany}`, 1);
    }
    return { ...r, fee };
  });
}

export function recipients(companyId: string) {
  return db
    .select({ id: schema.companies.id, name: schema.companies.name, emoji: schema.companies.emoji })
    .from(schema.companies)
    .where(and(eq(schema.companies.status, 'active'), sql`${schema.companies.id} != ${companyId}`))
    .all();
}

// ------------------------------------------------------------ staff payroll
export function payStaff(companyId: string, staffId: string, amount: number, memo: string, actorId: string, idempotencyKey?: string) {
  const acc = getAccount(staffId);
  if (!acc || acc.companyId !== companyId || acc.role !== 'STAFF') throw notFound('No such staff member.');
  // salaries come out of the payroll pot first, then the main wallet
  const pot = balanceOf(companyWallet(companyId, 'payroll')) >= amount ? 'payroll' : 'main';
  chargeCompany({ companyId, amount, to: accountWallet(staffId), pot, kind: 'payroll.staff', memo: memo || `Salary for ${acc.displayName}`, idempotencyKey, actorId });
  bump(companyId, 'payroll', amount);
  return { pot };
}

export function staffWallets(companyId: string) {
  return db
    .select({ id: schema.accounts.id, displayName: schema.accounts.displayName, jobTitle: schema.accounts.jobTitle, accountNumber: schema.accounts.accountNumber })
    .from(schema.accounts)
    .where(and(eq(schema.accounts.companyId, companyId), eq(schema.accounts.role, 'STAFF')))
    .all()
    .map((a) => ({ ...a, balance: balanceOf(accountWallet(a.id)) }));
}

// ------------------------------------------------------------ loans & credit
export function loanOffer(companyId: string) {
  const c = cfg();
  const co = getCompany(companyId);
  const perms = getCompanyPermissions(companyId);
  const byCredit = c.loans.maxByCredit(co.creditScore, co.level);
  const max = Math.max(0, Math.min(byCredit, perms.limits.maxLoan ?? Infinity));
  const rateBps = Math.max(100, c.loans.baseRateBps + c.loans.creditRateAdjust(co.creditScore));
  return { max, rateBps, installments: c.loans.installments, installmentMinutes: c.loans.installmentMs / 60_000, creditScore: co.creditScore };
}

export function listLoans(companyId: string) {
  return {
    borrowed: db.select().from(schema.loans).where(eq(schema.loans.borrowerId, companyId)).orderBy(desc(schema.loans.createdAt)).limit(20).all(),
    lent: db.select().from(schema.loans).where(and(eq(schema.loans.lenderType, 'company'), eq(schema.loans.lenderId, companyId))).orderBy(desc(schema.loans.createdAt)).limit(20).all(),
    offers: flag('peerLending')
      ? db.select().from(schema.loans).where(and(eq(schema.loans.status, 'offered'), sql`${schema.loans.lenderId} != ${companyId}`)).orderBy(desc(schema.loans.createdAt)).limit(20).all()
      : [],
  };
}

function scheduleFor(principal: number, rateBps: number, installments: number) {
  const total = principal + Math.ceil((principal * rateBps) / 10_000);
  return { total, installment: Math.ceil(total / installments) };
}

export function takeLoan(companyId: string, amount: number, actorId: string) {
  return atomic(() => {
    const offer = loanOffer(companyId);
    if (amount > offer.max) throw badRequest(`The bank will lend you at most ${offer.max} BT right now (credit score ${offer.creditScore}).`);
    const open = db.select({ n: sql<number>`count(*)` }).from(schema.loans).where(and(eq(schema.loans.borrowerId, companyId), eq(schema.loans.status, 'active'))).get()!.n;
    if (open >= 3) throw badRequest('Pay off a loan before taking another. Max 3 at once.');
    const c = cfg();
    const { total, installment } = scheduleFor(amount, offer.rateBps, c.loans.installments);
    const now = clock.now();
    const id = newId('loan');
    db.insert(schema.loans)
      .values({ id, borrowerId: companyId, lenderType: 'treasury', lenderId: null, principal: amount, outstanding: total, rateBps: offer.rateBps, installment, installmentsLeft: c.loans.installments, nextDueAt: now + c.loans.installmentMs, missed: 0, status: 'active', createdAt: now })
      .run();
    post({ kind: 'loan.disburse', memo: `Treasury loan ${id}`, actorId, legs: [{ from: SYS.TREASURY, to: companyWallet(companyId), amount }] });
    bump(companyId, 'loans');
    audit({ actorId, action: 'loan.take', targetType: 'company', targetId: companyId, newValue: { amount, rateBps: offer.rateBps } });
    return { id, total, installment };
  });
}

/** Peer lending: a company offers a loan; another accepts it. */
export function offerPeerLoan(lenderId: string, amount: number, rateBps: number, actorId: string) {
  if (!flag('peerLending')) throw forbidden('Peer lending is switched off.', 'flag');
  return atomic(() => {
    if (rateBps < 0 || rateBps > 3000) throw badRequest('Interest must be between 0% and 30%.');
    const c = cfg();
    const { total, installment } = scheduleFor(amount, rateBps, c.loans.installments);
    const id = newId('loan');
    // escrow the offered Bits so the lender can't spend them twice
    post({ kind: 'loan.offer_escrow', actorId, legs: [{ from: companyWallet(lenderId), to: walletId('company', lenderId, `loan-${id}`), amount }] });
    db.insert(schema.loans)
      .values({ id, borrowerId: '', lenderType: 'company', lenderId, principal: amount, outstanding: total, rateBps, installment, installmentsLeft: c.loans.installments, nextDueAt: 0, missed: 0, status: 'offered', createdAt: clock.now() })
      .run();
    return { id };
  });
}

export function acceptPeerLoan(borrowerId: string, loanId: string, actorId: string) {
  return atomic(() => {
    const l = db.select().from(schema.loans).where(eq(schema.loans.id, loanId)).get();
    if (!l || l.status !== 'offered') throw notFound('That loan offer is gone.');
    if (l.lenderId === borrowerId) throw badRequest("You can't borrow from yourself.");
    if (l.lenderId && areLinked(l.lenderId, borrowerId)) throw forbidden('Loans between linked accounts are blocked.', 'linked');
    const perms = getCompanyPermissions(borrowerId);
    if (perms.limits.maxLoan != null && l.principal > perms.limits.maxLoan) throw forbidden(`Your loan limit is ${perms.limits.maxLoan} BT.`, 'limit');
    const now = clock.now();
    post({ kind: 'loan.disburse', memo: `Peer loan ${loanId}`, actorId, legs: [{ from: walletId('company', l.lenderId!, `loan-${loanId}`), to: companyWallet(borrowerId), amount: l.principal }] });
    db.update(schema.loans).set({ borrowerId, status: 'active', nextDueAt: now + cfg().loans.installmentMs }).where(eq(schema.loans.id, loanId)).run();
    notify(l.lenderId!, 'loan', '🤝 Your loan offer was accepted', `${getCompany(borrowerId).name} borrowed ${l.principal} BT.`);
    return { ok: true };
  });
}

export function cancelPeerOffer(lenderId: string, loanId: string) {
  return atomic(() => {
    const l = db.select().from(schema.loans).where(and(eq(schema.loans.id, loanId), eq(schema.loans.lenderId, lenderId))).get();
    if (!l || l.status !== 'offered') throw notFound('No such open offer.');
    post({ kind: 'loan.offer_cancel', legs: [{ from: walletId('company', lenderId, `loan-${loanId}`), to: companyWallet(lenderId), amount: l.principal }] });
    db.update(schema.loans).set({ status: 'cancelled' }).where(eq(schema.loans.id, loanId)).run();
    return { ok: true };
  });
}

function lenderWallet(l: typeof schema.loans.$inferSelect) {
  return l.lenderType === 'treasury' ? SYS.TREASURY : companyWallet(l.lenderId!);
}

function adjustCredit(companyId: string, delta: number) {
  const c = cfg();
  db.update(schema.companies)
    .set({ creditScore: sql`MAX(${c.loans.creditMin}, MIN(${c.loans.creditMax}, ${schema.companies.creditScore} + ${delta}))` })
    .where(eq(schema.companies.id, companyId))
    .run();
}

export function repayLoan(companyId: string, loanId: string, amount: number | 'all', actorId: string) {
  return atomic(() => {
    const l = db.select().from(schema.loans).where(and(eq(schema.loans.id, loanId), eq(schema.loans.borrowerId, companyId))).get();
    if (!l || l.status !== 'active') throw notFound('No active loan with that id.');
    const pay = Math.min(l.outstanding, amount === 'all' ? l.outstanding : amount);
    post({ kind: 'loan.repay', memo: `Repay ${loanId}`, actorId, legs: [{ from: companyWallet(companyId), to: lenderWallet(l), amount: pay }] });
    const outstanding = l.outstanding - pay;
    const installmentsLeft = Math.max(0, l.installmentsLeft - Math.floor(pay / l.installment));
    db.update(schema.loans).set({ outstanding, installmentsLeft, status: outstanding <= 0 ? 'repaid' : 'active' }).where(eq(schema.loans.id, loanId)).run();
    if (outstanding <= 0) {
      adjustCredit(companyId, cfg().loans.creditOnTime * 3);
      bump(companyId, 'loansRepaid');
    }
    return { outstanding };
  });
}

/** Tick: collect due installments; late fees; defaults hurt credit & morale. */
function collectInstallments(now: number) {
  const c = cfg();
  const due = db.select().from(schema.loans).where(and(eq(schema.loans.status, 'active'), lte(schema.loans.nextDueAt, now))).all();
  for (const l of due) {
    atomic(() => {
      const amt = Math.min(l.installment, l.outstanding);
      const bal = balanceOf(companyWallet(l.borrowerId));
      if (bal >= amt) {
        post({ kind: 'loan.installment', legs: [{ from: companyWallet(l.borrowerId), to: lenderWallet(l), amount: amt }] });
        const outstanding = l.outstanding - amt;
        db.update(schema.loans)
          .set({ outstanding, installmentsLeft: Math.max(0, l.installmentsLeft - 1), nextDueAt: now + c.loans.installmentMs, status: outstanding <= 0 ? 'repaid' : 'active' })
          .where(eq(schema.loans.id, l.id))
          .run();
        adjustCredit(l.borrowerId, c.loans.creditOnTime);
        if (outstanding <= 0) notify(l.borrowerId, 'loan', '🎉 Loan fully repaid!', 'Your credit score thanks you.');
      } else {
        const lateFee = Math.ceil((l.installment * c.loans.lateFeeBps) / 10_000);
        const missed = l.missed + 1;
        adjustCredit(l.borrowerId, c.loans.creditMissed);
        if (missed >= c.loans.defaultAfterMissed) {
          db.update(schema.loans).set({ status: 'defaulted', missed }).where(eq(schema.loans.id, l.id)).run();
          adjustCredit(l.borrowerId, c.loans.creditDefault);
          db.update(schema.workers).set({ mood: sql`MAX(0, ${schema.workers.mood} - 20)` }).where(eq(schema.workers.companyId, l.borrowerId)).run();
          notify(l.borrowerId, 'loan', '💥 Loan defaulted!', 'Your credit score dropped hard and the team is rattled.');
          if (l.lenderType === 'company') notify(l.lenderId!, 'loan', '😢 A borrower defaulted', `Loan ${l.id} will not be repaid.`);
        } else {
          db.update(schema.loans).set({ outstanding: l.outstanding + lateFee, missed, nextDueAt: now + c.loans.installmentMs }).where(eq(schema.loans.id, l.id)).run();
          notify(l.borrowerId, 'loan', `⏰ Missed a loan payment (+${lateFee} BT late fee)`, `Missed ${missed}/${c.loans.defaultAfterMissed} before default.`);
        }
      }
    });
  }
}

export function forgiveLoan(loanId: string, actorId: string) {
  const l = db.select().from(schema.loans).where(eq(schema.loans.id, loanId)).get();
  if (!l) throw notFound('No such loan.');
  db.update(schema.loans).set({ status: 'forgiven', outstanding: 0 }).where(eq(schema.loans.id, loanId)).run();
  audit({ actorId, action: 'loan.forgive', targetType: 'loan', targetId: loanId, oldValue: { outstanding: l.outstanding } });
  if (l.borrowerId) notify(l.borrowerId, 'loan', '🕊️ The Owner forgave your loan!', 'Fresh start. Spend wisely.');
}

// ------------------------------------------------------------ insurance
export function buyInsurance(companyId: string, kind: string, actorId: string) {
  if (!flag('insurance')) throw forbidden('Insurance is switched off.', 'flag');
  const c = cfg();
  const k = c.insurance.kinds[kind];
  if (!k) throw notFound('No such policy.');
  return atomic(() => {
    const now = clock.now();
    const active = db.select().from(schema.insurancePolicies).where(and(eq(schema.insurancePolicies.companyId, companyId), eq(schema.insurancePolicies.kind, kind), sql`${schema.insurancePolicies.activeUntil} > ${now}`)).get();
    chargeCompany({ companyId, amount: k.premium, kind: 'spend.insurance', memo: k.name, actorId });
    if (active) {
      db.update(schema.insurancePolicies).set({ activeUntil: active.activeUntil + c.insurance.durationMs }).where(eq(schema.insurancePolicies.id, active.id)).run();
      return { extended: true };
    }
    db.insert(schema.insurancePolicies).values({ id: newId('pol'), companyId, kind, premium: k.premium, activeUntil: now + c.insurance.durationMs, claims: 0, createdAt: now }).run();
    return { extended: false };
  });
}

// ------------------------------------------------------------ Bit Lotto (capped, Bits only)
export function buyLotto(companyId: string, actorId: string) {
  if (!flag('lotto')) throw forbidden('The lotto is closed. The Owner switched it off.', 'flag');
  const c = cfg();
  return atomic(() => {
    if (today(companyId, 'lotto') >= c.lotto.maxTicketsPerDay) throw badRequest(`Max ${c.lotto.maxTicketsPerDay} tickets a day. Go outside!`);
    chargeCompany({ companyId, amount: c.lotto.ticketCost, kind: 'spend.lotto', memo: 'Bit Lotto ticket', actorId });
    bump(companyId, 'lotto');
    const r = liveRng().next();
    let acc = 0;
    for (const p of c.lotto.prizes) {
      acc += p.chance;
      if (r < acc) {
        const won = payCompany({ companyId, amount: p.bits, from: SYS.TREASURY, kind: 'reward.lotto', memo: 'Lotto win', actorId, partial: true });
        return { won };
      }
    }
    return { won: 0 };
  });
}

// ------------------------------------------------------------ wealth tax (daily)
function wealthTax(now: number) {
  const c = cfg();
  if (c.economy.wealthTaxBpsPerDay <= 0) return;
  const rows = sqlite.prepare(`SELECT owner_id AS companyId, SUM(balance) AS total FROM wallets WHERE owner_type='company' GROUP BY owner_id HAVING total > ?`).all(c.economy.wealthTaxThreshold) as Array<{ companyId: string; total: number }>;
  for (const r of rows) {
    const tax = Math.floor(((r.total - c.economy.wealthTaxThreshold) * c.economy.wealthTaxBpsPerDay) / 10_000);
    const bal = balanceOf(companyWallet(r.companyId));
    const amt = Math.min(tax, bal);
    if (amt > 0) {
      post({ kind: 'tax.wealth', memo: `Wealth tax ${dayKey(now)}`, idempotencyKey: `wealth:${r.companyId}:${dayKey(now)}`, legs: [{ from: companyWallet(r.companyId), to: SYS.TREASURY, amount: amt }] });
      notify(r.companyId, 'tax', `🧾 Wealth tax: ${amt} BT`, 'Being very rich comes with a tiny fee. It funds Credit Rain!');
    }
  }
}

export function walletHistory(companyId: string, opts: { kind?: string; limit?: number } = {}) {
  const like_ = `w:company:${companyId}:%`;
  const conds = [or(like(schema.ledgerEntries.fromWallet, like_), like(schema.ledgerEntries.toWallet, like_))];
  if (opts.kind) conds.push(like(schema.ledgerEntries.kind, `${opts.kind}%`));
  return db
    .select()
    .from(schema.ledgerEntries)
    .where(and(...conds))
    .orderBy(desc(schema.ledgerEntries.id))
    .limit(Math.min(opts.limit ?? 100, 500))
    .all()
    .map((e) => ({ ...e, direction: e.toWallet.startsWith(`w:company:${companyId}:`) && !e.fromWallet.startsWith(`w:company:${companyId}:`) ? 'in' : e.fromWallet.startsWith(`w:company:${companyId}:`) && !e.toWallet.startsWith(`w:company:${companyId}:`) ? 'out' : 'internal' }));
}

export const bankJobs = { matureDeposits, paySavingsInterest, collectInstallments, wealthTax };
export { inArray };
