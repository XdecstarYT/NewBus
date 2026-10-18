import { Router } from 'express';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, sqlite } from '../db';
import { h, parse, ctx } from './http';
import { SYS, balanceOf, moneySupply } from '../services/ledger';
import { connectedCount } from '../ws/hub';
import { clock, DAY_MS } from '../lib/time';
import { getIndustry } from '../services/catalog';
import { audit } from '../services/audit';
import { toAll } from '../lib/bus';
import { invalidateSettings } from '../services/settings';
import { economyTip } from '../services/economy-health';

/** Owner tools added per phase (overview, catalog manager, economy health, chaos, market, seasons...). */
const extras: Array<(r: Router) => void> = [];
export function registerOwnerRoutes(fn: (r: Router) => void) {
  extras.push(fn);
}

export function ownerExtrasRouter() {
  const r = Router();

  r.get(
    '/overview',
    h(() => {
      const now = clock.now();
      const playerHeld = (sqlite.prepare(`SELECT COALESCE(SUM(balance),0) s FROM wallets WHERE owner_type != 'system'`).get() as { s: number }).s;
      const companies = db.select().from(schema.companies).all();
      const byCat = new Map<string, number>();
      for (const c of companies) {
        const cat = getIndustry(c.industryId).category;
        byCat.set(cat, (byCat.get(cat) ?? 0) + 1);
      }
      const richest = companies
        .map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, balance: balanceOf(`w:company:${c.id}:main`) }))
        .sort((a, b) => b.balance - a.balance)
        .slice(0, 5);
      const ledger24h = db.select({ n: sql<number>`count(*)` }).from(schema.ledgerEntries).where(gt(schema.ledgerEntries.createdAt, now - DAY_MS)).get()!.n;
      const trades24h = db.select({ n: sql<number>`count(*)` }).from(schema.trades).where(gt(schema.trades.createdAt, now - DAY_MS)).get()!.n;
      const listed = db.select({ n: sql<number>`count(*)` }).from(schema.assets).where(and(eq(schema.assets.type, 'STOCK'), eq(schema.assets.listed, true))).get()!.n;
      return {
        supply: moneySupply(),
        treasury: balanceOf(SYS.TREASURY),
        npcPool: balanceOf(SYS.NPC),
        playerHeld,
        companies: companies.length,
        activeCompanies: companies.filter((c) => c.lastActiveAt > now - DAY_MS).length,
        online: connectedCount(),
        ledger24h,
        trades24h,
        listed,
        byCategory: [...byCat].map(([category, n]) => ({ category, n })).sort((a, b) => b.n - a.n),
        richest,
        tip: economyTip(),
      };
    }),
  );

  r.post(
    '/announcement',
    h((req) => {
      const { text } = parse(z.object({ text: z.string().max(200) }), req.body);
      const now = clock.now();
      if (text.trim()) {
        db.insert(schema.settings).values({ key: 'announcement', value: text.trim(), updatedAt: now }).onConflictDoUpdate({ target: schema.settings.key, set: { value: text.trim(), updatedAt: now } }).run();
      } else db.delete(schema.settings).where(eq(schema.settings.key, 'announcement')).run();
      invalidateSettings();
      audit({ actorId: ctx(req).account.id, action: 'announcement.set', newValue: text });
      toAll({ type: 'perms' });
      return { ok: true };
    }),
  );

  for (const fn of extras) fn(r);
  return r;
}

export { desc };
