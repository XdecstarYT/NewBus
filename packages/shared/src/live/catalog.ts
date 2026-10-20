/**
 * Digital Workforce Live: the item / facility / recipe catalogue. Everything a
 * player owns was made by a player: raw materials are gathered with Energy,
 * then refined into goods other players need (food, tools, building parts,
 * office installs).
 */

export const ITEM_IDS = [
  'wheat', 'beans', 'ore', 'wood', 'cotton', 'milk',
  'flour', 'coffee', 'steel', 'planks', 'fabric',
  'bread', 'pastry', 'latte', 'tools', 'furniture', 'uniform', 'gadget',
] as const;
export type ItemId = (typeof ITEM_IDS)[number];

export interface ItemDef {
  id: ItemId;
  name: string;
  emoji: string;
  tier: 'raw' | 'processed' | 'goods';
  /** Reference value used for net worth when the item has never traded. */
  basePrice: number;
  /** Energy restored when a player eats it. */
  food?: number;
  /** Installed in the office: what it does. */
  install?: { prestige: number; maxEnergy?: number; regen?: number };
  blurb: string;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  wheat: { id: 'wheat', name: 'Wheat', emoji: '🌾', tier: 'raw', basePrice: 4, blurb: 'Milled into flour.' },
  beans: { id: 'beans', name: 'Coffee beans', emoji: '🫘', tier: 'raw', basePrice: 6, blurb: 'Roasted into coffee.' },
  ore: { id: 'ore', name: 'Ore', emoji: '🪨', tier: 'raw', basePrice: 7, blurb: 'Smelted into steel.' },
  wood: { id: 'wood', name: 'Wood', emoji: '🪵', tier: 'raw', basePrice: 5, blurb: 'Sawn into planks.' },
  cotton: { id: 'cotton', name: 'Cotton', emoji: '☁️', tier: 'raw', basePrice: 5, blurb: 'Woven into fabric.' },
  milk: { id: 'milk', name: 'Milk', emoji: '🥛', tier: 'raw', basePrice: 5, blurb: 'For pastries and lattes.' },
  flour: { id: 'flour', name: 'Flour', emoji: '🌫️', tier: 'processed', basePrice: 9, blurb: 'Baked into bread and pastries.' },
  coffee: { id: 'coffee', name: 'Roasted coffee', emoji: '🟤', tier: 'processed', basePrice: 13, blurb: 'Brewed into lattes.' },
  steel: { id: 'steel', name: 'Steel', emoji: '🔩', tier: 'processed', basePrice: 15, blurb: 'Needed for tools, gadgets and every building.' },
  planks: { id: 'planks', name: 'Planks', emoji: '🟫', tier: 'processed', basePrice: 10, blurb: 'Needed for furniture, tools and every building.' },
  fabric: { id: 'fabric', name: 'Fabric', emoji: '🧵', tier: 'processed', basePrice: 11, blurb: 'Sewn into uniforms and furniture.' },
  bread: { id: 'bread', name: 'Bread', emoji: '🍞', tier: 'goods', basePrice: 8, food: 15, blurb: 'Eat it: +15 Energy.' },
  pastry: { id: 'pastry', name: 'Pastry', emoji: '🥐', tier: 'goods', basePrice: 15, food: 25, blurb: 'Eat it: +25 Energy.' },
  latte: { id: 'latte', name: 'Latte', emoji: '☕', tier: 'goods', basePrice: 18, food: 30, blurb: 'Drink it: +30 Energy.' },
  tools: { id: 'tools', name: 'Tools', emoji: '🔨', tier: 'goods', basePrice: 60, blurb: '+50% output on shifts. Each one lasts 10 batches.' },
  furniture: { id: 'furniture', name: 'Furniture', emoji: '🪑', tier: 'goods', basePrice: 70, install: { prestige: 10, maxEnergy: 5 }, blurb: 'Install it: +5 max Energy for your whole team, +10 prestige.' },
  uniform: { id: 'uniform', name: 'Uniform', emoji: '👕', tier: 'goods', basePrice: 40, install: { prestige: 5, regen: 1 }, blurb: 'Install it: +1 Energy/hour for your whole team, +5 prestige.' },
  gadget: { id: 'gadget', name: 'Gadget', emoji: '📱', tier: 'goods', basePrice: 120, install: { prestige: 25 }, blurb: 'Install it: +25 prestige. Pure bragging rights.' },
};

export const FACILITY_IDS = [
  'farm', 'plantation', 'mine', 'forest',
  'mill', 'roastery', 'foundry', 'sawmill', 'loom',
  'bakery', 'cafe', 'workshop', 'studio', 'tailor', 'lab',
] as const;
export type FacilityId = (typeof FACILITY_IDS)[number];

export interface Recipe {
  id: string;
  inputs: Partial<Record<ItemId, number>>;
  outputs: Partial<Record<ItemId, number>>;
  energy: number;
}

export interface FacilityDef {
  id: FacilityId;
  name: string;
  emoji: string;
  kind: 'raw' | 'processed' | 'goods';
  blurb: string;
  recipes: Recipe[];
}

const r = (id: string, energy: number, inputs: Recipe['inputs'], outputs: Recipe['outputs']): Recipe => ({ id, energy, inputs, outputs });

export const FACILITIES: Record<FacilityId, FacilityDef> = {
  farm: { id: 'farm', name: 'Farm', emoji: '🚜', kind: 'raw', blurb: 'Grows wheat and cotton, milks the cows.', recipes: [r('wheat', 5, {}, { wheat: 4 }), r('cotton', 5, {}, { cotton: 3 }), r('milk', 5, {}, { milk: 3 })] },
  plantation: { id: 'plantation', name: 'Plantation', emoji: '🌴', kind: 'raw', blurb: 'Picks coffee beans.', recipes: [r('beans', 5, {}, { beans: 3 })] },
  mine: { id: 'mine', name: 'Mine', emoji: '⛏️', kind: 'raw', blurb: 'Digs up ore.', recipes: [r('ore', 6, {}, { ore: 3 })] },
  forest: { id: 'forest', name: 'Forest', emoji: '🌲', kind: 'raw', blurb: 'Chops wood.', recipes: [r('wood', 5, {}, { wood: 4 })] },
  mill: { id: 'mill', name: 'Mill', emoji: '🌬️', kind: 'processed', blurb: 'Grinds wheat into flour.', recipes: [r('flour', 4, { wheat: 3 }, { flour: 2 })] },
  roastery: { id: 'roastery', name: 'Roastery', emoji: '🔥', kind: 'processed', blurb: 'Roasts coffee beans.', recipes: [r('coffee', 4, { beans: 3 }, { coffee: 2 })] },
  foundry: { id: 'foundry', name: 'Foundry', emoji: '🏭', kind: 'processed', blurb: 'Smelts ore into steel.', recipes: [r('steel', 5, { ore: 3 }, { steel: 2 })] },
  sawmill: { id: 'sawmill', name: 'Sawmill', emoji: '🪚', kind: 'processed', blurb: 'Saws wood into planks.', recipes: [r('planks', 4, { wood: 3 }, { planks: 2 })] },
  loom: { id: 'loom', name: 'Loom', emoji: '🧶', kind: 'processed', blurb: 'Weaves cotton into fabric.', recipes: [r('fabric', 4, { cotton: 3 }, { fabric: 2 })] },
  bakery: { id: 'bakery', name: 'Bakery', emoji: '🥖', kind: 'goods', blurb: 'Bakes bread and pastries.', recipes: [r('bread', 4, { flour: 2 }, { bread: 3 }), r('pastry', 5, { flour: 2, milk: 1 }, { pastry: 2 })] },
  cafe: { id: 'cafe', name: 'Café', emoji: '🧋', kind: 'goods', blurb: 'Brews lattes.', recipes: [r('latte', 4, { coffee: 1, milk: 1 }, { latte: 2 })] },
  workshop: { id: 'workshop', name: 'Workshop', emoji: '🛠️', kind: 'goods', blurb: 'Forges tools.', recipes: [r('tools', 6, { steel: 2, planks: 1 }, { tools: 1 })] },
  studio: { id: 'studio', name: 'Furniture Studio', emoji: '🛋️', kind: 'goods', blurb: 'Builds furniture.', recipes: [r('furniture', 6, { planks: 3, fabric: 1 }, { furniture: 1 })] },
  tailor: { id: 'tailor', name: 'Tailor', emoji: '🪡', kind: 'goods', blurb: 'Sews uniforms.', recipes: [r('uniform', 5, { fabric: 2 }, { uniform: 1 })] },
  lab: { id: 'lab', name: 'Electronics Lab', emoji: '🔬', kind: 'goods', blurb: 'Assembles gadgets.', recipes: [r('gadget', 8, { steel: 3, planks: 1 }, { gadget: 1 })] },
};

export const MAX_FACILITY_LEVEL = 5;

/** Output multiplier for a facility level (1 = base). */
export const levelOutput = (level: number) => 1 + 0.25 * (level - 1);
/** Energy multiplier for a facility level (cheaper as it grows). */
export const levelEnergy = (level: number) => 1 - 0.05 * (level - 1);

/** Cost to build a new facility (Bits go to the Treasury, materials are used up). */
export function buildCost(id: FacilityId): { bits: number; items: Partial<Record<ItemId, number>> } {
  const kind = FACILITIES[id].kind;
  if (kind === 'raw') return { bits: 600, items: { planks: 8, steel: 2 } };
  if (kind === 'processed') return { bits: 900, items: { planks: 12, steel: 6 } };
  return { bits: 1200, items: { planks: 16, steel: 10 } };
}

/** Cost to upgrade a facility from `level` to `level + 1`. */
export function upgradeCost(level: number): { bits: number; items: Partial<Record<ItemId, number>> } {
  return { bits: 500 * level, items: { planks: 5 * level, steel: 3 * level, tools: level } };
}

export const TOOL_USES = 10;
export const TOOL_BONUS = 0.5;
export const BASE_MAX_ENERGY = 100;
export const BASE_REGEN_PER_HOUR = 10;
export const INSTALL_CAP = 10; // furniture/uniforms beyond this still add prestige, not energy

/** How many batches the recipe yields, rounded down, with tools giving a bonus. */
export function batchOutput(recipe: Recipe, level: number, withTools: boolean) {
  const mult = levelOutput(level) * (withTools ? 1 + TOOL_BONUS : 1);
  const out: Partial<Record<ItemId, number>> = {};
  for (const [item, n] of Object.entries(recipe.outputs) as Array<[ItemId, number]>) out[item] = n * mult;
  return out;
}

export function recipeEnergy(recipe: Recipe, level: number) {
  return Math.max(1, Math.round(recipe.energy * levelEnergy(level)));
}

export function findRecipe(facility: FacilityId, recipeId: string) {
  return FACILITIES[facility]?.recipes.find((x) => x.id === recipeId);
}

export const isItem = (x: string): x is ItemId => (ITEM_IDS as readonly string[]).includes(x);
export const isFacility = (x: string): x is FacilityId => (FACILITY_IDS as readonly string[]).includes(x);
