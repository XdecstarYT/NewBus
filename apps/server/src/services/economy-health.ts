/**
 * Economy health monitor: money supply, Gini coefficient, inflation (Bits
 * created vs destroyed per day), velocity, richest/poorest and Boss Byte's
 * tuning suggestions. Also the optional auto-balancer.
 */
import { gt, sql } from 'drizzle-orm';
import { db, schema, sqlite } from '../db';
import { SYS, balanceOf, moneySupply } from './ledger';
import { clock, DAY_MS } from '../lib/time';
import { cfg, setSetting } from './settings';
import { flag } from './flags';
import { audit } from './audit';

export function gini(values: number[]): number {
  const v = values.filter((x) => x >= 0).sort((a, b) => a - b);
  const n = v.length;
  if (n === 0) return 0;
  const sum = v.reduce((s, x) => s + x, 0);
  if (sum === 0) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * v[i];
  return Math.max(0, Math.min(1, (2 * cum) / (n * sum) - (n + 1) / n));
}

export function economyHealth(windowMs = DAY_MS) {
  const now = clock.now();
  const since = now - windowMs;
  // seed funding of the Treasury/NPC pool is a one-off "big bang", not inflation
  const created = (sqlite.prepare(`SELECT COALESCE(SUM(amount),0) s FROM ledger_entries WHERE from_wallet = ? AND created_at > ? AND kind != 'seed.fund'`).get(SYS.MINT, since) as { s: number }).s;
  const destroyed = (sqlite.prepare(`SELECT COALESCE(SUM(amount),0) s FROM ledger_entries WHERE to_wallet = ? AND created_at > ?`).get(SYS.MINT, since) as { s: number }).s;
  const volume = (sqlite.prepare(`SELECT COALESCE(SUM(amount),0) s FROM ledger_entries WHERE created_at > ?`).get(since) as { s: number }).s;
  const companyBalances = sqlite
    .prepare(
      `SELECT c.id, c.name, c.emoji, COALESCE(SUM(w.balance),0) AS bal FROM companies c LEFT JOIN wallets w ON w.owner_type='company' AND w.owner_id = c.id GROUP BY c.id ORDER BY bal DESC`,
    )
    .all() as Array<{ id: string; name: string; emoji: string; bal: number }>;
  const playerHeld = companyBalances.reduce((s, c) => s + c.bal, 0) + (sqlite.prepare(`SELECT COALESCE(SUM(balance),0) s FROM wallets WHERE owner_type IN ('account','guild')`).get() as { s: number }).s;
  const supply = moneySupply();
  const net = created - destroyed;
  // growth of the money supply over the window, relative to the supply at the window start
  const inflation = net / Math.max(1, supply - net);
  const velocity = playerHeld > 0 ? volume / playerHeld : 0;
  const g = gini(companyBalances.map((c) => c.bal));
  const kinds = sqlite
    .prepare(`SELECT kind, COUNT(*) n, SUM(amount) total FROM ledger_entries WHERE created_at > ? GROUP BY kind ORDER BY total DESC LIMIT 15`)
    .all(since) as Array<{ kind: string; n: number; total: number }>;
  const suggestions: string[] = [];
  const c = cfg();
  if (inflation > c.economy.inflationTargetHigh) suggestions.push(`Too many Bits! Inflation is ${(inflation * 100).toFixed(1)}%/day. Raise upkeep or fees by ~5%, or lower the NPC pool refill.`);
  if (inflation < c.economy.inflationTargetLow) suggestions.push(`Bits are vanishing (${(inflation * 100).toFixed(1)}%/day). Lower wages/fees a little or run a Credit Rain.`);
  if (g > 0.6) suggestions.push(`Wealth is very concentrated (Gini ${g.toFixed(2)}). Consider the wealth tax or a Credit Rain for smaller companies.`);
  if (balanceOf(SYS.NPC) < 50_000) suggestions.push('The NPC customer pool is almost dry - customers are broke! Raise the pool refill.');
  if (balanceOf(SYS.TREASURY) < 100_000) suggestions.push('The Treasury is running low. Rewards come from it - mint a top-up or raise taxes.');
  if (!suggestions.length) suggestions.push('Economy looks healthy. Boss Byte approves. 👍');
  return {
    supply,
    treasury: balanceOf(SYS.TREASURY),
    npcPool: balanceOf(SYS.NPC),
    playerHeld,
    created,
    destroyed,
    net,
    inflation,
    velocity,
    gini: g,
    richest: companyBalances.slice(0, 5),
    poorest: companyBalances.slice(-5).reverse(),
    flows: kinds,
    suggestions,
    target: { low: c.economy.inflationTargetLow, high: c.economy.inflationTargetHigh },
  };
}

export function economyTip(): string {
  try {
    return economyHealth().suggestions[0];
  } catch {
    return 'Boss Byte is crunching numbers...';
  }
}

/**
 * Auto-balancer: nudges the progressive production tax (hits big earners, not
 * small companies) and the NPC demand refill toward the target band. Simulation
 * showed that raising flat wages instead bankrupts small companies first.
 */
export function autoBalance() {
  if (!flag('autoBalancer')) return null;
  const h = economyHealth();
  const c = cfg();
  const refill = c.economy.npcPoolRefillPerCompanyPerTick;
  const rate = c.economy.incomeTaxRate;
  let changed: Record<string, number> | null = null;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  if (h.inflation > h.target.high) {
    changed = { 'economy.incomeTaxRate': round(Math.min(0.85, rate + 0.05)), 'economy.npcPoolRefillPerCompanyPerTick': Math.max(5, Math.round(refill * 0.95)) };
  } else if (h.inflation < h.target.low) {
    changed = { 'economy.incomeTaxRate': round(Math.max(0, rate - 0.05)), 'economy.npcPoolRefillPerCompanyPerTick': Math.min(200, Math.round(refill * 1.05)) };
  }
  if (changed) {
    for (const [k, v] of Object.entries(changed)) setSetting(k, v);
    audit({ actorId: null, action: 'economy.autobalance', newValue: { ...changed, inflation: h.inflation } });
  }
  return changed;
}

/** Daily snapshot for analytics & history charts. */
export function snapshotEconomy() {
  const h = economyHealth();
  db.insert(schema.snapshots)
    .values({
      scope: 'economy',
      data: { supply: h.supply, playerHeld: h.playerHeld, created: h.created, destroyed: h.destroyed, gini: Math.round(h.gini * 1000), companies: h.richest.length },
      createdAt: clock.now(),
    })
    .run();
}

export function economyHistory(limit = 60) {
  return db.select().from(schema.snapshots).where(sql`${schema.snapshots.scope} = 'economy'`).orderBy(sql`${schema.snapshots.createdAt} DESC`).limit(limit).all().reverse();
}

export { gt };
