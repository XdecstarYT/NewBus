/**
 * Pure Bit Exchange math (unit-tested): fundamental value, market-maker
 * quotes, anchored drift, circuit breakers, diversification.
 */
export interface FundamentalsInput {
  netWorth: number;
  profitPerTick: number;
  workers: number;
  contracts: number;
  level: number;
  creditScore: number;
  growth: number; // ratio of recent vs previous earnings (1 = flat)
  shares: number;
}

export interface FundamentalWeights {
  incomeTicksValued: number;
  perWorker: number;
  perContract: number;
  perLevel: number;
  creditWeight: number;
}

/** Fair value per share from real company activity. */
export function fundamentalValue(f: FundamentalsInput, w: FundamentalWeights): number {
  const creditFactor = 1 + w.creditWeight * ((Math.max(300, Math.min(850, f.creditScore)) - 575) / 550); // ~0.75..1.25
  const growthFactor = Math.max(0.8, Math.min(1.25, f.growth));
  const enterprise =
    Math.max(0, f.netWorth) + Math.max(0, f.profitPerTick) * w.incomeTicksValued + f.workers * w.perWorker + f.contracts * w.perContract + f.level * w.perLevel;
  return Math.max(0.5, (enterprise * creditFactor * growthFactor) / Math.max(1, f.shares));
}

/** Move the anchored mid a fraction of the way toward the target, plus noise. */
export function driftToward(mid: number, target: number, pull: number, noisePct: number, rand: number): number {
  const next = mid + (target - mid) * pull + mid * noisePct * (rand * 2 - 1);
  return Math.max(0.5, next);
}

/** Market-maker bid/ask around a mid price (integer Bits, at least 1). */
export function mmQuote(mid: number, spreadBps: number) {
  const s = spreadBps / 10_000;
  const ask = Math.max(1, Math.ceil(mid * (1 + s)));
  const bid = Math.max(1, Math.min(ask - 1, Math.floor(mid * (1 - s))));
  return { bid: Math.max(1, bid), ask };
}

/** True when the move from the day's open exceeds the breaker threshold. */
export function breakerTripped(price: number, dayOpen: number, pct: number): boolean {
  if (dayOpen <= 0) return false;
  return Math.abs(price - dayOpen) / dayOpen > pct / 100;
}

/** 0 = everything in one asset, approaching 1 = nicely spread out. */
export function diversification(values: number[]): number {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  if (total <= 0) return 0;
  const hhi = values.reduce((s, v) => s + (Math.max(0, v) / total) ** 2, 0);
  return Math.round((1 - hhi) * 100) / 100;
}

/** Trading fee (integer, at least 1 on any non-zero trade). */
export function tradingFee(notional: number, feeBps: number): number {
  if (notional <= 0) return 0;
  return Math.max(1, Math.floor((notional * feeBps) / 10_000));
}

/** Volume-weighted average cost basis update after a buy. */
export function addToBasis(qty: number, basis: number, addQty: number, addCost: number) {
  return { qty: qty + addQty, basis: basis + addCost };
}

/** Remove shares from a position, reducing basis proportionally. */
export function removeFromBasis(qty: number, basis: number, removeQty: number) {
  if (qty <= 0) return { qty: qty - removeQty, basis: 0 };
  const frac = Math.min(1, removeQty / qty);
  return { qty: qty - removeQty, basis: Math.round(basis * (1 - frac)) };
}
