/** Company inventories. Quantities never go below zero. */
import { and, eq, gt, gte, sql } from 'drizzle-orm';
import { ITEMS, type ItemId } from '@dw/shared/live';
import { schema, type Db } from '../db';
import { badRequest } from '../lib/errors';

export async function addItem(db: Db, companyId: string, item: string, qty: number) {
  if (qty <= 0) return;
  await db
    .insert(schema.inventory)
    .values({ companyId, item, qty })
    .onConflictDoUpdate({ target: [schema.inventory.companyId, schema.inventory.item], set: { qty: sql`${schema.inventory.qty} + ${qty}` } });
}

export async function takeItem(db: Db, companyId: string, item: string, qty: number) {
  if (qty <= 0) return;
  const r = await db
    .update(schema.inventory)
    .set({ qty: sql`${schema.inventory.qty} - ${qty}` })
    .where(and(eq(schema.inventory.companyId, companyId), eq(schema.inventory.item, item), gte(schema.inventory.qty, qty)))
    .returning({ q: schema.inventory.qty });
  if (!r.length) {
    const have = await qtyOf(db, companyId, item);
    const def = ITEMS[item as ItemId];
    throw badRequest(`Not enough ${def ? `${def.emoji} ${def.name}` : item}: you need ${qty} but have ${have}.`, 'not_enough_items', { item, need: qty, have });
  }
}

export async function qtyOf(db: Db, companyId: string, item: string) {
  const r = await db.select({ q: schema.inventory.qty }).from(schema.inventory).where(and(eq(schema.inventory.companyId, companyId), eq(schema.inventory.item, item)));
  return r[0]?.q ?? 0;
}

export async function inventoryOf(db: Db, companyId: string) {
  const r = await db.select().from(schema.inventory).where(and(eq(schema.inventory.companyId, companyId), gt(schema.inventory.qty, 0)));
  return Object.fromEntries(r.map((x) => [x.item, x.qty])) as Record<string, number>;
}

/** Take several items at once (all or nothing inside a transaction). */
export async function takeItems(db: Db, companyId: string, items: Partial<Record<string, number>>, times = 1) {
  for (const [item, n] of Object.entries(items)) if (n) await takeItem(db, companyId, item, n * times);
}
