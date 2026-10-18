/**
 * Expands compact industry rows (industries-data.ts) + category templates
 * (categories.ts) into full IndustryDef / ProductDef objects.
 *
 * Balance rule: every number that matters for income (worker output, product
 * price ladder, production time) comes from config/economy.ts and is identical
 * across industries, so no industry is strictly better. Industries differ in
 * flavour, inputs (supply chain) and perishability/service style, and those
 * trade-offs are compensated in the price ladder.
 */
import type {
  IndustryDef,
  ProductDef,
  WorkerArchetype,
  WorkplaceDef,
  ContractTemplate,
  EventTemplate,
  EventChoice,
  UpgradeDef,
  WorkerRole,
  Rarity,
} from '@dw/shared';
import { PRODUCT_TIERS } from '@dw/shared';
import { economy } from '../config/economy';
import { CATEGORIES, type CategoryTemplate } from './categories';
import { COMMODITIES } from './commodities';
import { INDUSTRY_ROWS, type IndustryRow } from './industries-data';

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Cheap deterministic hash for seeding per-item variety. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** split "a:b:rest:with:colons" into exactly n parts (last part keeps extra colons) */
function splitN(s: string, n: number): string[] {
  const parts = s.split(':');
  if (parts.length <= n) return parts;
  return [...parts.slice(0, n - 1), parts.slice(n - 1).join(':')];
}

const WORKPLACE_FOCUS: WorkerRole[] = ['MAKER', 'SELLER', 'THINKER', 'MANAGER', 'FIXER'];
const WORKPLACE_EMOJI = ['🏚️', '🏠', '🏢', '🏰', '🌆'];
// product index -> tier index (8 products across 5 tiers)
const TIER_OF = [0, 0, 1, 1, 2, 3, 3, 4];
const UNLOCK_LEVEL = [1, 1, 2, 3, 5, 8, 12, 18];
const REQ_WORKPLACE = [0, 0, 0, 1, 1, 2, 2, 3];
const RARITY_OF: Rarity[] = ['COMMON', 'COMMON', 'RARE', 'EPIC', 'LEGENDARY'];

const ROLE_BONUS: Record<WorkerRole, string> = {
  MAKER: '+25% output at Maker workplaces; speeds up production queues',
  SELLER: '+25% output at Seller workplaces; attracts extra customers',
  THINKER: '+25% output at Thinker workplaces; earns research points',
  FIXER: '+25% output at Fixer workplaces; prevents breakdowns',
  MANAGER: '+25% output at Manager workplaces; +5% to coworkers',
  WILDCARD: 'Synergises everywhere at +10%; unpredictable',
};

/** Generic office-event choices (used for industry & category events). */
const GENERIC_CHOICES: EventChoice[] = [
  { label: 'Handle it like a pro 😎', effect: { bitsPct: -0.02, mood: 6 }, result: 'Crisis averted. Everyone claps politely.' },
  {
    label: 'Turn it into a marketing stunt 📣',
    effect: { chance: 0.55, incomeMult: 1.5, minutes: 10, failBitsPct: -0.04 },
    result: 'It went viral! Income +50% for 10 minutes.',
    failResult: 'Nobody noticed. The posters cost money. Awkward.',
  },
  { label: 'Ignore it and order pizza 🍕', effect: { mood: 12, incomeMult: 0.85, minutes: 10 }, result: 'Morale is up, productivity is... napping.' },
];

function buildWorkers(row: IndustryRow, cat: CategoryTemplate, industryId: string): WorkerArchetype[] {
  const specific = row[8].split('|').map((w, i) => {
    const [name, emoji, bio] = splitN(w, 3);
    const role: WorkerRole = i === 0 ? 'MAKER' : 'WILDCARD';
    return { id: `${industryId}--${slug(name)}`, name, emoji, role, bio: bio ?? '', bonus: ROLE_BONUS[role] };
  });
  const shared = cat.workers.map(([name, emoji, role, bio]) => ({
    id: `${cat.id}--${slug(name)}`,
    name,
    emoji,
    role,
    bio,
    bonus: ROLE_BONUS[role],
  }));
  return [...specific, ...shared];
}

function buildWorkplaces(row: IndustryRow): WorkplaceDef[] {
  return row[4].split('|').map((name, i) => ({ tier: i, name, emoji: WORKPLACE_EMOJI[i], focus: WORKPLACE_FOCUS[i % WORKPLACE_FOCUS.length] }));
}

function buildProducts(row: IndustryRow, cat: CategoryTemplate, industryId: string, needs: string[], workplaces: WorkplaceDef[]): ProductDef[] {
  const p = economy.products;
  const perishable = !!cat.perishable;
  const service = !!cat.service;
  // Compensate trade-offs so expected profit per tick is level across industries.
  const styleMult = perishable ? 1.1 : service ? 1.05 : 1;
  const names = row[5].split('|');
  const ids: string[] = [];
  return names.map((entry, idx) => {
    const [name, emoji] = splitN(entry, 2);
    const id = `${industryId}--${slug(name)}`;
    ids.push(id);
    const t = TIER_OF[Math.min(idx, TIER_OF.length - 1)];
    const h = hash(id);
    const basePrice = Math.round(p.baseUnitPrice * p.tierPriceMult[t] * styleMult * (idx % 2 ? 1.15 : 1));
    // recipe: spend ~35% of price on supply-chain inputs, split across the industry's needs
    const inputBudget = basePrice * 0.35;
    const recipe = needs.map((cid) => {
      const c = COMMODITIES.find((x) => x.id === cid)!;
      return { inputId: cid, qty: Math.max(1, Math.round(inputBudget / needs.length / c.basePrice)) };
    });
    // intermediate goods: product #2 is made from product #1 (flour -> dough -> bread)
    if (idx === 1) recipe.push({ inputId: ids[0], qty: 1 });
    const seasonality: [number, number, number, number] = [0, 1, 2, 3].map((s) => Math.round((0.9 + (((h >> (s * 4)) & 15) / 15) * 0.25) * 100) / 100) as any;
    const def: ProductDef = {
      id,
      name,
      emoji: emoji || row[2],
      industryId,
      category: cat.name,
      tier: PRODUCT_TIERS[t],
      tierIndex: t,
      baseCost: Math.round(basePrice * p.costRatio),
      basePrice,
      productionMs: Math.round(p.baseMsPerUnit * p.tierTimeMult[t]),
      qualityMin: 30 + t * 6,
      qualityMax: 70 + t * 7,
      shelfLifeTicks: perishable ? 240 + t * 60 : service ? 120 : 0,
      perishable: perishable || service,
      service,
      demand: { base: Number((1 / (1 + t * 0.55)).toFixed(3)), elasticity: p.elasticity },
      seasonality,
      rarity: RARITY_OF[t],
      unlockLevel: UNLOCK_LEVEL[idx] ?? 20,
      requiredWorkplace: Math.min(REQ_WORKPLACE[idx] ?? 3, workplaces.length - 1),
      recipe,
      oops: `Charcoal ${name} (art piece)`,
    };
    return def;
  });
}

function buildEvents(row: IndustryRow, cat: CategoryTemplate, industryId: string): EventTemplate[] {
  const [title, emoji, text] = splitN(row[11], 3);
  const ind: EventTemplate = { id: `${industryId}--event`, title, emoji, text, choices: GENERIC_CHOICES };
  const shared = cat.events.map(([t, e, x], i) => ({ id: `${cat.id}--event-${i}`, title: t, emoji: e, text: x, choices: GENERIC_CHOICES }));
  return [ind, ...shared];
}

function buildContracts(row: IndustryRow, cat: CategoryTemplate, industryId: string): ContractTemplate[] {
  const [title, client, clientEmoji, blurb] = splitN(row[12], 4);
  const personalities = ['Demanding', 'Cheerful', 'Mysterious', 'Impatient', 'Generous'];
  const ind: ContractTemplate = {
    id: `${industryId}--contract`,
    title,
    client,
    clientEmoji,
    personality: personalities[hash(industryId) % personalities.length],
    blurb,
  };
  const shared = cat.contracts.map(([t, c, e, p, b], i) => ({ id: `${cat.id}--contract-${i}`, title: t, client: c, clientEmoji: e, personality: p, blurb: b }));
  return [ind, ...shared];
}

function buildUpgrades(row: IndustryRow, cat: CategoryTemplate, industryId: string, workplaces: WorkplaceDef[]): UpgradeDef[] {
  const [name, emoji, description] = splitN(row[9], 3);
  return [
    { id: `${industryId}--upgrade`, name, emoji, description, cost: 6000, effect: { incomeMult: 1.1 }, minLevel: 4 },
    { id: `${cat.id}--upgrade`, name: cat.upgrade[0], emoji: cat.upgrade[1], description: cat.upgrade[2], cost: 15000, effect: { mood: 8, speedMult: 1.1 }, minLevel: 7 },
    {
      id: `${industryId}--blueprint`,
      name: `${workplaces[workplaces.length - 1].name} Blueprint`,
      emoji: '📐',
      description: `Secret plans that make every ${row[1]} product a little bit fancier.`,
      cost: 40000,
      effect: { quality: 8, traffic: 1.1 },
      minLevel: 12,
    },
  ];
}

function buildGames(row: IndustryRow, cat: CategoryTemplate, productNames: string[]): Record<string, string> {
  const n = row[1];
  return {
    'debug-rush': `Squash the bugs in the ${n} systems!`,
    'coffee-run': `Fuel the ${n} crew with perfect coffee!`,
    'email-sorter': `Sort ${n} customer mail from spam!`,
    'meme-maker': `Match the ${n} office memes!`,
    'server-whack': `Reboot the ${n} computers!`,
    'invoice-match': `Match the ${productNames[2]} invoices!`,
    'stock-sprint': `Will ${n} stocks go up or down?`,
    'box-stack': `Stack the ${productNames[0]} boxes!`,
    'pizza-rush': `Assemble the ${productNames[3]} orders!`,
    'parking-panic': `Clear the ${n} delivery bay!`,
    'cable-untangle': `Untangle the ${n} wiring!`,
    'quiz-show': `${cat.name} trivia with Boss Byte!`,
    ...cat.games,
  };
}

function buildJokes(row: IndustryRow, cat: CategoryTemplate, productNames: string[]): string[] {
  const own = row[10].split('|');
  return [
    ...own,
    ...cat.jokes,
    `Boss Byte tip: a happy ${row[1]} worker makes 20% more ${productNames[0]}s. Source: Boss Byte.`,
    `Loading ${productNames[productNames.length - 1]}... it's Legendary, so it takes a moment.`,
  ];
}

function buildSlogans(name: string, productNames: string[]): string[] {
  return [
    `${name}: we do it so you don't have to.`,
    `Powered by ${productNames[0]}s and good vibes.`,
    `${name} - now 40% more digital!`,
    `Have you tried our ${productNames[3]}? You should.`,
    `Proudly employing the finest blobs since today.`,
    `${productNames[productNames.length - 1]}: coming soon to a you near you.`,
  ];
}

export interface GeneratedCatalog {
  industries: IndustryDef[];
  products: ProductDef[];
}

export function generateCatalog(): GeneratedCatalog {
  const catMap = new Map(CATEGORIES.map((c) => [c.id, c]));
  const industries: IndustryDef[] = [];
  const products: ProductDef[] = [];
  for (const row of INDUSTRY_ROWS) {
    const cat = catMap.get(row[0]);
    if (!cat) throw new Error(`Unknown category ${row[0]} for ${row[1]}`);
    const id = slug(row[1]);
    const needs = row[6].split(',').map((s) => s.trim()).filter(Boolean);
    const supplies = row[7].split(',').map((s) => s.trim()).filter(Boolean);
    const workplaces = buildWorkplaces(row);
    const prods = buildProducts(row, cat, id, needs, workplaces);
    const productNames = prods.map((p) => p.name);
    industries.push({
      id,
      name: row[1],
      category: cat.name,
      categoryId: cat.id,
      emoji: row[2],
      color: row[3],
      workplaces,
      workers: buildWorkers(row, cat, id),
      products: prods.map((p) => p.id),
      baseBitsPerTick: economy.workers.baseOutputPerTick,
      needs,
      supplies,
      suppliesTo: [],
      contracts: buildContracts(row, cat, id),
      events: buildEvents(row, cat, id),
      minigameFlavor: buildGames(row, cat, productNames),
      upgrades: buildUpgrades(row, cat, id, workplaces),
      jokes: buildJokes(row, cat, productNames),
      service: !!cat.service,
      perishable: !!cat.perishable,
      slogans: buildSlogans(row[1], productNames),
    });
    products.push(...prods);
  }
  // Derive "supplies to" links: industry A supplies B when A produces something B needs.
  for (const a of industries) {
    a.suppliesTo = industries.filter((b) => b.id !== a.id && b.needs.some((n) => a.supplies.includes(n))).map((b) => b.id);
  }
  return { industries, products };
}

export { CATEGORIES };
