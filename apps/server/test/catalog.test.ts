import { describe, it, expect } from 'vitest';
import { generateCatalog } from '../src/catalog/generator';
import { COMMODITIES, COMMODITY_IDS } from '../src/catalog/commodities';

const { industries, products } = generateCatalog();
const productIds = new Set(products.map((p) => p.id));

describe('industry catalog', () => {
  it('has at least 210 industries in 30 categories with no duplicate ids', () => {
    expect(industries.length).toBeGreaterThanOrEqual(210);
    expect(new Set(industries.map((i) => i.id)).size).toBe(industries.length);
    expect(new Set(industries.map((i) => i.categoryId)).size).toBe(30);
  });

  it('every industry has all required fields', () => {
    for (const i of industries) {
      expect(i.name && i.category && i.emoji && i.color).toBeTruthy();
      expect(i.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(i.workplaces.length).toBeGreaterThanOrEqual(3);
      expect(i.workplaces.length).toBeLessThanOrEqual(5);
      expect(i.workers.length).toBeGreaterThanOrEqual(4);
      expect(i.workers.length).toBeLessThanOrEqual(6);
      expect(i.products.length).toBeGreaterThanOrEqual(7);
      expect(i.products.length).toBeLessThanOrEqual(10);
      expect(i.contracts.length).toBeGreaterThan(0);
      expect(i.events.length).toBeGreaterThan(0);
      expect(i.upgrades.length).toBeGreaterThanOrEqual(2);
      expect(i.upgrades.length).toBeLessThanOrEqual(3);
      expect(i.jokes.length).toBeGreaterThanOrEqual(10);
      expect(Object.keys(i.minigameFlavor).length).toBe(12);
      expect(i.baseBitsPerTick).toBeGreaterThan(0);
    }
  });

  it('every supply chain reference exists', () => {
    for (const i of industries) {
      for (const n of [...i.needs, ...i.supplies]) expect(COMMODITY_IDS.has(n), `${i.id} -> ${n}`).toBe(true);
      expect(i.needs.some((n) => i.supplies.includes(n))).toBe(false);
      for (const t of i.suppliesTo) expect(industries.some((x) => x.id === t)).toBe(true);
    }
    for (const c of COMMODITIES) {
      expect(industries.some((i) => i.supplies.includes(c.id)), `no supplier for ${c.id}`).toBe(true);
      expect(industries.some((i) => i.needs.includes(c.id)), `no consumer for ${c.id}`).toBe(true);
    }
  });

  it('industries are balanced: identical base output', () => {
    expect(new Set(industries.map((i) => i.baseBitsPerTick)).size).toBe(1);
  });
});

describe('product catalog', () => {
  it('has 1,470+ products with unique ids', () => {
    expect(products.length).toBeGreaterThanOrEqual(1470);
    expect(productIds.size).toBe(products.length);
  });
  it('every product has all fields and valid recipes', () => {
    for (const p of products) {
      for (const k of ['id', 'name', 'emoji', 'industryId', 'category', 'tier', 'baseCost', 'basePrice', 'productionMs', 'qualityMin', 'qualityMax', 'shelfLifeTicks', 'demand', 'seasonality', 'rarity', 'unlockLevel', 'requiredWorkplace', 'recipe'] as const) {
        expect(p[k], `${p.id}.${k}`).not.toBeUndefined();
      }
      expect(p.basePrice).toBeGreaterThan(p.baseCost);
      expect(p.qualityMax).toBeGreaterThan(p.qualityMin);
      for (const line of p.recipe) {
        expect(COMMODITY_IDS.has(line.inputId) || productIds.has(line.inputId), `${p.id} needs ${line.inputId}`).toBe(true);
        expect(line.qty).toBeGreaterThan(0);
      }
    }
  });
  it('contains no real brands or age-inappropriate goods', () => {
    const banned = /\b((?<!root )beer|wine|vodka|whisky|whiskey|cigarette|tobacco|vape|gun|rifle|pistol|bomb|coca-cola|pepsi|nike|adidas|apple iphone|starbucks|mcdonald)/i;
    for (const p of products) expect(banned.test(p.name), p.name).toBe(false);
  });
});
