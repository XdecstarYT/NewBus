/**
 * Runtime catalog: industries and products live in the DB (seeded from the
 * generator) so the owner can add / edit / disable / duplicate them live.
 * This module caches them in memory and invalidates on edits.
 */
import { eq } from 'drizzle-orm';
import type { IndustryDef, ProductDef, CommodityDef } from '@dw/shared';
import { db, schema, atomic } from '../db';
import { generateCatalog, slug } from '../catalog/generator';
import { COMMODITIES } from '../catalog/commodities';
import { clock } from '../lib/time';
import { badRequest, notFound } from '../lib/errors';

let industries: Map<string, IndustryDef & { enabled: boolean; custom: boolean }> | null = null;
let products: Map<string, ProductDef & { enabled: boolean }> | null = null;

function load() {
  if (industries && products) return;
  industries = new Map();
  for (const r of db.select().from(schema.industries).all()) {
    industries.set(r.id, { ...(r.data as unknown as IndustryDef), enabled: r.enabled, custom: r.custom });
  }
  products = new Map();
  for (const r of db.select().from(schema.products).all()) {
    products.set(r.id, { ...(r.data as unknown as ProductDef), enabled: r.enabled });
  }
}

export function invalidateCatalog() {
  industries = null;
  products = null;
}

export function listIndustries(includeDisabled = false) {
  load();
  return [...industries!.values()].filter((i) => includeDisabled || i.enabled);
}

export function getIndustry(id: string) {
  load();
  const i = industries!.get(id);
  if (!i) throw notFound(`No industry called "${id}"`);
  return i;
}

export function findIndustry(id: string) {
  load();
  return industries!.get(id);
}

export function listProducts(includeDisabled = false) {
  load();
  return [...products!.values()].filter((p) => includeDisabled || p.enabled);
}

export function productsFor(industryId: string, includeDisabled = false) {
  load();
  return [...products!.values()].filter((p) => p.industryId === industryId && (includeDisabled || p.enabled)).sort((a, b) => a.basePrice - b.basePrice);
}

export function getProduct(id: string) {
  load();
  const p = products!.get(id);
  if (!p) throw notFound(`No product called "${id}"`);
  return p;
}

export function findProduct(id: string) {
  load();
  return products!.get(id);
}

export const commodities: CommodityDef[] = COMMODITIES;
const commodityMap = new Map(COMMODITIES.map((c) => [c.id, c]));
export function getCommodity(id: string): CommodityDef {
  const c = commodityMap.get(id);
  if (!c) throw notFound(`No commodity called "${id}"`);
  return c;
}
export function findCommodity(id: string) {
  return commodityMap.get(id);
}

/** Seed (or top up) the DB catalog from the generator. Never overwrites owner edits. */
export function seedCatalog(): { industries: number; products: number } {
  const gen = generateCatalog();
  const now = clock.now();
  let ni = 0;
  let np = 0;
  atomic(() => {
    for (const ind of gen.industries) {
      const r = db
        .insert(schema.industries)
        .values({ id: ind.id, name: ind.name, category: ind.category, data: ind as any, enabled: true, custom: false, updatedAt: now })
        .onConflictDoNothing()
        .run();
      ni += r.changes;
    }
    for (const p of gen.products) {
      const r = db
        .insert(schema.products)
        .values({ id: p.id, industryId: p.industryId, name: p.name, data: p as any, enabled: true, updatedAt: now })
        .onConflictDoNothing()
        .run();
      np += r.changes;
      for (const line of p.recipe) {
        db.insert(schema.recipes).values({ productId: p.id, inputId: line.inputId, qty: line.qty }).onConflictDoNothing().run();
      }
    }
  });
  invalidateCatalog();
  return { industries: ni, products: np };
}

// ------------------------------------------------------------- owner edits
export function updateIndustry(id: string, patch: Partial<IndustryDef> & { enabled?: boolean }) {
  const cur = getIndustry(id);
  const { enabled, ...rest } = patch;
  const data = { ...cur, ...rest, id } as IndustryDef & { enabled?: boolean; custom?: boolean };
  delete data.enabled;
  delete data.custom;
  db.update(schema.industries)
    .set({ data: data as any, name: data.name, category: data.category, enabled: enabled ?? cur.enabled, updatedAt: clock.now() })
    .where(eq(schema.industries.id, id))
    .run();
  invalidateCatalog();
  return getIndustry(id);
}

export function duplicateIndustry(id: string, newName: string) {
  const cur = getIndustry(id);
  const newId = slug(newName);
  if (!newId) throw badRequest('Give the new industry a name.');
  if (findIndustry(newId)) throw badRequest('An industry with that name already exists.');
  const now = clock.now();
  atomic(() => {
    const prodIds: string[] = [];
    for (const p of productsFor(id, true)) {
      const pid = `${newId}--${p.id.split('--')[1]}`;
      prodIds.push(pid);
      const np: ProductDef = { ...p, id: pid, industryId: newId, recipe: p.recipe.map((r) => ({ ...r, inputId: r.inputId.startsWith(`${id}--`) ? `${newId}--${r.inputId.split('--')[1]}` : r.inputId })) };
      delete (np as any).enabled;
      db.insert(schema.products).values({ id: pid, industryId: newId, name: np.name, data: np as any, enabled: true, updatedAt: now }).run();
    }
    const data: IndustryDef = { ...cur, id: newId, name: newName, products: prodIds };
    delete (data as any).enabled;
    delete (data as any).custom;
    db.insert(schema.industries).values({ id: newId, name: newName, category: cur.category, data: data as any, enabled: true, custom: true, updatedAt: now }).run();
  });
  invalidateCatalog();
  return getIndustry(newId);
}

export function updateProduct(id: string, patch: Partial<ProductDef> & { enabled?: boolean }) {
  const cur = getProduct(id);
  const { enabled, ...rest } = patch;
  const data = { ...cur, ...rest, id, industryId: cur.industryId } as ProductDef & { enabled?: boolean };
  delete data.enabled;
  if (data.basePrice < 1) throw badRequest('Price must be at least 1 BT.');
  db.update(schema.products)
    .set({ data: data as any, name: data.name, enabled: enabled ?? cur.enabled, updatedAt: clock.now() })
    .where(eq(schema.products.id, id))
    .run();
  invalidateCatalog();
  return getProduct(id);
}

export function duplicateProduct(id: string, newName: string) {
  const cur = getProduct(id);
  const newId = `${cur.industryId}--${slug(newName)}`;
  if (findProduct(newId)) throw badRequest('A product with that name already exists in this industry.');
  const data: ProductDef = { ...cur, id: newId, name: newName };
  delete (data as any).enabled;
  db.insert(schema.products).values({ id: newId, industryId: cur.industryId, name: newName, data: data as any, enabled: true, updatedAt: clock.now() }).run();
  invalidateCatalog();
  return getProduct(newId);
}

/** Import products from JSON (array of ProductDef-like objects). Upserts by id. */
export function importProducts(items: Array<Partial<ProductDef> & { id: string }>) {
  let n = 0;
  atomic(() => {
    for (const it of items) {
      const existing = findProduct(it.id);
      if (existing) {
        updateProduct(it.id, it);
      } else {
        if (!it.industryId || !findIndustry(it.industryId)) throw badRequest(`Product ${it.id}: unknown industryId`);
        const base = productsFor(it.industryId, true)[0];
        const data = { ...base, ...it } as ProductDef;
        delete (data as any).enabled;
        db.insert(schema.products).values({ id: it.id, industryId: it.industryId, name: data.name, data: data as any, enabled: true, updatedAt: clock.now() }).run();
        invalidateCatalog();
      }
      n++;
    }
  });
  invalidateCatalog();
  return n;
}

export function productsToCsv(list = listProducts(true)) {
  const cols = ['id', 'name', 'emoji', 'industryId', 'tier', 'basePrice', 'baseCost', 'productionMs', 'unlockLevel', 'perishable', 'service', 'enabled'];
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...list.map((p: any) => cols.map((c) => esc(p[c])).join(','))].join('\n');
}
