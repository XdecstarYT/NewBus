/**
 * Player loans. A lender posts an offer (the money waits in the Loans wallet) or a
 * borrower posts a request (paid when a lender accepts). Interest is a flat % on
 * top, due after some game days. Late loans are collected from whatever the
 * borrower has; anything still missing is a default that hurts their credit.
 */
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { GAME_DAY, GAME_HOUR, LOAN_LIMITS, creditLabel, creditScore } from '@dw/shared/live';
import { schema, type Db } from '../db';
import type { Account, Company } from '../http/router';
import { clock } from '../lib/time';
import { newId } from '../lib/ids';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { addNews, assertAllowed, hint, notify, topics } from './core';
import { pay, payUpTo, W } from './money';

export interface NewLoan {
  side: 'offer' | 'request';
  amount: number;
  interestPct: number;
  days: number;
  note: string;
  offeredTo?: string | null;
}

const owedFor = (amount: number, pct: number) => amount + Math.round((amount * pct) / 100);

export async function credit(db: Db, companyId: string) {
  const r = await db
    .select({ repaid: sql<number>`count(*) filter (where ${schema.loans.status} = 'repaid')::int`, defaulted: sql<number>`count(*) filter (where ${schema.loans.status} = 'defaulted')::int` })
    .from(schema.loans)
    .where(eq(schema.loans.borrowerId, companyId));
  const score = creditScore(r[0]?.repaid ?? 0, r[0]?.defaulted ?? 0);
  return { score, label: creditLabel(score), repaid: r[0]?.repaid ?? 0, defaulted: r[0]?.defaulted ?? 0 };
}

export async function create(db: Db, account: Account, company: Company, o: NewLoan) {
  await assertAllowed(db, company.id, 'transfers');
  if (o.amount < 1 || o.amount > LOAN_LIMITS.maxAmount) throw badRequest(`Loans are 1 to ${LOAN_LIMITS.maxAmount} BT.`);
  if (o.offeredTo === company.id) throw badRequest('You can not lend to yourself.');
  const open = await db.select({ n: sql<number>`count(*)::int` }).from(schema.loans).where(and(or(eq(schema.loans.lenderId, company.id), eq(schema.loans.borrowerId, company.id)), eq(schema.loans.status, 'open')));
  if (open[0].n >= 10) throw conflict('You can have up to 10 open loan posts.');
  const now = clock.now();
  const id = newId('loan', 12);
  if (o.side === 'offer') await pay(db, W.company(company.id), W.loans, o.amount, 'loan.escrow', `Loan offer: ${o.amount} BT`, account.id);
  await db.insert(schema.loans).values({
    id,
    side: o.side,
    lenderId: o.side === 'offer' ? company.id : null,
    borrowerId: o.side === 'request' ? company.id : null,
    offeredTo: o.offeredTo ?? null,
    amount: o.amount,
    interestPct: o.interestPct,
    days: o.days,
    owed: owedFor(o.amount, o.interestPct),
    note: o.note,
    status: 'open',
    createdAt: now,
    acceptBy: now + 24 * GAME_HOUR,
  });
  if (o.offeredTo) await notify(db, { companyId: o.offeredTo }, 'loan', `🏦 ${company.emoji} ${company.name} ${o.side === 'offer' ? 'offers you a loan' : 'asks you for a loan'}`, `${o.amount} BT at ${o.interestPct}% for ${o.days} game days.`);
  await hint(db, topics.all, { t: 'bank' });
  return { id };
}

async function load(db: Db, id: string) {
  const l = (await db.select().from(schema.loans).where(eq(schema.loans.id, id)).for('update'))[0];
  if (!l) throw notFound('No such loan.');
  return l;
}

/** Take an open offer (as borrower) or fund an open request (as lender). */
export async function accept(db: Db, account: Account, company: Company, id: string) {
  await assertAllowed(db, company.id, 'transfers');
  const l = await load(db, id);
  if (l.status !== 'open' || l.acceptBy <= clock.now()) throw conflict('That loan is no longer open.');
  if (l.lenderId === company.id || l.borrowerId === company.id) throw badRequest('That is your own loan post.');
  if (l.offeredTo && l.offeredTo !== company.id) throw forbidden('That loan was posted for another company.');
  const now = clock.now();
  const lenderId = l.lenderId ?? company.id;
  const borrowerId = l.borrowerId ?? company.id;
  if (l.side === 'offer') await pay(db, W.loans, W.company(borrowerId), l.amount, 'loan.start', `Loan from ${lenderId}`, account.id);
  else await pay(db, W.company(lenderId), W.company(borrowerId), l.amount, 'loan.start', `Loan to ${borrowerId}`, account.id);
  await db.update(schema.loans).set({ lenderId, borrowerId, status: 'active', dueAt: now + l.days * GAME_DAY }).where(eq(schema.loans.id, id));
  await notify(db, { companyId: l.side === 'offer' ? lenderId : borrowerId }, 'loan', `🤝 ${company.emoji} ${company.name} took your loan ${l.side === 'offer' ? 'offer' : 'request'}`, `${l.amount} BT, ${l.owed} BT due in ${l.days} game days.`);
  await hint(db, topics.all, { t: 'bank' });
  return { ok: true, owed: l.owed };
}

export async function repay(db: Db, account: Account, company: Company, id: string, amount?: number) {
  const l = await load(db, id);
  if (l.status !== 'active' || l.borrowerId !== company.id) throw conflict('Only the borrower can repay an active loan.');
  const left = l.owed - l.repaid;
  const amt = Math.min(left, Math.floor(amount ?? left));
  if (amt < 1) throw badRequest('Pay at least 1 BT.');
  await pay(db, W.company(company.id), W.company(l.lenderId!), amt, 'loan.repay', `Loan repayment`, account.id);
  const repaid = l.repaid + amt;
  const done = repaid >= l.owed;
  await db.update(schema.loans).set({ repaid, status: done ? 'repaid' : 'active', doneAt: done ? clock.now() : null }).where(eq(schema.loans.id, id));
  await notify(db, { companyId: l.lenderId }, 'loan', done ? `✅ ${company.emoji} ${company.name} repaid their loan in full` : `💸 ${company.emoji} ${company.name} paid ${amt} BT of their loan`, `${repaid} of ${l.owed} BT.`);
  await hint(db, topics.all, { t: 'bank' });
  return { paid: amt, left: l.owed - repaid, done };
}

export async function cancel(db: Db, company: Company, id: string) {
  const l = await load(db, id);
  if (l.status !== 'open' || (l.lenderId !== company.id && l.borrowerId !== company.id)) throw conflict('Only your own open loan posts can be cancelled.');
  if (l.side === 'offer') await pay(db, W.loans, W.company(company.id), l.amount, 'loan.refund', 'Loan offer withdrawn');
  await db.update(schema.loans).set({ status: 'cancelled', doneAt: clock.now() }).where(eq(schema.loans.id, id));
  await hint(db, topics.all, { t: 'bank' });
  return { ok: true };
}

export async function view(db: Db, company: Company) {
  const now = clock.now();
  const rows = await db
    .select()
    .from(schema.loans)
    .where(
      or(
        and(eq(schema.loans.status, 'open'), sql`${schema.loans.acceptBy} > ${now}`, sql`(${schema.loans.offeredTo} is null or ${schema.loans.offeredTo} = ${company.id})`),
        eq(schema.loans.lenderId, company.id),
        eq(schema.loans.borrowerId, company.id),
      ),
    )
    .orderBy(desc(schema.loans.createdAt))
    .limit(100);
  const cos = await db.select({ id: schema.companies.id, name: schema.companies.name, emoji: schema.companies.emoji }).from(schema.companies);
  const co = (id: string | null) => (id ? (cos.find((c) => c.id === id) ?? null) : null);
  const ids = [...new Set(rows.flatMap((r) => [r.lenderId, r.borrowerId]).filter(Boolean) as string[])];
  const scores: Record<string, Awaited<ReturnType<typeof credit>>> = {};
  for (const i of ids) scores[i] = await credit(db, i);
  return {
    loans: rows.map((r) => ({ ...r, lender: co(r.lenderId), borrower: co(r.borrowerId), offeredToCo: co(r.offeredTo), borrowerCredit: r.borrowerId ? scores[r.borrowerId] : null })),
    myCredit: await credit(db, company.id),
  };
}

export async function sweepLoans(db: Db, now: number) {
  for (const l of await db.select().from(schema.loans).where(and(eq(schema.loans.status, 'open'), lt(schema.loans.acceptBy, now)))) {
    if (l.side === 'offer') await pay(db, W.loans, W.company(l.lenderId!), l.amount, 'loan.refund', 'Nobody took your loan offer');
    await db.update(schema.loans).set({ status: 'expired', doneAt: now }).where(eq(schema.loans.id, l.id));
  }
  for (const l of await db.select().from(schema.loans).where(and(eq(schema.loans.status, 'active'), lt(schema.loans.dueAt, now)))) {
    // collect what we can from the borrower
    const got = await payUpTo(db, W.company(l.borrowerId!), W.company(l.lenderId!), l.owed - l.repaid, 'justice.loan.collect', 'Overdue loan collected');
    const repaid = l.repaid + got;
    if (repaid >= l.owed) {
      await db.update(schema.loans).set({ repaid, status: 'repaid', doneAt: now }).where(eq(schema.loans.id, l.id));
      await notify(db, { companyId: l.borrowerId }, 'loan', '🏦 Your overdue loan was collected automatically', `${got} BT taken.`);
      continue;
    }
    await db.update(schema.loans).set({ repaid, status: 'defaulted', doneAt: now }).where(eq(schema.loans.id, l.id));
    const b = (await db.select().from(schema.companies).where(eq(schema.companies.id, l.borrowerId!)))[0];
    await notify(db, { companyId: l.lenderId }, 'loan', `💔 ${b?.name ?? 'The borrower'} defaulted on your loan`, `They still owe ${l.owed - repaid} BT. You can take them to court.`);
    await notify(db, { companyId: l.borrowerId }, 'loan', '💔 You defaulted on a loan', `${l.owed - repaid} BT unpaid. Your credit score dropped.`);
    await addNews(db, 'loan', `💔 ${b?.emoji ?? ''} ${b?.name ?? 'A company'} defaulted on a ${l.amount} BT loan`, '', l.borrowerId);
  }
}
