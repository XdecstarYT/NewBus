/**
 * Company-facing money helpers on top of the ledger. These apply the owner's
 * per-company limits (daily earn cap, max balance, daily spend cap) and keep
 * the stats/level bookkeeping in one place.
 */
import { eq, sql } from 'drizzle-orm';
import { db, schema, atomic } from '../db';
import { SYS, walletId, post, balanceOf } from './ledger';
import { getCompanyPermissions } from '../permissions';
import { bump, today } from './stats';
import { cfg } from './settings';
import { forbidden, insufficientFunds } from '../lib/errors';

export const companyWallet = (companyId: string, pot = 'main') => walletId('company', companyId, pot);
export const accountWallet = (accountId: string) => walletId('account', accountId, 'main');

export function companyBalance(companyId: string, pot = 'main') {
  return balanceOf(companyWallet(companyId, pot));
}

export interface PayOpts {
  companyId: string;
  amount: number;
  from?: string;
  kind: string;
  memo?: string;
  idempotencyKey?: string;
  actorId?: string | null;
  /** counts toward daily earn cap, lifetime earnings, XP (default true) */
  earn?: boolean;
  /** when the source wallet is short, pay what is available instead of failing (default true for NPC pool) */
  partial?: boolean;
}

/**
 * Pay Bits to a company. Returns the amount actually paid after caps:
 *  - daily earn cap (owner limit)
 *  - max balance cap (owner limit)
 *  - available Bits in the source wallet (NPC pool can run dry - that bounds inflation)
 */
export function payCompany(o: PayOpts): number {
  return atomic(() => {
    let amount = Math.floor(o.amount);
    if (amount <= 0) return 0;
    const from = o.from ?? SYS.NPC;
    const earn = o.earn !== false;
    const perms = getCompanyPermissions(o.companyId);
    if (earn && perms.limits.dailyEarnCap != null) {
      amount = Math.min(amount, Math.max(0, perms.limits.dailyEarnCap - today(o.companyId, 'earned')));
    }
    if (perms.limits.maxBalance != null) {
      amount = Math.min(amount, Math.max(0, perms.limits.maxBalance - companyBalance(o.companyId)));
    }
    if (o.partial ?? from === SYS.NPC) {
      if (from !== SYS.MINT) amount = Math.min(amount, Math.max(0, balanceOf(from)));
    }
    if (amount <= 0) return 0;
    const r = post({
      kind: o.kind,
      memo: o.memo,
      idempotencyKey: o.idempotencyKey,
      actorId: o.actorId,
      legs: [{ from, to: companyWallet(o.companyId), amount }],
    });
    if (r.duplicate) return 0;
    if (earn) recordEarnings(o.companyId, amount);
    return amount;
  });
}

/** Lifetime/run earnings, XP and company level-ups. */
export function recordEarnings(companyId: string, amount: number) {
  bump(companyId, 'earned', amount);
  const c = cfg();
  const xp = Math.max(1, Math.floor(amount * c.company.xpPerBitEarned));
  db.update(schema.companies)
    .set({
      lifetimeEarned: sql`${schema.companies.lifetimeEarned} + ${amount}`,
      runEarned: sql`${schema.companies.runEarned} + ${amount}`,
      xp: sql`${schema.companies.xp} + ${xp}`,
    })
    .where(eq(schema.companies.id, companyId))
    .run();
  const co = db.select({ level: schema.companies.level, xp: schema.companies.xp }).from(schema.companies).where(eq(schema.companies.id, companyId)).get();
  if (!co) return;
  let { level, xp: curXp } = co;
  let leveled = false;
  while (level < c.company.maxLevel && curXp >= c.company.levelXp(level)) {
    curXp -= c.company.levelXp(level);
    level++;
    leveled = true;
  }
  if (leveled) {
    db.update(schema.companies).set({ level, xp: curXp }).where(eq(schema.companies.id, companyId)).run();
    levelUpHooks.forEach((h) => h(companyId, level));
  }
}

const levelUpHooks: Array<(companyId: string, level: number) => void> = [];
export function onLevelUp(h: (companyId: string, level: number) => void) {
  levelUpHooks.push(h);
}

export interface ChargeOpts {
  companyId: string;
  amount: number;
  to?: string;
  kind: string;
  memo?: string;
  idempotencyKey?: string;
  actorId?: string | null;
  pot?: string;
  /** counts toward daily spend cap (default true) */
  spend?: boolean;
}

/** Charge a company. Throws if it can't afford it or it exceeds the daily spend cap. */
/** Checks that can veto a company spending (e.g. a court-ordered asset freeze). */
const spendGuards: Array<(companyId: string, kind: string) => void> = [];
export function registerSpendGuard(fn: (companyId: string, kind: string) => void) {
  spendGuards.push(fn);
}

export function chargeCompany(o: ChargeOpts): string {
  return atomic(() => {
    const amount = Math.floor(o.amount);
    if (amount <= 0) return '';
    for (const g of spendGuards) g(o.companyId, o.kind);
    const from = companyWallet(o.companyId, o.pot ?? 'main');
    const have = balanceOf(from);
    if (have < amount) throw insufficientFunds(amount, have);
    const perms = getCompanyPermissions(o.companyId);
    if (o.spend !== false && perms.limits.dailySpendCap != null) {
      const spent = today(o.companyId, 'spent');
      if (spent + amount > perms.limits.dailySpendCap)
        throw forbidden(`Daily spending cap reached (${perms.limits.dailySpendCap} BT). The Owner set this limit!`, 'spend_cap');
    }
    const r = post({
      kind: o.kind,
      memo: o.memo,
      idempotencyKey: o.idempotencyKey,
      actorId: o.actorId,
      legs: [{ from, to: o.to ?? SYS.TREASURY, amount }],
    });
    if (!r.duplicate && o.spend !== false) bump(o.companyId, 'spent', amount);
    return r.txId;
  });
}
