/**
 * Pure demand & customer-satisfaction math (unit-tested).
 *
 *  - Demand falls as price rises: priceEffect = (price/base)^(-elasticity x sensitivity)
 *  - Better quality and reputation raise demand.
 *  - Seasonality, daily trends and competition from same-industry rivals scale it.
 */
export interface DemandInput {
  price: number;
  basePrice: number;
  quality: number; // 0..100
  reputation: number; // 0..500 (stars x100)
  demandBase: number; // product demand curve base
  elasticity: number;
  priceSensitivity: number; // customer type
  qualityCare: number; // customer type
  season: number; // multiplier
  trend: number; // multiplier (trending item / fad / recall)
  competition: number; // 0.7..1
}

export function purchaseProbability(d: DemandInput): number {
  if (d.price <= 0 || d.basePrice <= 0) return 0;
  const ratio = d.price / d.basePrice;
  const priceEffect = Math.pow(ratio, -d.elasticity * d.priceSensitivity);
  const qualityEffect = Math.pow(0.6 + Math.max(0, Math.min(100, d.quality)) / 125, d.qualityCare);
  const repEffect = 0.6 + (Math.max(0, Math.min(500, d.reputation)) / 500) * 0.8;
  const p = 0.55 * d.demandBase * priceEffect * qualityEffect * repEffect * d.season * d.trend * d.competition;
  return Math.max(0, Math.min(0.95, p));
}

/** Expected customers this tick before randomness. Reputation 3.0 stars = baseline. */
export function expectedCustomers(base: number, reputation: number, traffic: number): number {
  const repFactor = 0.5 + (Math.max(0, Math.min(500, reputation)) / 300) * 0.5;
  return Math.max(0, base * repFactor * traffic);
}

/** 1..5 stars from value-for-money and quality. Critics are harsher, big spenders kinder. */
export function reviewStars(quality: number, price: number, basePrice: number, qualityCare: number, noise: number): number {
  const value = quality / 50 / Math.max(0.2, price / basePrice);
  const raw = 1.6 + 1.6 * Math.min(2, value) - (qualityCare - 1) * 0.8 + noise;
  return Math.max(1, Math.min(5, Math.round(raw)));
}

/** Rolling reputation update toward the latest review (stars x100). */
export function nextReputation(rep: number, stars: number, weight = 0.03): number {
  return Math.round(rep * (1 - weight) + stars * 100 * weight);
}

/** Quality of a produced unit. */
export function unitQuality(min: number, max: number, craft: number, morale: number, bonus: number, roll: number): number {
  // craft 0..100, morale 0..100, roll 0..1
  const skill = (craft / 100) * 0.5 + (morale / 100) * 0.3 + roll * 0.2;
  return Math.max(1, Math.min(100, Math.round(min + (max - min) * skill + bonus)));
}

/** Price limits for a product: global floor/ceiling intersected with the owner's per-company multiplier. */
export function priceBounds(basePrice: number, floor: number, ceiling: number, limitMult: number) {
  const lo = Math.max(1, Math.ceil(basePrice * Math.max(floor, 1 / limitMult)));
  const hi = Math.max(lo, Math.floor(basePrice * Math.min(ceiling, limitMult)));
  return { min: lo, max: hi };
}
