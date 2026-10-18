/**
 * Immutable double-entry ledger.
 *
 * Every Bit movement is a ledger entry that debits one wallet and credits
 * another by the same integer amount, so the sum of all wallet balances is
 * ALWAYS zero. New Bits enter the economy from the MINT wallet (the only wallet
 * allowed to go negative): total money supply == -balance(MINT).
 *
 * All posts are atomic (one SQLite transaction) and idempotent: re-posting
 * with the same idempotency key returns the original transaction instead of
 * moving money twice.
 */
import type { Statement } from 'better-sqlite3';
import { sqlite, atomic } from '../db';
import { newId } from '../lib/ids';
import { clock } from '../lib/time';
import { GameError, insufficientFunds } from '../lib/errors';

export type OwnerType = 'system' | 'company' | 'account' | 'guild';

export const SYS = {
  MINT: 'w:system:mint:main',
  TREASURY: 'w:system:treasury:main',
  NPC: 'w:system:npc:main',
} as const;

export function walletId(ownerType: OwnerType, ownerId: string, pot = 'main'): string {
  return `w:${ownerType}:${ownerId}:${pot}`;
}

export interface Leg {
  from: string;
  to: string;
  amount: number;
  kind?: string;
}

let stmts: {
  ensure: Statement;
  get: Statement;
  debit: Statement;
  credit: Statement;
  insertTx: Statement;
  insertEntry: Statement;
  findIdem: Statement;
} | null = null;
let stmtsFor: unknown = null;

function S() {
  // Re-prepare if the connection changed (tests open fresh in-memory DBs).
  if (!stmts || stmtsFor !== sqlite) {
    stmtsFor = sqlite;
    stmts = {
      ensure: sqlite.prepare(
        `INSERT INTO wallets (id, owner_type, owner_id, pot, balance, created_at) VALUES (?, ?, ?, ?, 0, ?) ON CONFLICT(id) DO NOTHING`,
      ),
      get: sqlite.prepare(`SELECT balance FROM wallets WHERE id = ?`),
      // Debit refuses to go below zero unless the wallet is the MINT.
      debit: sqlite.prepare(`UPDATE wallets SET balance = balance - ? WHERE id = ? AND (balance >= ? OR id = '${SYS.MINT}')`),
      credit: sqlite.prepare(`UPDATE wallets SET balance = balance + ? WHERE id = ?`),
      insertTx: sqlite.prepare(`INSERT INTO ledger_tx (id, kind, memo, idempotency_key, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`),
      insertEntry: sqlite.prepare(
        `INSERT INTO ledger_entries (tx_id, from_wallet, to_wallet, amount, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ),
      findIdem: sqlite.prepare(`SELECT id FROM ledger_tx WHERE idempotency_key = ?`),
    };
  }
  return stmts;
}

function parseWalletId(id: string): { ownerType: string; ownerId: string; pot: string } {
  const [, ownerType, ownerId, pot] = id.split(':');
  if (!ownerType || !ownerId || !pot) throw new GameError(500, 'bad_wallet', `Bad wallet id ${id}`);
  return { ownerType, ownerId, pot };
}

export function ensureWallet(id: string): string {
  const { ownerType, ownerId, pot } = parseWalletId(id);
  S().ensure.run(id, ownerType, ownerId, pot, clock.now());
  return id;
}

export function balanceOf(id: string): number {
  const row = S().get.get(id) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

export interface PostResult {
  txId: string;
  duplicate: boolean;
}

/**
 * Post a multi-leg transaction. Throws (and rolls back everything) if any
 * debit would overdraw a non-MINT wallet.
 */
export function post(opts: { kind: string; memo?: string; idempotencyKey?: string; actorId?: string | null; legs: Leg[] }): PostResult {
  return atomic(() => {
    const s = S();
    if (opts.idempotencyKey) {
      const existing = s.findIdem.get(opts.idempotencyKey) as { id: string } | undefined;
      if (existing) return { txId: existing.id, duplicate: true };
    }
    const now = clock.now();
    const txId = newId('tx');
    s.insertTx.run(txId, opts.kind, opts.memo ?? null, opts.idempotencyKey ?? null, opts.actorId ?? null, now);
    for (const leg of opts.legs) {
      if (!Number.isInteger(leg.amount)) throw new GameError(500, 'non_integer', `Ledger amounts must be integers (got ${leg.amount})`);
      if (leg.amount < 0) throw new GameError(500, 'negative', 'Ledger amounts must be positive');
      if (leg.amount === 0) continue;
      if (leg.from === leg.to) continue;
      ensureWallet(leg.from);
      ensureWallet(leg.to);
      const r = s.debit.run(leg.amount, leg.from, leg.amount);
      if (r.changes === 0) throw insufficientFunds(leg.amount, balanceOf(leg.from));
      s.credit.run(leg.amount, leg.to);
      s.insertEntry.run(txId, leg.from, leg.to, leg.amount, leg.kind ?? opts.kind, now);
    }
    return { txId, duplicate: false };
  });
}

/** Convenience single-leg transfer. */
export function transfer(from: string, to: string, amount: number, kind: string, memo?: string, idempotencyKey?: string, actorId?: string | null) {
  return post({ kind, memo, idempotencyKey, actorId, legs: [{ from, to, amount }] });
}

/** Sum of all balances (must be 0) and whether cached balances match the entries. */
export function verifyLedger(): { sum: number; mismatches: Array<{ id: string; balance: number; computed: number }> } {
  const sum = (sqlite.prepare(`SELECT COALESCE(SUM(balance),0) AS s FROM wallets`).get() as { s: number }).s;
  const mismatches = sqlite
    .prepare(
      `SELECT w.id, w.balance,
        COALESCE((SELECT SUM(amount) FROM ledger_entries WHERE to_wallet = w.id),0) -
        COALESCE((SELECT SUM(amount) FROM ledger_entries WHERE from_wallet = w.id),0) AS computed
       FROM wallets w`,
    )
    .all()
    .filter((r: any) => r.balance !== r.computed) as Array<{ id: string; balance: number; computed: number }>;
  return { sum, mismatches };
}

export function moneySupply(): number {
  return -balanceOf(SYS.MINT);
}

export function initSystemWallets() {
  for (const id of Object.values(SYS)) ensureWallet(id);
}
