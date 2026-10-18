/**
 * Inventory & warehouses. Quantities can never go negative: removals check
 * first and the UPDATE itself refuses to underflow.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db, schema, sqlite } from '../db';
import { clock } from '../lib/time';
import { cfg } from './settings';
import { badRequest } from '../lib/errors';
import { findCommodity, findProduct } from './catalog';

export type ItemType = 'product' | 'commodity';

export function getQty(companyId: string, itemType: ItemType, itemId: string) {
  return (
    db
      .select({ q: schema.inventory.qty })
      .from(schema.inventory)
      .where(and(eq(schema.inventory.companyId, companyId), eq(schema.inventory.itemType, itemType), eq(schema.inventory.itemId, itemId)))
      .get()?.q ?? 0
  );
}

export function getRow(companyId: string, itemType: ItemType, itemId: string) {
  return db
    .select()
    .from(schema.inventory)
    .where(and(eq(schema.inventory.companyId, companyId), eq(schema.inventory.itemType, itemType), eq(schema.inventory.itemId, itemId)))
    .get();
}

export function totalUnits(companyId: string) {
  return (db.select({ s: sql<number>`COALESCE(SUM(${schema.inventory.qty}),0)` }).from(schema.inventory).where(eq(schema.inventory.companyId, companyId)).get()?.s ?? 0) as number;
}

export function warehouseCapacity(level: number) {
  const caps = cfg().products.warehouseCapacity;
  return caps[Math.min(level, caps.length - 1)];
}

export function freeSpace(companyId: string, warehouseLevel: number) {
  return Math.max(0, warehouseCapacity(warehouseLevel) - totalUnits(companyId));
}

/** Add stock; average quality is weighted by quantity. */
export function addStock(companyId: string, itemType: ItemType, itemId: string, qty: number, quality = 50) {
  if (qty <= 0) return;
  if (!Number.isInteger(qty)) throw new Error('Inventory quantities must be integers');
  const now = clock.now();
  sqlite
    .prepare(
      `INSERT INTO inventory (company_id, item_type, item_id, qty, quality, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(company_id, item_type, item_id) DO UPDATE SET
         quality = CAST(ROUND((quality * qty + excluded.quality * excluded.qty) * 1.0 / MAX(1, qty + excluded.qty)) AS INTEGER),
         qty = qty + excluded.qty,
         updated_at = excluded.updated_at`,
    )
    .run(companyId, itemType, itemId, qty, Math.round(quality), now);
}

/** Remove stock or throw. Never lets a row go below zero. */
export function takeStock(companyId: string, itemType: ItemType, itemId: string, qty: number) {
  if (qty <= 0) return;
  const r = sqlite
    .prepare(`UPDATE inventory SET qty = qty - ?, updated_at = ? WHERE company_id = ? AND item_type = ? AND item_id = ? AND qty >= ?`)
    .run(qty, clock.now(), companyId, itemType, itemId, qty);
  if (r.changes === 0) {
    const name = itemType === 'commodity' ? findCommodity(itemId)?.name : findProduct(itemId)?.name;
    throw badRequest(`Not enough ${name ?? itemId} in stock (need ${qty}, have ${getQty(companyId, itemType, itemId)}).`, 'out_of_stock');
  }
}

export function listInventory(companyId: string) {
  return db.select().from(schema.inventory).where(and(eq(schema.inventory.companyId, companyId), sql`${schema.inventory.qty} > 0`)).all();
}
