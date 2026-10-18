import type { ProductTier, Rarity, WorkerRole } from './constants';

export interface CommodityDef {
  id: string;
  name: string;
  emoji: string;
  basePrice: number;
  perishable: boolean;
}

export interface WorkerArchetype {
  id: string;
  name: string;
  emoji: string;
  role: WorkerRole;
  /** flavour line shown on the card */
  bio: string;
  /** human readable role bonus */
  bonus: string;
}

export interface WorkplaceDef {
  tier: number;
  name: string;
  emoji: string;
  /** role that gets the synergy combo here */
  focus: WorkerRole;
}

export interface RecipeLine {
  inputId: string; // commodity id or product id
  qty: number;
}

export interface ProductDef {
  id: string;
  name: string;
  emoji: string;
  industryId: string;
  category: string;
  tier: ProductTier;
  tierIndex: number;
  baseCost: number;
  basePrice: number;
  productionMs: number;
  qualityMin: number;
  qualityMax: number;
  /** ticks before a unit spoils; 0 = never spoils */
  shelfLifeTicks: number;
  perishable: boolean;
  service: boolean;
  /** demand curve: expected units per customer visit at base price, and price elasticity */
  demand: { base: number; elasticity: number };
  /** multipliers for [spring, summer, autumn, winter] */
  seasonality: [number, number, number, number];
  rarity: Rarity;
  unlockLevel: number;
  requiredWorkplace: number;
  recipe: RecipeLine[];
  /** what a failed batch turns into */
  oops: string;
}

export interface ContractTemplate {
  id: string;
  title: string;
  client: string;
  clientEmoji: string;
  personality: string;
  blurb: string;
}

export interface EventChoice {
  label: string;
  /** outcome is resolved on the server */
  effect: { bits?: number; bitsPct?: number; mood?: number; incomeMult?: number; minutes?: number; energy?: number; reputation?: number; chance?: number; failBitsPct?: number };
  result: string;
  failResult?: string;
}

export interface EventTemplate {
  id: string;
  title: string;
  emoji: string;
  text: string;
  bad?: boolean;
  /** insurance kind that covers losses from this event */
  insurable?: string;
  choices: EventChoice[];
}

export interface UpgradeDef {
  id: string;
  name: string;
  emoji: string;
  description: string;
  cost: number;
  effect: { incomeMult?: number; speedMult?: number; quality?: number; traffic?: number; mood?: number };
  minLevel: number;
}

export interface IndustryDef {
  id: string;
  name: string;
  category: string;
  categoryId: string;
  emoji: string;
  color: string;
  workplaces: WorkplaceDef[];
  workers: WorkerArchetype[];
  products: string[];
  baseBitsPerTick: number;
  needs: string[];
  supplies: string[];
  suppliesTo: string[];
  contracts: ContractTemplate[];
  events: EventTemplate[];
  minigameFlavor: Record<string, string>;
  upgrades: UpgradeDef[];
  jokes: string[];
  service: boolean;
  perishable: boolean;
  slogans: string[];
}
