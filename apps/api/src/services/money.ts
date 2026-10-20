/**
 * Double-entry Bits ledger. Every movement writes ledger rows; a wallet can never
 * go below zero (except the Mint, whose negative balance is the money supply).
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import { schema, type Db } from '../db';
import { clock } from '../lib/time';
import { newId } from '../lib/ids';
import { GameError, insufficient } from '../lib/errors';
import { assertNotFrozen } from './core';

export const W = {
  mint: 'mint',
  treasury: 'treasury',
  escrow: 'escrow',
  company: (id: string) => `co:${id}`,
  union: (id: string) => `union:${id}`,
};

export interface Leg {
  from: string;
  to: string;
  amount: number;
}

export async function balance(db: Db, wallet: string) {
  const r = await db.select({ b: schema.wallets.balance }).from(schema.wallets).where(eq(schema.wallets.id, wallet));
  return r[0]?.b ?? 0;
}

async function credit(db: Db, wallet: string, amount: number) {
  await db
    .insert(schema.wallets)
    .values({ id: wallet, balance: amount })
    .onConflictDoUpdate({ target: schema.wallets.id, set: { balance: sql`${schema.wallets.balance} + ${amount}` } });
}

async function debit(db: Db, wallet: string, amount: number) {
  if (wallet === W.mint) {
    await db.insert(schema.wallets).values({ id: wallet, balance: -amount }).onConflictDoUpdate({ target: schema.wallets.id, set: { balance: sql`${schema.wallets.balance} - ${amount}` } });
    return;
  }
  const r = await db
    .update(schema.wallets)
    .set({ balance: sql`${schema.wallets.balance} - ${amount}` })
    .where(and(eq(schema.wallets.id, wallet), gte(schema.wallets.balance, amount)))
    .returning({ b: schema.wallets.balance });
  if (!r.length) throw insufficient(amount, await balance(db, wallet));
}

/**
 * Post one transaction with any number of legs. Call it inside db.transaction so a
 * failed leg rolls everything back. Company wallets can't pay out while frozen,
 * except for justice payments (fines, damages, settlements).
 */
export async function post(db: Db, kind: string, legs: Leg[], opts: { memo?: string; actorId?: string | null } = {}) {
  const txId = newId('tx', 12);
  const now = clock.now();
  for (const leg of legs) {
    if (!Number.isInteger(leg.amount) || leg.amount < 0) throw new GameError(500, 'bad_amount', `Bad ledger amount ${leg.amount}`);
    if (leg.amount === 0 || leg.from === leg.to) continue;
    if (leg.from.startsWith('co:') && !kind.startsWith('justice.')) await assertNotFrozen(db, leg.from.slice(3));
    await debit(db, leg.from, leg.amount);
    await credit(db, leg.to, leg.amount);
    await db.insert(schema.ledger).values({ txId, kind, fromWallet: leg.from, toWallet: leg.to, amount: leg.amount, memo: opts.memo ?? null, actorId: opts.actorId ?? null, createdAt: now });
  }
  return txId;
}

export const pay = (db: Db, from: string, to: string, amount: number, kind: string, memo?: string, actorId?: string | null) => post(db, kind, [{ from, to, amount }], { memo, actorId });

/** Take up to `amount` (never more than the balance). Used for fines. */
export async function payUpTo(db: Db, from: string, to: string, amount: number, kind: string, memo?: string) {
  const amt = Math.min(Math.floor(amount), await balance(db, from));
  if (amt > 0) await pay(db, from, to, amt, kind, memo);
  return Math.max(0, amt);
}

/** Sum of all wallets (must be 0) and the money supply. */
export async function ledgerCheck(db: Db) {
  const r = await db.select({ s: sql<string>`coalesce(sum(${schema.wallets.balance}),0)` }).from(schema.wallets);
  return { sum: Number(r[0].s), supply: -(await balance(db, W.mint)) };
}
