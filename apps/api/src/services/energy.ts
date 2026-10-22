/**
 * Personal Energy: what every player spends to work. It refills slowly on its own
 * (that only lets you play, it never produces anything) and faster by eating food.
 */
import { eq } from 'drizzle-orm';
import { BASE_MAX_ENERGY, BASE_REGEN_PER_HOUR, INSTALL_CAP, ITEMS, type ItemId } from '@dw/shared/live';
import { schema, type Db } from '../db';
import type { Account, Company } from '../http/router';
import { clock, HOUR } from '../lib/time';
import { badRequest } from '../lib/errors';
import { getValue } from './core';
import { regenBonus } from './town';

export interface EnergyStats {
  max: number;
  regen: number;
}

export async function energyStats(db: Db, company: Company | null): Promise<EnergyStats> {
  const installs = company?.installs ?? {};
  const furniture = Math.min(INSTALL_CAP, installs.furniture ?? 0);
  const uniforms = Math.min(INSTALL_CAP, installs.uniform ?? 0);
  const boost = await getValue<{ value: number; until: number }>(db, 'energyBoost');
  const lawBoost = boost && boost.until > clock.now() ? boost.value : 0;
  return {
    max: BASE_MAX_ENERGY + furniture * (ITEMS.furniture.install?.maxEnergy ?? 0),
    regen: BASE_REGEN_PER_HOUR + uniforms * (ITEMS.uniform.install?.regen ?? 0) + lawBoost + (await regenBonus(db)),
  };
}

export function energyNow(account: Account, stats: EnergyStats, now = clock.now()) {
  const hours = Math.max(0, now - account.energyAt) / HOUR;
  if (account.energy >= stats.max) return account.energy;
  return Math.min(stats.max, account.energy + hours * stats.regen);
}

export async function spendEnergy(db: Db, account: Account, company: Company | null, amount: number) {
  const stats = await energyStats(db, company);
  const now = clock.now();
  const cur = energyNow(account, stats, now);
  if (cur + 1e-9 < amount) throw badRequest(`Not enough Energy: you need ${amount} but have ${Math.floor(cur)}. Eat something or wait a bit.`, 'no_energy');
  const next = cur - amount;
  await db.update(schema.accounts).set({ energy: next, energyAt: now }).where(eq(schema.accounts.id, account.id));
  return next;
}

export async function gainEnergy(db: Db, account: Account, company: Company | null, amount: number) {
  const stats = await energyStats(db, company);
  const now = clock.now();
  const cur = energyNow(account, stats, now);
  const next = Math.min(stats.max, cur + amount);
  await db.update(schema.accounts).set({ energy: next, energyAt: now }).where(eq(schema.accounts.id, account.id));
  return next;
}

export function foodValue(item: string) {
  return ITEMS[item as ItemId]?.food ?? 0;
}
