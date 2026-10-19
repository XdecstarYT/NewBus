import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { CreateCompanyInput, Permissions, Rarity } from '@dw/shared';
import { db, schema, atomic } from '../db';
import { bumpLifetime } from './stats';
import { newId } from '../lib/ids';
import { clock } from '../lib/time';
import { badRequest, notFound } from '../lib/errors';
import { getIndustry, productsFor } from './catalog';
import { createAccount } from './auth';
import { setCompanyPermissions, getCompanyPermissions } from '../permissions';
import { SYS, ensureWallet, post, balanceOf } from './ledger';
import { companyWallet } from './money';
import { audit } from './audit';
import { cfg } from './settings';
import { rollWorker } from '../engine/workers';
import { liveRng } from '../engine/rng';
import { addNews } from './news';
import { toCompany } from '../lib/bus';

export type Company = typeof schema.companies.$inferSelect;

export function getCompany(id: string): Company {
  const c = db.select().from(schema.companies).where(eq(schema.companies.id, id)).get();
  if (!c) throw notFound('That company has left the building.');
  return c;
}

export function findCompany(id: string): Company | undefined {
  return db.select().from(schema.companies).where(eq(schema.companies.id, id)).get();
}

export function ensureCompanyWallets(companyId: string) {
  for (const pot of ['main', 'payroll', 'savings', 'investing']) ensureWallet(companyWallet(companyId, pot));
}

/** Insert one worker row for a company from an engine roll. */
export function insertWorker(companyId: string, industryId: string, rarity: Rarity, opts: { workplaceId?: string | null; desk?: number | null } = {}) {
  const rolled = rollWorker(liveRng(), getIndustry(industryId), rarity, clock.now());
  const row = {
    id: newId('wrk'),
    companyId,
    name: rolled.name,
    species: rolled.species,
    archetype: rolled.archetype,
    role: rolled.role,
    rarity: rolled.rarity,
    quirk: rolled.quirk,
    level: 1,
    xp: 0,
    energy: 100,
    mood: rolled.mood,
    skills: rolled.skills,
    appearance: rolled.appearance,
    workplaceId: opts.workplaceId ?? null,
    desk: opts.desk ?? null,
    coffeeUntil: null,
    napUntil: null,
    listed: false,
    industryId,
    createdAt: rolled.createdAt,
  };
  db.insert(schema.workers).values(row).run();
  // collection book: every species x rarity a company has ever hired
  bumpLifetime(companyId, `col:${row.species}:${row.rarity}`);
  return row;
}

export function createWorkplace(companyId: string, industryId: string, kind: number) {
  const ind = getIndustry(industryId);
  const k = Math.max(0, Math.min(kind, ind.workplaces.length - 1));
  const row = { id: newId('wp'), companyId, kind: k, level: 1, name: ind.workplaces[k].name, skin: null, createdAt: clock.now() };
  db.insert(schema.workplaces).values(row).run();
  return row;
}

export interface CreateCompanyResult {
  company: Company;
  account: { id: string; accountNumber: string; displayName: string };
  tempPassword: string;
}

/** The core owner flow: Company Builder -> company + login + starting package. */
export function createCompany(input: CreateCompanyInput, actorId: string | null): CreateCompanyResult {
  const industry = getIndustry(input.industryId);
  if (!industry.enabled) throw badRequest('That industry is switched off in the catalog.');
  const now = clock.now();
  return atomic(() => {
    const id = newId('co');
    const company: Company = {
      id,
      name: input.name,
      emoji: input.emoji,
      color: input.color,
      slogan: input.slogan ?? '',
      industryId: industry.id,
      difficulty: input.difficulty,
      status: 'active',
      level: 1,
      xp: 0,
      fame: 0,
      reputation: 300,
      creditScore: 650,
      prestigePoints: 0,
      prestigeCount: 0,
      lifetimeEarned: 0,
      runEarned: 0,
      streak: 0,
      lastStreakClaim: null,
      pityEpic: 0,
      pityLegendary: 0,
      warehouseLevel: 1,
      research: {},
      settings: { startingBits: input.startingBits, startingWorkers: input.startingWorkers, startingWorkplace: input.startingWorkplace },
      guildId: null,
      lastTickAt: now,
      lastActiveAt: now,
      lastSeenSummaryAt: now,
      incomePerTick: 0,
      wagesPerTick: 0,
      ipoStatus: 'none',
      ipoRequest: null,
      trophies: [],
      title: null,
      theme: null,
      createdBy: actorId,
      createdAt: now,
    };
    db.insert(schema.companies).values(company).run();
    setCompanyPermissions(id, input.permissions, actorId);
    ensureCompanyWallets(id);
    if (input.startingBits > 0) {
      post({ kind: 'grant.start', memo: `Starting package for ${input.name}`, actorId, legs: [{ from: SYS.MINT, to: companyWallet(id), amount: input.startingBits }] });
    }
    const wp = createWorkplace(id, industry.id, input.startingWorkplace ?? 0);
    const desks = cfg().workplaces.desks[1];
    for (let i = 0; i < input.startingWorkers; i++) {
      const rarity: Rarity = i === 0 ? 'RARE' : 'COMMON';
      insertWorker(id, industry.id, rarity, i < desks ? { workplaceId: wp.id, desk: i } : {});
    }
    // default shelf prices for the first products
    for (const p of productsFor(industry.id)) {
      db.insert(schema.companyProducts).values({ companyId: id, productId: p.id, price: p.basePrice, onSale: true, autoRestock: 0, sold: 0 }).onConflictDoNothing().run();
    }
    db.insert(schema.warehouses).values({ id: newId('wh'), companyId: id, level: 1, createdAt: now }).run();
    const { account, tempPassword } = createAccount({
      role: 'COMPANY_ADMIN',
      accountNumber: input.accountNumber,
      password: input.password,
      displayName: input.adminName ?? 'CEO',
      companyId: id,
      mustChangePassword: input.mustChangePassword,
      createdBy: actorId,
    });
    audit({ actorId, action: 'company.create', targetType: 'company', targetId: id, newValue: { name: input.name, industry: industry.id, account: account.accountNumber } });
    addNews('headline', `${input.emoji} ${input.name} opens its doors in ${industry.name}!`, `Boss Byte predicts great things. Or at least medium things.`, id);
    return {
      company,
      account: { id: account.id, accountNumber: account.accountNumber, displayName: account.displayName },
      tempPassword,
    };
  });
}

export function listCompanies(opts: { search?: string; industryId?: string; status?: string; listed?: boolean } = {}) {
  const rows = db.select().from(schema.companies).orderBy(desc(schema.companies.createdAt)).all();
  const s = opts.search?.toLowerCase().trim();
  return rows
    .filter((c) => !s || c.name.toLowerCase().includes(s) || c.industryId.includes(s))
    .filter((c) => !opts.industryId || c.industryId === opts.industryId)
    .filter((c) => !opts.status || c.status === opts.status)
    .filter((c) => opts.listed === undefined || (c.ipoStatus === 'listed') === opts.listed);
}

export function companySummary(c: Company) {
  const ind = getIndustry(c.industryId);
  const admin = db
    .select({ accountNumber: schema.accounts.accountNumber, lastLogin: schema.accounts.lastLogin, status: schema.accounts.status, id: schema.accounts.id })
    .from(schema.accounts)
    .where(and(eq(schema.accounts.companyId, c.id), eq(schema.accounts.role, 'COMPANY_ADMIN')))
    .get();
  const workers = (db.select({ n: sql<number>`count(*)` }).from(schema.workers).where(eq(schema.workers.companyId, c.id)).get()?.n ?? 0) as number;
  return {
    id: c.id,
    name: c.name,
    emoji: c.emoji,
    color: c.color,
    slogan: c.slogan,
    status: c.status,
    industryId: c.industryId,
    industryName: ind.name,
    industryEmoji: ind.emoji,
    category: ind.category,
    level: c.level,
    balance: balanceOf(companyWallet(c.id)),
    workers,
    incomePerTick: c.incomePerTick,
    listed: c.ipoStatus === 'listed',
    ipoStatus: c.ipoStatus,
    difficulty: c.difficulty,
    admin: admin ?? null,
    lastActiveAt: c.lastActiveAt,
    createdAt: c.createdAt,
  };
}

export function updateCompany(id: string, patch: Partial<Pick<Company, 'name' | 'emoji' | 'color' | 'slogan' | 'status' | 'difficulty'>>, actorId: string | null) {
  const cur = getCompany(id);
  db.update(schema.companies).set(patch).where(eq(schema.companies.id, id)).run();
  if (patch.status && patch.status !== cur.status) {
    // suspending a company suspends its logins too
    const accStatus = patch.status === 'active' ? 'active' : patch.status === 'suspended' ? 'suspended' : 'archived';
    db.update(schema.accounts).set({ status: accStatus }).where(eq(schema.accounts.companyId, id)).run();
    if (accStatus !== 'active') {
      const accIds = db.select({ id: schema.accounts.id }).from(schema.accounts).where(eq(schema.accounts.companyId, id)).all().map((a) => a.id);
      if (accIds.length) db.delete(schema.sessions).where(inArray(schema.sessions.accountId, accIds)).run();
    }
  }
  audit({ actorId, action: 'company.update', targetType: 'company', targetId: id, oldValue: pick(cur, Object.keys(patch)), newValue: patch });
  toCompany(id, { type: 'company' });
  return getCompany(id);
}

function pick(o: Record<string, any>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, o[k]]));
}

/**
 * Change industry. Resets: workplaces (rebuilt at tier 0 per old count), product
 * prices, inventory, production queues, open contracts. Keeps: Bits, workers
 * (re-skilled into the new industry's archetypes), level, achievements.
 */
export function changeIndustry(id: string, industryId: string, actorId: string | null) {
  const c = getCompany(id);
  const ind = getIndustry(industryId);
  atomic(() => {
    const wps = db.select().from(schema.workplaces).where(eq(schema.workplaces.companyId, id)).all();
    db.update(schema.workers).set({ workplaceId: null, desk: null, industryId }).where(eq(schema.workers.companyId, id)).run();
    db.delete(schema.workplaces).where(eq(schema.workplaces.companyId, id)).run();
    wps.forEach((w, i) => createWorkplace(id, industryId, Math.min(i, ind.workplaces.length - 1)));
    // re-skill workers into archetypes with the same role where possible
    for (const w of db.select().from(schema.workers).where(eq(schema.workers.companyId, id)).all()) {
      const arch = ind.workers.find((a) => a.role === w.role) ?? ind.workers[0];
      db.update(schema.workers).set({ archetype: arch.id, role: arch.role }).where(eq(schema.workers.id, w.id)).run();
    }
    db.delete(schema.companyProducts).where(eq(schema.companyProducts.companyId, id)).run();
    for (const p of productsFor(industryId)) {
      db.insert(schema.companyProducts).values({ companyId: id, productId: p.id, price: p.basePrice, onSale: true, autoRestock: 0, sold: 0 }).run();
    }
    db.delete(schema.inventory).where(and(eq(schema.inventory.companyId, id), eq(schema.inventory.itemType, 'product'))).run();
    db.delete(schema.productionJobs).where(eq(schema.productionJobs.companyId, id)).run();
    db.delete(schema.contracts).where(and(eq(schema.contracts.companyId, id), inArray(schema.contracts.status, ['offered', 'active']))).run();
    db.update(schema.companies).set({ industryId }).where(eq(schema.companies.id, id)).run();
    audit({ actorId, action: 'company.change_industry', targetType: 'company', targetId: id, oldValue: c.industryId, newValue: industryId });
  });
  toCompany(id, { type: 'company' });
  return getCompany(id);
}

/** Builder payload to clone a company as a template (details + permissions, no money/workers). */
export function companyTemplate(id: string) {
  const c = getCompany(id);
  const s = (c.settings ?? {}) as Record<string, number>;
  return {
    name: `${c.name} II`,
    emoji: c.emoji,
    color: c.color,
    slogan: c.slogan,
    industryId: c.industryId,
    difficulty: c.difficulty,
    startingBits: s.startingBits ?? cfg().start.bits[c.difficulty] ?? 1500,
    startingWorkers: s.startingWorkers ?? 2,
    startingWorkplace: s.startingWorkplace ?? 0,
    permissions: getCompanyPermissions(id) as Permissions,
  };
}

/**
 * Permanently delete a company. The ledger is immutable, so its remaining
 * Bits are swept to the Treasury and its (now empty) wallets remain as history.
 */
export function deleteCompany(id: string, actorId: string | null) {
  const c = getCompany(id);
  atomic(() => {
    for (const pot of ['main', 'payroll', 'savings', 'investing']) {
      const w = companyWallet(id, pot);
      const bal = balanceOf(w);
      if (bal > 0) post({ kind: 'company.delete_sweep', memo: `Closing ${c.name}`, actorId, legs: [{ from: w, to: SYS.TREASURY, amount: bal }] });
    }
    const accIds = db.select({ id: schema.accounts.id }).from(schema.accounts).where(eq(schema.accounts.companyId, id)).all().map((a) => a.id);
    if (accIds.length) {
      db.delete(schema.sessions).where(inArray(schema.sessions.accountId, accIds)).run();
      db.delete(schema.permissions).where(and(eq(schema.permissions.subjectType, 'account'), inArray(schema.permissions.subjectId, accIds))).run();
      db.delete(schema.accounts).where(inArray(schema.accounts.id, accIds)).run();
    }
    for (const t of [schema.workers, schema.workplaces, schema.contracts, schema.companyEvents, schema.items, schema.companyProducts, schema.productionJobs, schema.inventory, schema.warehouses, schema.quests, schema.achievements, schema.stats, schema.notifications] as any[]) {
      db.delete(t).where(eq(t.companyId, id)).run();
    }
    db.delete(schema.modifiers).where(eq(schema.modifiers.companyId, id)).run();
    db.delete(schema.guildMembers).where(eq(schema.guildMembers.companyId, id)).run();
    db.delete(schema.holdings).where(eq(schema.holdings.holderId, id)).run();
    db.update(schema.orders).set({ status: 'cancelled' }).where(and(eq(schema.orders.holderId, id), eq(schema.orders.status, 'open'))).run();
    db.update(schema.assets).set({ listed: false, halted: true, haltReason: 'Company closed' }).where(eq(schema.assets.companyId, id)).run();
    db.delete(schema.permissions).where(and(eq(schema.permissions.subjectType, 'company'), eq(schema.permissions.subjectId, id))).run();
    db.delete(schema.companies).where(eq(schema.companies.id, id)).run();
    audit({ actorId, action: 'company.delete', targetType: 'company', targetId: id, oldValue: { name: c.name, industry: c.industryId } });
  });
}

export function markActive(companyId: string) {
  db.update(schema.companies).set({ lastActiveAt: clock.now() }).where(eq(schema.companies.id, companyId)).run();
}
