/**
 * Town & Finance: daily world events, town projects everyone builds together,
 * boosts they unlock, and the rules for loans and auctions.
 */
import type { FacilityId, ItemId } from './catalog';

/** A temporary effect on the whole game (from a world event or a finished town project). */
export type BoostKind = 'output' | 'regen' | 'taxfree' | 'customers' | 'quests';
export interface Boost {
  id: string;
  kind: BoostKind;
  /** output: only this facility (empty = every facility) */
  facility?: FacilityId | '';
  /** customers: they want this item more and pay extra for it (empty = everything) */
  item?: ItemId | '';
  /** output/customers: +% (can be negative for output); regen: +Energy/hour; quests: reward ×(1+pct/100) */
  pct: number;
  until: number;
  label: string;
  emoji: string;
  source: 'event' | 'project' | 'owner';
}

export interface WorldEvent {
  id: string;
  emoji: string;
  title: string;
  blurb: string;
  weight: number;
  boosts: Array<Omit<Boost, 'id' | 'until' | 'label' | 'emoji' | 'source'>>;
}

/** One rolls every game day (2 real hours). "Quiet day" has no effect. */
export const WORLD_EVENTS: WorldEvent[] = [
  { id: 'quiet', emoji: '🌤️', title: 'A quiet day', blurb: 'Nothing special. Perfect for getting work done.', weight: 4, boosts: [] },
  { id: 'harvest', emoji: '🌾', title: 'Harvest sun', blurb: 'Perfect weather: farms produce 30% more today.', weight: 2, boosts: [{ kind: 'output', facility: 'farm', pct: 30 }] },
  { id: 'storm', emoji: '⛈️', title: 'Storm warning', blurb: 'Forests produce 20% less; customers pay 40% more for planks.', weight: 1, boosts: [{ kind: 'output', facility: 'forest', pct: -20 }, { kind: 'customers', item: 'planks', pct: 40 }] },
  { id: 'coffee', emoji: '☕', title: 'Coffee craze', blurb: 'Everyone wants lattes: customers pay 50% more for them.', weight: 2, boosts: [{ kind: 'customers', item: 'latte', pct: 50 }] },
  { id: 'bread', emoji: '🥖', title: 'Bread festival', blurb: 'Bakeries work 25% faster and customers pay 30% more for bread.', weight: 2, boosts: [{ kind: 'output', facility: 'bakery', pct: 25 }, { kind: 'customers', item: 'bread', pct: 30 }] },
  { id: 'taxfree', emoji: '🧾', title: 'Tax-free day', blurb: 'No sales tax on any sale today!', weight: 1, boosts: [{ kind: 'taxfree', pct: 0 }] },
  { id: 'payday', emoji: '🎉', title: 'Payday', blurb: 'Daily quests pay double today.', weight: 1, boosts: [{ kind: 'quests', pct: 100 }] },
  { id: 'gold', emoji: '⛏️', title: 'Gold rush', blurb: 'Mines produce 30% more and steel sells high to customers.', weight: 1, boosts: [{ kind: 'output', facility: 'mine', pct: 30 }, { kind: 'customers', item: 'steel', pct: 30 }] },
  { id: 'energy', emoji: '⚡', title: 'Sunny & energetic', blurb: 'Everyone regains 5 extra Energy per hour today.', weight: 1, boosts: [{ kind: 'regen', pct: 5 }] },
  { id: 'fashion', emoji: '👗', title: 'Fashion week', blurb: 'Customers pay 40% more for uniforms and fabric.', weight: 1, boosts: [{ kind: 'customers', item: 'uniform', pct: 40 }, { kind: 'customers', item: 'fabric', pct: 40 }] },
  { id: 'rush', emoji: '🛍️', title: 'Shopping rush', blurb: 'Customers pay 20% more for everything.', weight: 1, boosts: [{ kind: 'customers', item: '', pct: 20 }] },
];

export interface ProjectBlueprint {
  id: string;
  emoji: string;
  title: string;
  blurb: string;
  bits: number;
  items: Partial<Record<ItemId, number>>;
  boost: Omit<Boost, 'id' | 'until' | 'label' | 'emoji' | 'source'>;
  /** how long the reward lasts, in game days */
  days: number;
}

/** Things the town can build together. The Owner picks one (and can scale it). */
export const PROJECT_BLUEPRINTS: ProjectBlueprint[] = [
  { id: 'bridge', emoji: '🌉', title: 'Build a bridge', blurb: 'Faster deliveries: every shift makes 15% more.', bits: 2000, items: { planks: 150, steel: 80 }, boost: { kind: 'output', facility: '', pct: 15 }, days: 3 },
  { id: 'power', emoji: '🔌', title: 'Power plant', blurb: 'Everyone regains 5 extra Energy per hour.', bits: 1500, items: { steel: 120, tools: 10 }, boost: { kind: 'regen', pct: 5 }, days: 3 },
  { id: 'festival', emoji: '🎪', title: 'Town festival', blurb: 'Visitors flood in: customers pay 30% more for everything.', bits: 1000, items: { bread: 120, latte: 60, pastry: 60 }, boost: { kind: 'customers', item: '', pct: 30 }, days: 2 },
  { id: 'taxholiday', emoji: '🏛️', title: 'Fund a tax holiday', blurb: 'Pay the town budget up front: no sales tax for a while.', bits: 6000, items: {}, boost: { kind: 'taxfree', pct: 0 }, days: 1 },
  { id: 'coop', emoji: '🚜', title: 'Farm co-op', blurb: 'Shared machines: farms make 40% more.', bits: 800, items: { tools: 15, planks: 60 }, boost: { kind: 'output', facility: 'farm', pct: 40 }, days: 3 },
  { id: 'school', emoji: '🏫', title: 'Open a school', blurb: 'Smarter workers: daily quests pay 50% more.', bits: 2500, items: { furniture: 10, gadget: 3 }, boost: { kind: 'quests', pct: 50 }, days: 4 },
];

/** Loans: interest is a flat % on top of the amount, due after a number of game days. */
export const LOAN_LIMITS = { maxAmount: 1_000_000, maxInterestPct: 100, minDays: 1, maxDays: 30 };
/** Credit score from loan history: starts at 600, +25 per loan repaid, −120 per default. */
export const creditScore = (repaid: number, defaulted: number) => Math.max(300, Math.min(850, 600 + repaid * 25 - defaulted * 120));
export const creditLabel = (score: number) => (score >= 750 ? 'Excellent' : score >= 650 ? 'Good' : score >= 550 ? 'Fair' : 'Poor');

/** Auctions: each new bid must beat the top bid by at least this much. */
export const minNextBid = (start: number, top: number | null) => (top ? top + Math.max(1, Math.ceil(top * 0.05)) : start);
