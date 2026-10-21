/**
 * Active production: players spend their own Energy at their company's facilities.
 * Nothing runs while nobody is playing.
 */
import { and, eq, sql } from 'drizzle-orm';
import {
  FACILITIES,
  ITEMS,
  MAX_FACILITY_LEVEL,
  TOOL_BONUS,
  TOOL_USES,
  buildCost,
  findRecipe,
  isFacility,
  isItem,
  levelOutput,
  recipeEnergy,
  upgradeCost,
  type FacilityId,
  type ItemId,
} from '@dw/shared/live';
import { schema, type Db } from '../db';
import { bumpQuest, skillBonus } from './progress';
import type { Account, Company } from '../http/router';
import { clock } from '../lib/time';
import { badRequest, conflict, notFound } from '../lib/errors';
import { addNews, assertAllowed, hint, topics } from './core';
import { foodValue, gainEnergy, spendEnergy } from './energy';
import { pay, W } from './money';
import { addItem, qtyOf, takeItem, takeItems } from './stock';

export const companyLevel = (xp: number) => Math.floor(Math.sqrt(xp / 40)) + 1;

async function facilityOf(db: Db, companyId: string, type: string) {
  const r = await db.select().from(schema.facilities).where(and(eq(schema.facilities.companyId, companyId), eq(schema.facilities.type, type)));
  return r[0] ?? null;
}

/** Work a shift: `batches` runs of a recipe, paid for with your Energy. */
export async function work(db: Db, account: Account, company: Company, o: { facility: string; recipe: string; batches: number; useTools?: boolean }) {
  await assertAllowed(db, company.id, 'work');
  if (!isFacility(o.facility)) throw badRequest('Unknown facility.');
  const fac = await facilityOf(db, company.id, o.facility);
  if (!fac) throw badRequest(`Your company has no ${FACILITIES[o.facility].name}. Build one first.`);
  const recipe = findRecipe(o.facility, o.recipe);
  if (!recipe) throw badRequest('Unknown recipe.');
  const batches = Math.floor(o.batches);
  if (batches < 1 || batches > 50) throw badRequest('Run between 1 and 50 batches.');

  const energy = recipeEnergy(recipe, fac.level) * batches;
  await spendEnergy(db, account, company, energy);
  await takeItems(db, company.id, recipe.inputs, batches);

  // tools: each batch with tools gets +50% output; one Tools item covers 10 batches
  let toolBatches = 0;
  let toolUses = company.toolUses;
  if (o.useTools !== false) {
    const stock = await qtyOf(db, company.id, 'tools');
    toolBatches = Math.min(batches, toolUses + stock * TOOL_USES);
    const needed = Math.max(0, Math.ceil((toolBatches - toolUses) / TOOL_USES));
    if (needed) await takeItem(db, company.id, 'tools', needed);
    toolUses = toolUses + needed * TOOL_USES - toolBatches;
  }

  const mult = levelOutput(fac.level) * (1 + skillBonus(account.xp));
  const output: Record<string, number> = {};
  for (const [item, n] of Object.entries(recipe.outputs) as Array<[ItemId, number]>) {
    const qty = Math.floor(n * mult * (batches + toolBatches * TOOL_BONUS) + 1e-9);
    output[item] = qty;
    await addItem(db, company.id, item, qty);
  }
  const now = clock.now();
  await db.update(schema.companies).set({ toolUses, xp: sql`${schema.companies.xp} + ${energy}` }).where(eq(schema.companies.id, company.id));
  await db.update(schema.accounts).set({ xp: sql`${schema.accounts.xp} + ${energy}` }).where(eq(schema.accounts.id, account.id));
  await db.update(schema.facilities).set({ batches: sql`${schema.facilities.batches} + ${batches}` }).where(and(eq(schema.facilities.companyId, company.id), eq(schema.facilities.type, o.facility)));
  await db.insert(schema.workLog).values({ companyId: company.id, accountId: account.id, facility: o.facility, recipe: recipe.id, batches, output, createdAt: now });
  await bumpQuest(db, account.id, 'batches', batches);
  await hint(db, topics.company(company.id), { t: 'stock' });
  return { output, energySpent: energy, toolBatches, skillBonusPct: Math.round(skillBonus(account.xp) * 100) };
}

/** Eat food from the company pantry to get Energy back. */
export async function eat(db: Db, account: Account, company: Company, item: string, qty: number) {
  const food = foodValue(item);
  if (!food) throw badRequest('You can not eat that. 🦷');
  const n = Math.max(1, Math.min(20, Math.floor(qty)));
  await takeItem(db, company.id, item, n);
  const energy = await gainEnergy(db, account, company, food * n);
  await bumpQuest(db, account.id, 'eat', n);
  await hint(db, topics.company(company.id), { t: 'stock' });
  return { energy: Math.floor(energy) };
}

/** Install furniture, uniforms or gadgets in the office (permanent; counts toward prestige). */
export async function install(db: Db, company: Company, item: string, qty: number) {
  if (!isItem(item) || !ITEMS[item].install) throw badRequest('That can not be installed.');
  const n = Math.max(1, Math.min(100, Math.floor(qty)));
  await takeItem(db, company.id, item, n);
  const installs = { ...company.installs, [item]: (company.installs[item] ?? 0) + n };
  const prestige = company.prestige + ITEMS[item].install!.prestige * n;
  await db.update(schema.companies).set({ installs, prestige }).where(eq(schema.companies.id, company.id));
  if (Math.floor(prestige / 100) > Math.floor(company.prestige / 100)) await addNews(db, 'prestige', `✨ ${company.emoji} ${company.name} reaches ${Math.floor(prestige / 100) * 100} prestige!`, 'Their office is looking fancy.', company.id);
  await hint(db, topics.company(company.id), { t: 'company' });
  return { installs, prestige };
}

async function payCost(db: Db, company: Company, cost: { bits: number; items: Partial<Record<string, number>> }, kind: string, memo: string, actorId: string) {
  for (const [item, n] of Object.entries(cost.items)) if (n) await takeItem(db, company.id, item, n);
  await pay(db, W.company(company.id), W.treasury, cost.bits, kind, memo, actorId);
}

export async function build(db: Db, account: Account, company: Company, type: string) {
  await assertAllowed(db, company.id, 'build');
  if (!isFacility(type)) throw badRequest('Unknown facility.');
  if (await facilityOf(db, company.id, type)) throw conflict('You already have one.');
  const def = FACILITIES[type as FacilityId];
  await payCost(db, company, buildCost(type as FacilityId), 'build.facility', `Built a ${def.name}`, account.id);
  await db.insert(schema.facilities).values({ companyId: company.id, type, level: 1, createdAt: clock.now() });
  await addNews(db, 'build', `🏗️ ${company.emoji} ${company.name} opens a ${def.emoji} ${def.name}`, def.blurb, company.id);
  await hint(db, topics.company(company.id), { t: 'company' });
  return { ok: true };
}

export async function upgrade(db: Db, account: Account, company: Company, type: string) {
  await assertAllowed(db, company.id, 'build');
  const fac = await facilityOf(db, company.id, type);
  if (!fac) throw notFound('You do not have that facility.');
  if (fac.level >= MAX_FACILITY_LEVEL) throw conflict('Already at max level.');
  await payCost(db, company, upgradeCost(fac.level), 'build.upgrade', `Upgraded ${FACILITIES[type as FacilityId].name} to level ${fac.level + 1}`, account.id);
  await db.update(schema.facilities).set({ level: fac.level + 1 }).where(and(eq(schema.facilities.companyId, company.id), eq(schema.facilities.type, type)));
  await hint(db, topics.company(company.id), { t: 'company' });
  return { level: fac.level + 1 };
}

export async function facilitiesOf(db: Db, companyId: string) {
  return db.select().from(schema.facilities).where(eq(schema.facilities.companyId, companyId));
}
